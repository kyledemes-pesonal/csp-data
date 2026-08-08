# CSP Board Intelligence Dashboard — PLAN (the contract)

Kyle is joining the board of **Canadian Science Publishing (CSP)**. This dashboard is a
single-page site giving intelligence on CSP's journal portfolio, deployed on Railway from
Kyle's personal GitHub (`kyledemes-pesonal`), NOT the OpenAlex org.

Kicked off 2026-08-08. All decisions below were confirmed by Kyle on 2026-08-08.

## Data universe

CSP's journals live under TWO unlinked OpenAlex publishers (curation gap, separate task filed):

- `P4310312929` Canadian Science Publishing (22 sources)
- `P4310313060` NRC Research Press (15 sources — the flagships: CJ Chemistry, CJ Zoology, …)

The dashboard always unions both lineages (~37 sources, ~204k works; 15,330 works 2019+
including xpac). `include_xpac=true` on all works calls (adds only ~49 works but correct).
Excluded: `S4306486301` (CSP eBooks platform, 13 works).

### Journal roster & successor chains (LOCKED — Kyle wants FULL history)

Predecessor titles fold into their active successor for all time series. Chains:

- **Botany** S118554560 ← Canadian J. of Botany S4210188060
- **CJ Fisheries & Aquatic Sciences** S57183551 ← J. Fisheries Research Board S4210175024
  ← Contributions to Canadian Biology & Fisheries S4210235807 ← J. Biological Board of Canada S4210229764
- **Genome** S170991295 ← CJ Genetics & Cytology S4210187997
- **Biochemistry & Cell Biology** S159551863 ← CJ Biochem & Cell Bio S4210210924
  ← CJ Biochemistry S4210188051 ← CJ Biochemistry & Physiology S4210182832 ← CJ Medical Sciences S2764838677
  (note: CJB&P historically split into Biochem + Physiology&Pharmacology; we assign the
  pre-split history to the Biochem chain only, to avoid double counting)
- **Applied Physiology, Nutrition, and Metabolism** S173941543 ← CJ Applied Physiology S184552281
- **Drone Systems & Applications** S4220651326 ← J. Unmanned Vehicle Systems S4210187971

Standalone historical titles (no successor; shown in portfolio table as inactive, not in
per-journal selectors): Canadian Aeronautics & Space J. S142396420, J. Student Science &
Technology S950063636, GEOMATICA S4210183195 (if inactive per the rule below).

"Active" = ≥1 work in the last two full calendar years (computed at build time, not hardcoded).

## Locked decisions

1. **Full history** on the portfolio tab; benchmarking + citing + granular tabs default 2019+.
2. "Perfect OA" was a typo for **percent OA**.
3. **Diamond OA is native at the work level** (`oa_status` group_by returns `diamond` — verified).
   All OA breakdowns aggregate works-level `oa_status`: closed, bronze, green, gold, diamond, hybrid.
4. **Benchmarking peer set** (build-time, per active CSP journal): top 3 subfields of the
   journal (2019+, by primary_topic.subfield), then top 10 journals by count of
   Canadian-authored works (institutions.country_code:CA) 2019+ in those subfields,
   excluding all CSP/NRC titles. Megajournals INCLUDED (Kyle's call).
5. **APC over time**: sources now carry `apc_usd_by_year` (new field, ~2026-07). Use it.
   Where null, fall back to current `apc_usd` flat + works-level `apc_sum` per year.
6. **Citing-works dataset**: static, scope = works citing CSP works **published 2019+**
   (11,831 cited works). FULL raw download kept in `data-raw/` (gitignored),
   chart-ready aggregates shipped in `data/citing.js`. Page shows "data as of {date}".
7. **Refresh** = Python build scripts (`build/`), not in-browser. Long-term: GitHub Action.
8. Citing window 2019+ confirmed.
9. **Crossref metadata health checklist**: abstract, references, ORCIDs, affiliations,
   funder registry IDs, license URL, full-text/TDM links, similarity-check URLs,
   update/retraction metadata. Mimics Crossref participation report. Static build.
10. **API key**: hidden behind a same-origin `/api/*` proxy (server.js reads
    `OPENALEX_API_KEY` env var on Railway; never in repo). Link-outs to openalex.org UI
    are plain anonymous links. Key for local builds read from `..\openalex-walden\.env`.

## Architecture

```
csp-dashboard/
  server.js          zero-dependency Node static server + /api proxy → api.openalex.org
                     (injects Authorization: Bearer $OPENALEX_API_KEY; 10-min LRU cache)
  package.json       start: node server.js  (Railway autodetects)
  index.html         THE dashboard (all tabs, vanilla JS + custom SVG charts)
  assets/charts.js   chart library: line, stacked bar, bar-h, donut; every figure gets
                     PNG export + CSV export + per-mark click-through to openalex.org UI
  assets/app.js      tab logic, live API layer, rendering
  data/*.js          static datasets (script-tag loaded, window.CSP_* globals)
  build/*.py         py -3 build scripts, zero-dep (urllib), resumable, checkpointed
  data-raw/          full citing-works JSONL download (gitignored)
```

### Tabs

1. **Portfolio** (journal comparison): sortable all-journals table (works, citations, mean
   FWCI, %OA, active flag); multi-line time series (pubs/yr, citations/yr, mean FWCI/yr,
   %OA/yr) — max 8 journals charted at once (fixed 8-slot palette; color follows journal),
   default = top 6 by recent volume. **Boussole des domaines** (modeled on UdeS candidate 4):
   4 OpenAlex domains as compass poles, each topic published in CSP journals placed
   barycentrically by domain mix, sized by works, colored by field (26-field validated
   palette reused from UdeS), filterable by journal. Board-intel panels:
   - CSP share of Canadian-authored output in CSP's subfields vs. major publishers over time
   - Canadian-author share per journal over time
   - Retraction counts per journal
   - APC revenue proxy (gold+hybrid works × APC / apc_paid sums per year)
2. **Benchmarking**: CSP journal selector → static peer data: pubs, citations, mean FWCI,
   %OA, APC 2019→present, CSP journal highlighted vs 10 peers.
3. **Publishing behaviour** (LIVE via proxy): journal + year-range selectors → pubs/yr;
   stacked OA-status bars/yr; subject donut (toggle topic/subfield/field); top institutions
   bar (toggle all/corresponding authorships); top countries bar; top authors with SVG
   country flag (country most associated with their authorships in that journal).
4. **Citing behaviour**: same layout as tab 3, from static `citing.js`; "data as of" notice
   + refresh instructions. (Link-outs limited: OpenAlex UI can't express "cites journal".)
5. **Funders** (LIVE): journal selector → funders tagged on works: works funded + unique
   grant counts (computed exactly by streaming works.grants for works with grants),
   Canadian flag on CA funders.
6. **Metadata health**: journal selector → % of works with each Crossref field, overall +
   per-year 2019+, static from `crossref.js`, with "data as of" + refresh instructions.

### Chart rules (dataviz skill)

Reference palette from the dataviz skill (8 categorical slots, light+dark validated);
26-field palette reused from UdeS (validator-tuned). One axis per chart. Legend for ≥2
series. Tooltips everywhere. Dark mode = stepped palette, OS-follow + manual toggle.
Every figure: PNG + CSV export, click-through links where expressible.

### Build scripts

- `build_journals.py` → journals.js (roster, chains, colors, ISSNs, apc_usd_by_year),
  landscape.js (topic×journal matrix for boussole), intel.js (market share, CA share,
  retractions, APC proxy), flags.js (SVG flags baked as data URIs from flagcdn)
- `build_fwci.py` → fwci.js (mean FWCI per journal-year, full history, streamed exhaustively)
- `build_peers.py` → peers.js (peer sets + peer metrics incl. streamed FWCI 2019+)
- `build_citing.py` → data-raw/citing_*.jsonl + citing.js (aggregates). Uses cites: OR-piping
  (~50 ids/call, verified). Resumable via checkpoint file.
- `build_crossref.py` → crossref.js
- `run_all.py` orchestrates; each script stamps `generated` ISO date into its .js output.

### Verified API facts (2026-08-08)

- `oa_status` group_by includes `diamond` (GEOMATICA: 121 diamond works)
- `apc_usd_by_year` exists on sources (null for many; fallback needed)
- `cites:W1|W2` OR-piping works (285 ≈ 178+108 verified)
- No mean-FWCI aggregation server-side → stream works with select=fwci
- `group_bys` (plural) param exists; `apc_sum`, `cited_by_count_sum` params exist (test in build)
- Filters: `authorships.is_corresponding`, `authorships.countries`, `grants.funder`,
  `grants.award_id`, `is_retracted` — verify exact names in build scripts, fail loudly.
- Anonymous flag: emoji flags don't render on Windows Chrome → SVG flags baked as data URIs.

## Deploy (later, when Kyle says go)

GitHub repo `kyledemes-pesonal/csp-dashboard` (public), Railway service from repo,
env var `OPENALEX_API_KEY` set in Railway. `data-raw/` gitignored.
