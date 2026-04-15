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

Metadata sidecar (`metadata.json`): list of congresses, congresses with DW-NOMINATE,
party codes, etc. Loaded once via `loadMetadata()`.

### Congresses

103, 105–116 (104 missing in source data). DW-NOMINATE only present in 106–110, 113–114
— UI shows "no DW-NOMINATE in source data" where unavailable.

### Party codes (ICPSR)

- 100 = Dem · 200 = Rep · 328/329 = Ind/Other

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
