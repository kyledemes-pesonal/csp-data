"""Roster: CSP sources (both lineages), successor chains, active flags, APC, flags.js.
Outputs: data/journals.js, data/flags.js. Fast (~1 min)."""
import json
import urllib.request
import base64
from datetime import date
from common import (get, CHAINS, CSP_LINEAGES, EBOOKS, write_js, sid)


def fetch_sources():
    d = get("/sources", {"filter": f"host_organization_lineage:{CSP_LINEAGES}", "per-page": 100})
    src = [s for s in d["results"] if sid(s["id"]) != EBOOKS]
    assert d["meta"]["count"] <= 100, "pagination needed"
    return src


def main():
    sources = fetch_sources()
    this_year = date.today().year
    active_years = {this_year - 1, this_year - 2}  # last two FULL years

    predecessors = {p for preds in CHAINS.values() for p in preds}
    rows = {}
    for s in sources:
        i = sid(s["id"])
        recent = {c["year"] for c in s.get("counts_by_year", []) if c["works_count"] > 0}
        rows[i] = {
            "id": i,
            "name": s["display_name"],
            "issn_l": s.get("issn_l"),
            "issns": s.get("issn") or [],
            "is_oa": s.get("is_oa"),
            "is_in_doaj": s.get("is_in_doaj"),
            "works_count": s.get("works_count"),
            "cited_by_count": s.get("cited_by_count"),
            "homepage": s.get("homepage_url"),
            "apc_usd": s.get("apc_usd"),
            "apc_prices": s.get("apc_prices") or [],
            "apc_usd_by_year": s.get("apc_usd_by_year"),
            "h_index": (s.get("summary_stats") or {}).get("h_index"),
            "publisher": sid((s.get("host_organization") or "")),
            "active": bool(recent & active_years),
            "predecessor_of": None,
        }

    for succ, preds in CHAINS.items():
        for p in preds:
            if p in rows:
                rows[p]["predecessor_of"] = succ
                rows[p]["active"] = False

    # journal groups: active successors + active standalones
    groups = []
    for i, r in sorted(rows.items(), key=lambda kv: -(kv[1]["works_count"] or 0)):
        if r["predecessor_of"]:
            continue
        members = [i] + [p for p in CHAINS.get(i, []) if p in rows]
        total = sum(rows[m]["works_count"] or 0 for m in members)
        groups.append({
            "id": i,
            "name": r["name"],
            "members": members,
            "active": r["active"],
            "works_total": total,
        })

    missing = [p for preds in CHAINS.values() for p in preds if p not in rows]
    if missing:
        print("WARNING: chain members not found in lineage query:", missing)

    write_js("journals", "CSP_JOURNALS", {
        "sources": rows,
        "groups": groups,
        "lineages": CSP_LINEAGES.split("|"),
    })


def build_flags():
    codes = json.loads(urllib.request.urlopen("https://flagcdn.com/en/codes.json", timeout=60).read())
    flags = {}
    for cc in codes:
        if "-" in cc:  # skip subdivisions (us-ca etc.)
            continue
        try:
            png = urllib.request.urlopen(f"https://flagcdn.com/w40/{cc}.png", timeout=60).read()
            flags[cc.upper()] = "data:image/png;base64," + base64.b64encode(png).decode()
        except Exception as e:
            print("flag fail", cc, e)
    write_js("flags", "CSP_FLAGS", {"flags": flags, "names": {k.upper(): v for k, v in codes.items()}})


if __name__ == "__main__":
    main()
    build_flags()
