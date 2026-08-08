# CSP Board Intelligence Dashboard

A single-page dashboard on **Canadian Science Publishing**'s journal portfolio, built on
[OpenAlex](https://openalex.org) and [Crossref](https://www.crossref.org) open data.

Six tabs: **Portfolio** (all-journal comparison, disciplinary landscape, market share,
Canadian-author share, retractions, APC proxy) · **Benchmarking** (each CSP journal vs the
10 journals where Canadian researchers publish most in its subfields) · **Publishing
behaviour** (live per-journal breakdowns) · **Citation behaviour** (static snapshot of all
works citing CSP works published 2019+) · **Funders** (live, with unique-grant counts) ·
**Metadata health** (Crossref record completeness).

Every figure exports as PNG and CSV, and most marks click through to the OpenAlex UI with
the matching filters.

## Run locally

```bash
node server.js
```

Then open http://localhost:3000. The server serves the static page and proxies `/api/*` to
`api.openalex.org`, injecting the key from the `OPENALEX_API_KEY` environment variable
(fallback for local dev: `../openalex-walden/.env`). The key never reaches the browser;
link-outs to openalex.org are plain anonymous links.

## Refresh the static data

```bash
py -3 build/run_all.py
```

or any single script (each stamps a `generated` date the page displays):

| script | output | what |
|---|---|---|
| `build_journals.py` | journals.js, flags.js | roster, successor chains, APCs, SVG flags |
| `build_metrics.py` | metrics.js, landscape.js | full-history per-journal metrics + topic landscape |
| `build_intel.py` | intel.js | market share, Canadian-author share |
| `build_peers.py` | peers.js | benchmarking peer sets + peer metrics |
| `build_citing.py` | citing.js (+ data-raw/) | citing-works snapshot (full raw JSONL in `data-raw/citing/`, gitignored) |
| `build_crossref.py` | crossref.js | Crossref metadata coverage |

Heavy steps cache into `data-raw/` and resume; delete the relevant cache files to force a
full refetch. Scripts read the OpenAlex key from `OPENALEX_API_KEY` or
`../openalex-walden/.env`.

## Deploy (Railway)

1. Push this repo to GitHub (`data-raw/` stays local via .gitignore).
2. Railway → New Project → Deploy from GitHub repo. It autodetects `npm start`.
3. Set the `OPENALEX_API_KEY` environment variable in the Railway service.

That's it — no build step, no dependencies.
