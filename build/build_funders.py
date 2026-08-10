"""Static funders dataset (Kyle 2026-08-10: live streaming was painfully slow).
Per journal group: every funder tagged on the journal's works (all years) with
funded-works count and unique-grant count (distinct award IDs), + funder country.
Output: data/funders.js. Cached per group in data-raw/, ~2-5 min total."""
import json
import os
from common import (get, cursor_stream, write_js, sid, DATA_RAW, pmap)
from build_metrics import load_roster


def group_funders(g):
    cache = os.path.join(DATA_RAW, f"funders_{g['id']}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    f = f"primary_location.source.id:{'|'.join(g['members'])},funders.id:!null"
    funders = {}
    n_funded = 0
    for w in cursor_stream("/works", f, "id,funders,awards"):
        n_funded += 1
        seen = set()
        for fu in w.get("funders") or []:
            fid = sid(fu["id"])
            if fid not in funders:
                funders[fid] = {"name": fu["display_name"], "works": 0, "grants": []}
            if fid not in seen:
                funders[fid]["works"] += 1
                seen.add(fid)
        for a in w.get("awards") or []:
            fid = sid(a.get("funder_id") or "")
            aid = a.get("funder_award_id") or sid(a.get("id") or "")
            if fid in funders and aid:
                funders[fid]["grants"].append(aid)
    out = {"n_funded": n_funded,
           "funders": {fid: {"name": v["name"], "works": v["works"],
                             "grants": len(set(v["grants"]))} for fid, v in funders.items()}}
    json.dump(out, open(cache, "w", encoding="utf-8"))
    print(f"  {g['id']} ({g['name']}): {n_funded} funded works, {len(funders)} funders")
    return out


def main():
    roster = load_roster()
    groups = [g for g in roster["groups"]]
    results = pmap(group_funders, groups, workers=5)

    all_fids = sorted({fid for r in results for fid in r["funders"]})
    country = {}
    for i in range(0, len(all_fids), 50):
        chunk = all_fids[i:i + 50]
        d = get("/funders", {"filter": "ids.openalex:" + "|".join(chunk),
                             "per-page": 50, "select": "id,country_code"})
        for r in d["results"]:
            country[sid(r["id"])] = r.get("country_code")
    print(f"{len(all_fids)} unique funders, {sum(1 for c in country.values() if c == 'CA')} Canadian")

    write_js("funders", "CSP_FUNDERS", {
        "groups": {g["id"]: r for g, r in zip(groups, results)},
        "country": country,
    })


if __name__ == "__main__":
    main()
