"""Benchmarking peer sets + peer metrics 2019+.
Per active CSP journal: top 3 subfields (2019+) -> top 10 journals by Canadian-authored
works in those subfields (excl. CSP/NRC titles, megajournals included per Kyle).
Per peer-year: n, citation sum, apc_paid sum, OA breakdown (one call), plus exhaustive
mean FWCI via streaming (checkpointed; the long pole — megajournals).
Output: data/peers.js"""
import json
import os
from collections import defaultdict
from common import (get, works, group_by, cursor_stream, write_js, sid, pmap,
                    CSP_LINEAGES, DATA_RAW)
from build_metrics import load_roster, OA

Y0, Y1 = 2019, 2026

# Multidisciplinary soundness-review megajournals dominate every subfield's
# Canadian-authored counts, so they crowd out real disciplinary peers (Kyle 2026-08-10).
MEGAJOURNALS = {
    "Scientific Reports", "PLoS ONE", "PLOS ONE", "Heliyon", "PeerJ",
    "Royal Society Open Science", "Cureus", "IEEE Access", "SAGE Open",
    "F1000Research", "Science Advances", "Nature Communications",
}


def top_subfields(members):
    f = f"primary_location.source.id:{'|'.join(members)},publication_year:{Y0}-"
    gb = group_by(f, "primary_topic.subfield.id")
    return [sid(g["key"]).replace("subfields/", "") for g in gb[:3]]


def peer_candidates(subfields, exclude):
    f = (f"primary_topic.subfield.id:{'|'.join(subfields)},"
         f"institutions.country_code:CA,publication_year:{Y0}-")
    gb = group_by(f, "primary_location.source.id")
    cands = [(sid(g["key"]), g["count"]) for g in gb if sid(g["key"]) not in exclude]
    # fetch entities for top 30, keep journals only
    ids = [c[0] for c in cands[:30]]
    ents = get("/sources", {"filter": "ids.openalex:" + "|".join(ids), "per-page": 50})["results"]
    emap = {sid(e["id"]): e for e in ents}
    peers = []
    for pid, ca_n in cands:
        e = emap.get(pid)
        if not e or e.get("type") != "journal":
            continue
        if e["display_name"] in MEGAJOURNALS:
            continue
        peers.append({"id": pid, "name": e["display_name"], "ca_works": ca_n,
                      "publisher": (e.get("host_organization_name") or ""),
                      "is_oa": e.get("is_oa"), "apc_usd": e.get("apc_usd"),
                      "apc_usd_by_year": e.get("apc_usd_by_year"),
                      "h_index": (e.get("summary_stats") or {}).get("h_index")})
        if len(peers) == 10:
            break
    return peers


def peer_year_stats(src_id):
    """count, cite sum, apc sum, oa breakdown per year — one call per year."""
    out = {}
    for y in range(Y0, Y1 + 1):
        d = works(f"primary_location.source.id:{src_id},publication_year:{y}",
                  {"group_by": "oa_status", "per-page": 200,
                   "cited_by_count_sum": "true", "apc_sum": "true"})
        oa = {g["key"]: g["count"] for g in d["group_by"]}
        out[str(y)] = {"n": d["meta"]["count"],
                       "cites": d["meta"].get("cited_by_count_sum", 0),
                       "apc_paid": round(d["meta"].get("apc_paid_sum_usd") or 0),
                       "oa": {k: oa.get(k, 0) for k in OA}}
    return out


def peer_fwci(src_id):
    """Exhaustive mean FWCI per year 2019+, cached."""
    cache = os.path.join(DATA_RAW, f"fwci_{src_id}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    acc = defaultdict(lambda: [0.0, 0])
    for w in cursor_stream("/works",
                           f"primary_location.source.id:{src_id},publication_year:{Y0}-",
                           "publication_year,fwci", progress=f"fwci {src_id}"):
        if w.get("fwci") is not None and w.get("publication_year"):
            a = acc[str(w["publication_year"])]
            a[0] += w["fwci"]
            a[1] += 1
    out = {y: {"fwci": round(s / n, 3), "fwci_n": n} for y, (s, n) in acc.items() if n}
    json.dump(out, open(cache, "w", encoding="utf-8"))
    print(f"  fwci done {src_id}")
    return out


def main():
    roster = load_roster()
    csp_ids = set(roster["sources"].keys())
    groups = [g for g in roster["groups"] if g["active"]]

    print("selecting peer sets...")
    def one(g):
        sfs = top_subfields(g["members"])
        peers = peer_candidates(sfs, csp_ids)
        return {"journal": g["id"], "subfields": sfs, "peers": peers}
    peer_sets = pmap(one, groups, workers=6)

    unique_peers = {}
    for ps in peer_sets:
        for p in ps["peers"]:
            unique_peers[p["id"]] = p
    print(f"{len(unique_peers)} unique peer journals")

    print("per-year stats...")
    stats = dict(zip(unique_peers.keys(),
                     pmap(peer_year_stats, list(unique_peers.keys()), workers=6)))

    print("exhaustive FWCI (long)...")
    fwci = dict(zip(unique_peers.keys(),
                    pmap(peer_fwci, list(unique_peers.keys()), workers=6)))

    for pid, p in unique_peers.items():
        p["years"] = stats[pid]
        for y, fv in fwci[pid].items():
            if y in p["years"]:
                p["years"][y].update(fv)

    # subfield display names
    sf_ids = sorted({sf for ps in peer_sets for sf in ps["subfields"]})
    sf_names = {}
    for i in range(0, len(sf_ids), 50):
        d = get("/subfields", {"filter": "id:" + "|".join(
            f"subfields/{s}" for s in sf_ids[i:i+50]), "per-page": 50})
        for r in d["results"]:
            sf_names[sid(r["id"]).replace("subfields/", "")] = r["display_name"]

    write_js("peers", "CSP_PEERS", {
        "y0": Y0, "y1": Y1,
        "peer_sets": {ps["journal"]: ps for ps in peer_sets},
        "peers": unique_peers,
        "subfield_names": sf_names,
    })


if __name__ == "__main__":
    main()
