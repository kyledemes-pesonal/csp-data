"""Crossref metadata-health per journal.
- Overall coverage (current + backfile) from /journals/{issn} coverage-type
- Per-year (2019+) percent-with-field via /journals/{issn}/works?filter=has-*&rows=0
Checklist (Kyle-approved): abstract, references, ORCIDs, affiliations, funder registry IDs,
license, full-text/TDM links, similarity-check, update/retraction metadata.
Output: data/crossref.js. Zero-dep, polite pool via mailto."""
import json
import time
import urllib.request
import urllib.parse
from build_metrics import load_roster
from common import write_js

CR = "https://api.crossref.org"
MAILTO = "kyle@ourresearch.org"
Y0, Y1 = 2019, 2026

# display name -> (works-endpoint filter, journals-endpoint coverage key)
FIELDS = {
    "Abstracts": ("has-abstract:1", "abstracts"),
    "References": ("has-references:1", "references"),
    "ORCIDs": ("has-orcid:1", "orcids"),
    "Affiliations": ("has-affiliation:1", "affiliations"),
    "Funder registry IDs": ("has-funder:1", "funders"),
    "Licenses": ("has-license:1", "licenses"),
    "Full-text/TDM links": ("has-full-text:1", "resource-links"),
    "Similarity-check URLs": (None, "similarity-checking"),  # no works filter
    "Update/retraction metadata": ("has-update-policy:1", "update-policies"),
}


def cr_get(path, params=None):
    params = dict(params or {})
    params["mailto"] = MAILTO
    url = CR + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"csp-dashboard ({MAILTO})"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return None


def journal_issn(src):
    """Find the ISSN Crossref knows this journal by."""
    for issn in ([src.get("issn_l")] if src.get("issn_l") else []) + (src.get("issns") or []):
        d = cr_get(f"/journals/{issn}")
        if d and d.get("message"):
            return issn, d["message"]
    return None, None


def per_year(issn, flt, year):
    d = cr_get(f"/journals/{issn}/works",
               {"filter": f"from-pub-date:{year}-01-01,until-pub-date:{year}-12-31,{flt}",
                "rows": 0})
    return d["message"]["total-results"] if d else None


def year_total(issn, year):
    d = cr_get(f"/journals/{issn}/works",
               {"filter": f"from-pub-date:{year}-01-01,until-pub-date:{year}-12-31", "rows": 0})
    return d["message"]["total-results"] if d else None


def main():
    roster = load_roster()
    out = {}
    for g in roster["groups"]:
        if not g["active"]:
            continue
        src = roster["sources"][g["id"]]
        issn, jmeta = journal_issn(src)
        if not issn:
            print(f"  NO CROSSREF JOURNAL for {g['name']}")
            continue
        cov = (jmeta.get("coverage-type") or {})
        entry = {"issn": issn, "crossref_title": jmeta.get("title"),
                 "total_dois": (jmeta.get("counts") or {}).get("total-dois"),
                 "coverage": {}, "years": {}}
        for label, (flt, cov_key) in FIELDS.items():
            entry["coverage"][label] = {
                "current": (cov.get("current") or {}).get(cov_key),
                "backfile": (cov.get("backfile") or {}).get(cov_key),
            }
        totals = {y: year_total(issn, y) for y in range(Y0, Y1 + 1)}
        for y in range(Y0, Y1 + 1):
            tot = totals[y]
            yr = {"total": tot}
            if tot:
                for label, (flt, _) in FIELDS.items():
                    if flt:
                        n = per_year(issn, flt, y)
                        yr[label] = n
            entry["years"][str(y)] = yr
        out[g["id"]] = entry
        print(f"  {g['name']} ({issn}) done")

    write_js("crossref", "CSP_CROSSREF", {
        "fields": list(FIELDS.keys()),
        "filterable": [k for k, v in FIELDS.items() if v[0]],
        "journals": out,
    })


if __name__ == "__main__":
    main()
