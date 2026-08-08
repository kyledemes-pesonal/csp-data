"""Stream ALL works of every CSP source (full history) once; aggregate:
- metrics.js: per journal-GROUP per year: n, citation sum, mean FWCI, OA statuses,
  apc_paid sum, retracted count
- landscape.js: boussole data — topics published in CSP journals, domain mix, per-group counts
Resumable per source. ~1,100 calls, ~5-10 min."""
import json
import os
from collections import defaultdict
from common import (cursor_stream, CHAINS, write_js, sid, load_checkpoint,
                    save_checkpoint, DATA_RAW, pmap)

SELECT = "id,publication_year,cited_by_count,fwci,open_access,apc_paid,topics,is_retracted"

# UdeS validator-tuned 26-field palette; fixed field order (domain blocks + within-domain angle)
FIELD_ORDER = [16, 25, 23, 15, 31, 19, 21, 22, 26, 17,          # physical (d3)
               28, 24, 13, 30, 11,                               # life (d1)
               27, 29, 34, 36, 35,                               # health (d4)
               18, 14, 20, 33, 12, 32]                           # social (d2)
FIELD_PALETTE = ["#2da6d2", "#064def", "#68a0df", "#0642f9", "#8194da", "#2436f9",
                 "#8f8bee", "#411af9", "#a47efc", "#6b06ef", "#6faa18", "#257703",
                 "#05c708", "#197637", "#05c780", "#bd051d", "#d67c71", "#9f3d04",
                 "#e58f06", "#776803", "#b374fb", "#8d05c7", "#ec2efa", "#962c84",
                 "#fa42b1", "#b30545"]

OA = ["closed", "bronze", "green", "gold", "diamond", "hybrid"]


def load_roster():
    js = open(os.path.join(os.path.dirname(DATA_RAW), "data", "journals.js"), encoding="utf-8").read()
    return json.loads(js[js.index("=") + 1:].rstrip().rstrip(";"))


def group_of(roster):
    g = {}
    for grp in roster["groups"]:
        for m in grp["members"]:
            g[m] = grp["id"]
    return g


def stream_source(src_id):
    """Stream + aggregate one source; cached to data-raw/agg_<id>.json."""
    cache = os.path.join(DATA_RAW, f"agg_{src_id}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    years = defaultdict(lambda: {"n": 0, "cites": 0, "fwci_sum": 0.0, "fwci_n": 0,
                                 "oa": dict.fromkeys(OA, 0), "apc_paid": 0, "retracted": 0})
    topics = defaultdict(lambda: {"n": 0, "mix": defaultdict(float), "name": "",
                                  "field": None, "subfield": None, "sf_name": "", "f_name": ""})
    n = 0
    for w in cursor_stream("/works", f"primary_location.source.id:{src_id}", SELECT,
                           progress=src_id):
        n += 1
        y = w.get("publication_year")
        if not y:
            continue
        a = years[y]
        a["n"] += 1
        a["cites"] += w.get("cited_by_count") or 0
        if w.get("fwci") is not None:
            a["fwci_sum"] += w["fwci"]
            a["fwci_n"] += 1
        st = ((w.get("open_access") or {}).get("oa_status")) or "closed"
        a["oa"][st] = a["oa"].get(st, 0) + 1
        apc = (w.get("apc_paid") or {}).get("value_usd")
        if apc:
            a["apc_paid"] += apc
        if w.get("is_retracted"):
            a["retracted"] += 1
        tps = w.get("topics") or []
        if tps:
            prim = tps[0]
            tid = sid(prim["id"])
            t = topics[tid]
            t["n"] += 1
            t["name"] = prim["display_name"]
            t["field"] = int(sid(prim["field"]["id"]).replace("fields/", ""))
            t["subfield"] = int(sid(prim["subfield"]["id"]).replace("subfields/", ""))
            t["sf_name"] = prim["subfield"]["display_name"]
            t["f_name"] = prim["field"]["display_name"]
            share = 1.0 / len(tps)
            for tp in tps:
                did = int(sid(tp["domain"]["id"]).replace("domains/", ""))
                t["mix"][str(did)] += share
    out = {"years": {str(k): v for k, v in years.items()},
           "topics": {k: {**v, "mix": dict(v["mix"])} for k, v in topics.items()},
           "n": n}
    json.dump(out, open(cache, "w", encoding="utf-8"))
    print(f"  {src_id}: {n} works")
    return out


def main():
    roster = load_roster()
    gmap = group_of(roster)
    src_ids = [i for i in roster["sources"]]
    print(f"streaming {len(src_ids)} sources...")
    aggs = pmap(stream_source, src_ids, workers=5)

    # fold into groups
    gyears = defaultdict(lambda: defaultdict(lambda: {"n": 0, "cites": 0, "fwci_sum": 0.0,
                          "fwci_n": 0, "oa": dict.fromkeys(OA, 0), "apc_paid": 0, "retracted": 0}))
    gtopics = defaultdict(lambda: defaultdict(int))  # group -> topic -> n
    tmeta = {}
    for src_id, agg in zip(src_ids, aggs):
        grp = gmap.get(src_id, src_id)
        for y, a in agg["years"].items():
            t = gyears[grp][y]
            for k in ("n", "cites", "apc_paid", "retracted", "fwci_sum", "fwci_n"):
                t[k] += a[k]
            for st, c in a["oa"].items():
                t["oa"][st] = t["oa"].get(st, 0) + c
        for tid, tv in agg["topics"].items():
            gtopics[grp][tid] += tv["n"]
            if tid not in tmeta:
                tmeta[tid] = {"name": tv["name"], "field": tv["field"], "subfield": tv["subfield"],
                              "sf_name": tv["sf_name"], "f_name": tv["f_name"],
                              "n": 0, "mix": defaultdict(float), "mix_n": 0}
            m = tmeta[tid]
            m["n"] += tv["n"]
            for d, v in tv["mix"].items():
                m["mix"][d] += v
            m["mix_n"] += tv["n"]

    # normalize topic mixes
    topics_out = []
    for tid, m in tmeta.items():
        tot = sum(m["mix"].values()) or 1
        topics_out.append({"id": tid, "name": m["name"], "field": m["field"],
                           "subfield": m["subfield"], "sf_name": m["sf_name"],
                           "f_name": m["f_name"], "n": m["n"],
                           "mix": {d: round(v / tot, 4) for d, v in m["mix"].items()}})
    topics_out.sort(key=lambda t: -t["n"])

    write_js("metrics", "CSP_METRICS", {
        "oa_order": OA,
        "groups": {g: {y: {"n": v["n"], "cites": v["cites"],
                           "fwci": round(v["fwci_sum"] / v["fwci_n"], 3) if v["fwci_n"] else None,
                           "fwci_n": v["fwci_n"], "oa": v["oa"],
                           "apc_paid": round(v["apc_paid"]),
                           "retracted": v["retracted"]}
                       for y, v in sorted(ys.items())}
                 for g, ys in gyears.items()},
    })
    write_js("landscape", "CSP_LANDSCAPE", {
        "field_order": FIELD_ORDER,
        "field_palette": FIELD_PALETTE,
        "topics": topics_out,
        "per_group": {g: dict(sorted(t.items(), key=lambda kv: -kv[1])) for g, t in gtopics.items()},
    })


if __name__ == "__main__":
    main()
