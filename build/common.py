"""Shared helpers for CSP dashboard build scripts. Zero-dependency (urllib only)."""
import json
import os
import sys
import time
import gzip
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DATA_RAW = os.path.join(ROOT, "data-raw")
os.makedirs(DATA, exist_ok=True)
os.makedirs(DATA_RAW, exist_ok=True)

API = "https://api.openalex.org"

# CSP's journals = sources hosted by P4310312929. P4310313060 "NRC Research Press" (CSP's pre-2010
# name) was folded into it on 2026-10-30 (ZD 22906, oxjob #1899): its journals moved over and the
# publisher was merged. Same change: JPN joined (CSP publishes it since 2025), Canadian Journal of
# Research joined (archive), Geomatica left (Elsevier since 2024), CAS Journal and J. Student Sci. &
# Tech. left (never CSP's).
CSP_LINEAGES = "P4310312929"
EBOOKS = "S4306486301"

# Successor chains: successor source id -> [predecessor ids, oldest last]
CHAINS = {
    "S118554560": ["S4210188060"],  # Botany <- CJ Botany
    "S57183551": ["S4210175024", "S4210235807", "S4210229764"],  # CJFAS chain
    "S170991295": ["S4210187997"],  # Genome <- CJ Genetics & Cytology
    "S159551863": ["S4210210924", "S4210188051", "S4210182832", "S2764838677"],  # Biochem & Cell Bio chain
    "S173941543": ["S184552281"],  # APNM <- CJ Applied Physiology
    "S4220651326": ["S4210187971"],  # Drone Systems <- J Unmanned Vehicle Systems
}


def _load_key():
    k = os.environ.get("OPENALEX_API_KEY")
    if k:
        return k
    # sibling checkout (Windows layout), then the Mac working tree
    for env in (os.path.join(os.path.dirname(ROOT), "openalex-walden", ".env"),
                os.path.expanduser("~/OneDrive/Desktop/OPENALEX/openalex-walden/.env")):
        if not os.path.exists(env):
            continue
        for line in open(env, encoding="utf-8", errors="ignore"):
            line = line.strip()
            if line.startswith("OPENALEX_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


API_KEY = _load_key()
_session_headers = {"User-Agent": "csp-dashboard-build (kyle@ourresearch.org)"}
if API_KEY:
    _session_headers["Authorization"] = f"Bearer {API_KEY}"


def get(path, params=None, retries=6, base_url=API, auth=True):
    """GET JSON with retry/backoff. path like '/works'. params dict."""
    params = dict(params or {})
    url = base_url + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = dict(_session_headers) if auth else {"User-Agent": _session_headers["User-Agent"]}
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            body = ""
            try:
                body = e.read().decode("utf-8")[:500]
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code} for {url}\n{body}") from e
        except Exception as e:  # timeouts, connection resets
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"gave up after {retries} tries: {url}: {last}")


def works(filter_, extra=None):
    p = {"filter": filter_, "include_xpac": "true"}
    p.update(extra or {})
    return get("/works", p)


def count(filter_):
    return works(filter_, {"per-page": 1, "select": "id"})["meta"]["count"]


def group_by(filter_, key, per_page=200):
    d = works(filter_, {"group_by": key, "per-page": per_page})
    return d["group_by"]


def cursor_stream(path, filter_, select, per_page=200, extra=None, progress=None):
    """Yield results across all cursor pages."""
    cursor = "*"
    n = 0
    while cursor:
        p = {"filter": filter_, "per-page": per_page, "cursor": cursor, "select": select}
        if path == "/works":
            p["include_xpac"] = "true"
        p.update(extra or {})
        d = get(path, p)
        for r in d["results"]:
            yield r
        n += len(d["results"])
        if progress and n % (per_page * 25) == 0:
            print(f"    ...{n}/{d['meta']['count']} {progress}", flush=True)
        cursor = d["meta"].get("next_cursor")
        if not d["results"]:
            break


def pmap(fn, items, workers=6):
    """Parallel map preserving order."""
    out = [None] * len(items)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fn, it): i for i, it in enumerate(items)}
        for f in as_completed(futs):
            out[futs[f]] = f.result()
    return out


def write_js(name, varname, obj):
    """Write data/<name>.js exposing window.<varname>, with generated timestamp."""
    obj = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **obj}
    path = os.path.join(DATA, name + ".js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"window.{varname} = ")
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {path} ({os.path.getsize(path)/1e6:.2f} MB)")


def checkpoint_path(name):
    return os.path.join(DATA_RAW, name + ".checkpoint.json")


def load_checkpoint(name, default):
    p = checkpoint_path(name)
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return default


def save_checkpoint(name, obj):
    p = checkpoint_path(name)
    tmp = p + ".tmp"
    json.dump(obj, open(tmp, "w", encoding="utf-8"))
    os.replace(tmp, p)


def sid(x):
    """Normalize an OpenAlex id/url to bare id."""
    return x.rsplit("/", 1)[-1] if x else x
