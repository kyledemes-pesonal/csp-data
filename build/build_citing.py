"""Citing-works static dataset.
Scope: all works citing CSP works PUBLISHED 2019+ (Kyle: 2019+, full raw download).
1. Per journal group: cited work ids (2019+, cited_by_count>0)  -> cited_map
2. cites:ID1|...|ID60 piped queries, stream citing works (slim select) -> data-raw/citing/*.jsonl.gz
3. Aggregate per group + ALL: years, oa, subjects, institutions (all/corresponding),
   countries (all/corresponding), authors (with modal country) -> data/citing.js
Resumable (checkpoint of completed batches)."""
import json
import os
import sys
import gzip
from collections import defaultdict, Counter
from common import (cursor_stream, write_js, sid, load_checkpoint, save_checkpoint,
                    DATA_RAW, pmap)
from build_metrics import load_roster, OA

Y0 = 2019
PIPE = 60
CIT_DIR = os.path.join(DATA_RAW, "citing")
os.makedirs(CIT_DIR, exist_ok=True)
SELECT = ("id,publication_year,cited_by_count,fwci,open_access,topics,"
          "authorships,referenced_works")


def cited_map(roster):
    """Cited work -> group ids. The citing batches are cached by position in this map, so a roster
    change (e.g. the 2026-10-30 CSP publisher fold) has to refetch both: never reuse one alone."""
    cache = os.path.join(DATA_RAW, "cited_map.json")
    sig_path = os.path.join(DATA_RAW, "cited_map.roster.json")
    sig = sorted(f"{g['id']}:{'|'.join(sorted(g['members']))}" for g in roster["groups"])
    stale = f"Delete {cache}, {sig_path} and {CIT_DIR}/ to refetch the citing data."
    if os.path.exists(cache):
        m = json.load(open(cache, encoding="utf-8"))
        if os.path.exists(sig_path):
            if json.load(open(sig_path, encoding="utf-8")) != sig:
                sys.exit("journal roster changed since cited_map.json was built. " + stale)
        else:
            # cache from before this check: groups with no 2019+ works never enter the map,
            # so the most we can test is that no cached group has left the roster
            gone = sorted({gid for gids in m.values() for gid in gids} - {g["id"] for g in roster["groups"]})
            if gone:
                sys.exit(f"cited_map.json was built for another roster (gone: {gone}). " + stale)
            json.dump(sig, open(sig_path, "w", encoding="utf-8"))
        return m
    if os.listdir(CIT_DIR):
        sys.exit(f"{CIT_DIR}/ holds batches from an earlier cited map. " + stale)
    m = {}
    for g in roster["groups"]:
        f = (f"primary_location.source.id:{'|'.join(g['members'])},"
             f"publication_year:{Y0}-,cited_by_count:>0")
        for w in cursor_stream("/works", f, "id"):
            m.setdefault(sid(w["id"]), []).append(g["id"])
        print(f"  cited ids: {g['id']} done (total {len(m)})")
    json.dump(m, open(cache, "w", encoding="utf-8"))
    json.dump(sig, open(sig_path, "w", encoding="utf-8"))
    return m


def fetch_batch(args):
    bi, ids = args
    path = os.path.join(CIT_DIR, f"batch_{bi:04d}.jsonl.gz")
    if os.path.exists(path):
        return bi
    tmp = path + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for w in cursor_stream("/works", "cites:" + "|".join(ids), SELECT):
            f.write(json.dumps(w, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    print(f"  batch {bi} done", flush=True)
    return bi


def slim_authorships(w):
    out = []
    for a in w.get("authorships") or []:
        out.append({
            "a": sid((a.get("author") or {}).get("id") or ""),
            "an": (a.get("author") or {}).get("display_name") or "",
            "corr": bool(a.get("is_corresponding")),
            "insts": [{"i": sid(i["id"]), "n": i.get("display_name"),
                       "c": i.get("country_code")} for i in (a.get("institutions") or []) if i.get("id")],
            "cc": a.get("countries") or [],
        })
    return out


class Agg:
    def __init__(self):
        self.years = defaultdict(lambda: {"n": 0, "cites": 0, "fwci_sum": 0.0, "fwci_n": 0,
                                          "oa": dict.fromkeys(OA, 0)})
        self.topics = Counter()
        self.tmeta = {}
        self.inst_all = Counter(); self.inst_corr = Counter(); self.imeta = {}
        self.cc_all = Counter(); self.cc_corr = Counter()
        self.authors = Counter(); self.ameta = {}
        self.author_cc = defaultdict(Counter)
        self.n = 0

    def add(self, w):
        self.n += 1
        y = w.get("publication_year")
        if y:
            a = self.years[str(y)]
            a["n"] += 1
            a["cites"] += w.get("cited_by_count") or 0
            if w.get("fwci") is not None:
                a["fwci_sum"] += w["fwci"]; a["fwci_n"] += 1
            st = ((w.get("open_access") or {}).get("oa_status")) or "closed"
            a["oa"][st] = a["oa"].get(st, 0) + 1
        tps = w.get("topics") or []
        if tps:
            t = tps[0]
            tid = sid(t["id"])
            self.topics[tid] += 1
            if tid not in self.tmeta:
                self.tmeta[tid] = {"name": t["display_name"],
                                   "sf": sid(t["subfield"]["id"]).replace("subfields/", ""),
                                   "sfn": t["subfield"]["display_name"],
                                   "f": int(sid(t["field"]["id"]).replace("fields/", "")),
                                   "fn": t["field"]["display_name"]}
        seen_i, seen_ic, seen_c, seen_cc = set(), set(), set(), set()
        for au in w["_auth"]:
            for i in au["insts"]:
                if i["i"] not in seen_i:
                    seen_i.add(i["i"]); self.inst_all[i["i"]] += 1
                    self.imeta[i["i"]] = {"name": i["n"], "c": i["c"]}
                if au["corr"] and i["i"] not in seen_ic:
                    seen_ic.add(i["i"]); self.inst_corr[i["i"]] += 1
            for c in au["cc"]:
                if c not in seen_c:
                    seen_c.add(c); self.cc_all[c] += 1
                if au["corr"] and c not in seen_cc:
                    seen_cc.add(c); self.cc_corr[c] += 1
            if au["a"]:
                self.authors[au["a"]] += 1
                self.ameta[au["a"]] = au["an"]
                for c in au["cc"]:
                    self.author_cc[au["a"]][c] += 1

    def dump(self, top=30):
        return {
            "n": self.n,
            "years": {y: {"n": v["n"], "cites": v["cites"],
                          "fwci": round(v["fwci_sum"] / v["fwci_n"], 3) if v["fwci_n"] else None,
                          "oa": v["oa"]} for y, v in sorted(self.years.items())},
            "topics": [{"id": t, "n": n, **self.tmeta[t]} for t, n in self.topics.most_common(300)],
            "institutions": [{"id": i, "n": n, **self.imeta[i]} for i, n in self.inst_all.most_common(top)],
            "institutions_corr": [{"id": i, "n": n, **self.imeta[i]} for i, n in self.inst_corr.most_common(top)],
            "countries": dict(self.cc_all.most_common(60)),
            "countries_corr": dict(self.cc_corr.most_common(60)),
            "authors": [{"id": a, "n": n, "name": self.ameta[a],
                         "cc": (self.author_cc[a].most_common(1) or [(None, 0)])[0][0]}
                        for a, n in self.authors.most_common(top)],
        }


def aggregate(cited):
    batches = sorted(f for f in os.listdir(CIT_DIR) if f.endswith(".jsonl.gz"))
    aggs = defaultdict(Agg)
    seen = set()
    edges = 0
    for bf in batches:
        with gzip.open(os.path.join(CIT_DIR, bf), "rt", encoding="utf-8") as f:
            for line in f:
                w = json.loads(line)
                wid = sid(w["id"])
                if wid in seen:
                    continue
                seen.add(wid)
                grps = set()
                for r in w.get("referenced_works") or []:
                    for g in cited.get(sid(r), []):
                        grps.add(g)
                if not grps:
                    continue
                edges += len(grps)
                w["_auth"] = slim_authorships(w)
                aggs["ALL"].add(w)
                for g in grps:
                    aggs[g].add(w)
        print(f"  aggregated {bf} ({len(seen)} unique citing works)", flush=True)
    print(f"unique citing works: {len(seen)}, journal-attribution edges: {edges}")
    return {g: a.dump() for g, a in aggs.items()}, len(seen)


def main():
    roster = load_roster()
    cited = cited_map(roster)
    ids = sorted(cited.keys())
    print(f"{len(ids)} cited CSP works (2019+)")
    batches = [(i // PIPE, ids[i:i + PIPE]) for i in range(0, len(ids), PIPE)]
    print(f"{len(batches)} pipe batches")
    pmap(fetch_batch, batches, workers=6)
    print("all batches downloaded; aggregating...")
    out, n_unique = aggregate(cited)
    write_js("citing", "CSP_CITING", {
        "scope": f"works citing CSP-journal works published {Y0}+",
        "n_cited_works": len(ids),
        "n_citing_works": n_unique,
        "groups": out,
    })


if __name__ == "__main__":
    main()
