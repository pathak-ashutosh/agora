# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

**agora** — local research tool for exploring U.S. congressional caucus networks.
Single-page React app, no backend. All analytics happen in the browser via
DuckDB-WASM querying Parquet files.

## Stack

- **Vite + React 19 + TypeScript** (strict, `@/*` alias → `src/*`)
- **Tailwind v4** (`@theme` directive, dark palette in `src/index.css`)
- **DuckDB-WASM** — in-browser SQL over Parquet, served from `public/data/`
- **Sigma.js v3 + Graphology** — WebGL graph rendering, ForceAtlas2 layout, Louvain communities
- **Observable Plot** — small charts (ideology, growth, histograms)
- **Zustand** — app state (`src/lib/store.ts`)
- **Hand-rolled router** (`src/lib/router.tsx`) — 4 static routes, no params
- **Python (uv + pandas + pyarrow)** — one-shot CSV→Parquet prep (`prep_data.py`)

## Layout

```
agora/
├── DATA/                  # Raw CSVs (DO NOT TOUCH — preserved from original)
├── public/data/*.parquet  # Generated, gitignored — served as static assets
├── prep_data.py           # CSV → Parquet pipeline
├── pyproject.toml         # uv project for prep_data.py
├── src/
│   ├── App.tsx            # DuckDB warmup + route switch
│   ├── main.tsx
│   ├── index.css          # Tailwind v4 + design tokens
│   ├── lib/
│   │   ├── duckdb.ts      # singleton + query()/queryOne()
│   │   ├── use-query.ts   # React hook over query()
│   │   ├── store.ts       # zustand: cong, filters, selection, expanded
│   │   ├── router.tsx     # useRoute() + navigate()
│   │   ├── graph-builder.ts  # SQL → Graphology graph + layout
│   │   ├── metadata.ts    # cached fetch of /data/metadata.json
│   │   └── utils.ts       # cn(), partyInfo(), formatCongress()
│   ├── components/
│   │   ├── shell/         # Sidebar, Topbar, NavLink
│   │   ├── ui/            # Panel, Toggle, PlotChart
│   │   ├── graph/         # SigmaGraph
│   │   └── network/       # NetworkFilters, GraphStats, NodeDetail
│   └── scenes/
│       ├── NetworkExplorer.tsx
│       ├── MemberProfile.tsx
│       ├── CaucusProfile.tsx
│       └── Compare.tsx
```

## Setup & run

First time only — generate Parquet files:
```bash
uv sync
uv run python prep_data.py   # writes public/data/*.parquet + metadata.json
```

Dev / build:
```bash
npm install
npm run dev      # vite dev server, default port 5173
npm run build    # tsc -b && vite build
```

No backend. Data engine boots in-browser on first paint (~1s).

## Data model

Three Parquet files (generated from `DATA/` CSVs):

- **members.parquet** — `member_id, cong, mc_name, party, state_abv, cd, nominate`
- **caucuses.parquet** — `caucus_id, cong, caucus_name`
- **memberships.parquet** — `member_id, caucus_id, cong` (member ↔ caucus join)

Registered as DuckDB views named `members`, `caucuses`, `memberships`.

### External data layer (research extension)

`scripts/fetch_external.sh` downloads ~900MB raw into `EXTERNAL/` (gitignored):
Voteview (members/votes/rollcalls, House 103–116), ProPublica bulk bill JSON
(103–116, sponsor+cosponsor per bill), congress-legislators ID crosswalk.
`prep_external.py` converts to Parquet in `public/data/`:

- **members_voteview.parquet** — `cong, icpsr, bioguide_id, party_code, nominate_dim1/2, born` (fills all NOMINATE gaps, incl. cong 104)
- **bills.parquet** — House bills (hr/hres/hjres/hconres), `sponsor_icpsr`, title, top_subject, status (~107k)
- **cosponsorships.parquet** — `cong, bill_id, icpsr, role (sponsor|cosponsor), sponsored_at, original, withdrawn` (~1.9M rows)
- **votes.parquet** — `cong, rollnumber, icpsr, cast_code` (~7.8M rows)
- **rollcalls.parquet** — rollcall metadata incl. `bill_id` linkage

`member_id` in members.parquet IS an ICPSR id — joins directly to `icpsr`
everywhere. Known quirks: non-voting delegates have no ICPSR (dropped, ~1.2% of
sponsorship rows); 3 bad ids in DATA/ caucus files (Hunter Jr. cong 111
14835→20946, D. Dingell cong 114 2605→21522, Obama cong 112 99911→drop) — see
`ICPSR_REMAP`/`ICPSR_DROP` in prep_external.py.

Metadata sidecar (`metadata.json`): list of congresses, congresses with DW-NOMINATE,
party codes, etc. Loaded once via `loadMetadata()`.

### Congresses

103, 105–116 (104 missing in source data). DW-NOMINATE only present in 106–110, 113–114
— UI shows "no DW-NOMINATE in source data" where unavailable.

### Party codes (ICPSR)

- 100 = Dem · 200 = Rep · 328/329 = Ind/Other

## Research layer (`research/`)

Caucus link prediction: predict which (member, caucus) memberships appear at
congress N+1 given data ≤ N. Temporal split: train ≤ 111→112, test 112→113 …
115→116. Pipeline:

- `research/build_dataset.py` — builds `research/pairs.parquet` (1.19M candidate
  pairs, 35k joins, 22 leakage-free features: member/caucus attrs, bipartite
  common-neighbor + Adamic-Adar, cosponsorship ties, roll-call agreement)
- `research/baselines.py` — heuristics + LR + HistGB → `research/results_baselines.md`
- `research/graphml.py` — SVD / DeepWalk (hand-rolled skip-gram) / GraphSAGE
  (pure torch, no PyG) → `research/results_graphml.md`

Current headline results (honest): caucus-size popularity is the strongest
single heuristic (PR-AUC .079, R@10 .119); LR and GraphSAGE tie at AUC ~.69
but don't beat popularity on PR-AUC; plain common-neighbors saturates (median
cn_frac .98 — affiliation net too dense); DeepWalk/SVD embeddings add ~nothing.
Model ranking is unstable across test transitions (election waves shift base
rate 0.6–4.3%). Finding so far: caucus joining is popularity-dominated at this
granularity. Single seed — do multi-seed before claiming anything in writing.

## Routes

| Path        | Scene             | Notes                                              |
|-------------|-------------------|----------------------------------------------------|
| `/`         | NetworkExplorer   | 3-pane: filters · sigma graph · node detail        |
| `/member`   | MemberProfile     | search; `?id=` for detail                          |
| `/caucus`   | CaucusProfile     | search; `?id=` for detail                          |
| `/compare`  | Compare           | side-by-side member↔member or caucus↔caucus diff   |

Router is 20 lines (`src/lib/router.tsx`). Navigate with `navigate('/foo')` or
plain `<a href="/foo" onClick={...pushState}>`.

## Graph builder (`src/lib/graph-builder.ts`)

`buildGraph({cong, mode, edgeKind, topN, parties, states, minEdgeWeight, expanded})`:

1. SQL self-join over `memberships` to compute degree (top-N by degree per filter).
2. Add expanded nodes' neighbors.
3. Edge generation:
   - **co-membership** (default): SQL self-join `m1.member_id < m2.member_id`
   - **ideology similarity**: JS pass over node nominate scores
4. Circular initial layout → ForceAtlas2 → Louvain community assignment.

Node IDs are namespaced: `m:<id>` for members, `c:<id>` for caucuses.

## Conventions

- **Styling**: Tailwind classes only. CSS variables in `index.css` for dark palette
  (`--color-bg`, `--color-text-muted`, `--color-dem`, etc.).
- **Queries**: always go through `useQuery()` (React) or `query()` (imperative).
  Pass `null` SQL to skip — keeps the hook gated on dependencies.
- **State**: Zustand store for cross-scene state (filter selections, current cong,
  expanded set). Local `useState` for everything else.
- **No backend, no auth, no API layer.** If a feature seems to need one, it doesn't.
- **DATA/ is read-only.** Original CSVs stay where they are.

## Known limits

- DW-NOMINATE coverage is partial (see Congresses section).
- DuckDB WASM bundle is ~40MB ungzipped — first-load cost. Cached after that.
- Vite reports the main JS chunk >500KB; not splitting yet (single-user local tool).
