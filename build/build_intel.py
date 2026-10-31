"""Board-intel datasets: market share + Canadian-author share.
- Market share: Canadian-authored works per year (2010+) in CSP's top subfields,
  by publisher (CSP vs majors). One group_by call per publisher.
- CA share: per CSP journal group, Canadian-authored works per year (full history).
Output: data/intel.js. Fast (~40 calls)."""
from common import get, group_by, write_js, sid
from build_metrics import load_roster

Y0 = 2010
MAJORS = ["Elsevier", "Springer Nature", "Wiley", "Taylor & Francis", "MDPI",
          "Frontiers Media", "SAGE Publishing", "Oxford University Press",
          "American Chemical Society", "IEEE"]


def publisher_id(name):
    d = get("/publishers", {"search": name, "per-page": 1})
    r = d["results"][0]
    return sid(r["lineage"][0]), r["display_name"]


def year_counts(filter_):
    return {g["key"]: g["count"] for g in group_by(filter_, "publication_year")}


def main():
    roster = load_roster()
    all_members = [m for g in roster["groups"] for m in g["members"]]

    # CSP's top subfields (2019+, top 15)
    gb = group_by(f"primary_location.source.id:{'|'.join(all_members)},publication_year:2019-",
                  "primary_topic.subfield.id")
    subfields = [sid(g["key"]).replace("subfields/", "") for g in gb[:15]]
    sf_names = {sid(g["key"]).replace("subfields/", ""): g["key_display_name"] for g in gb[:15]}
    sf_filter = "|".join(subfields)

    base = f"primary_topic.subfield.id:{sf_filter},institutions.country_code:CA,publication_year:{Y0}-"

    market = {}
    # CSP = the roster's own sources, not the publisher lineage: works only pick up a source's
    # host at their next re-stamp, so a re-hosted journal (JPN, Oct 2026) lags under lineage filters
    market["Canadian Science Publishing"] = year_counts(
        base + f",primary_location.source.id:{'|'.join(all_members)}")
    for name in MAJORS:
        pid, canon = publisher_id(name)
        market[canon] = year_counts(
            base + f",primary_location.source.host_organization_lineage:{pid}")
        print(f"  {canon} ({pid}) done")
    total = year_counts(base)

    # Canadian-author share per journal group (full history)
    ca_share = {}
    for g in roster["groups"]:
        ca_share[g["id"]] = year_counts(
            f"primary_location.source.id:{'|'.join(g['members'])},institutions.country_code:CA")
        print(f"  CA share {g['id']} done")

    write_js("intel", "CSP_INTEL", {
        "y0": Y0,
        "subfields": sf_names,
        "market": market,
        "market_total": total,
        "ca_share": ca_share,
    })


if __name__ == "__main__":
    main()
