# agora

Local research tool for exploring U.S. congressional caucus networks.
Members, caucuses, memberships, and DW-NOMINATE ideology scores across
congresses 103–116 — all queried in the browser, no backend.

## What's in it

- **Network Explorer** — interactive Sigma/WebGL graph of members or caucuses,
  filtered by congress, party, state. Top-N by degree, double-click to expand
  a node's neighborhood. Edges are co-membership or ideology similarity.
  Louvain community colors.
- **Member Profile** — career trajectory (DW-NOMINATE line chart), caucus
  count over time, current caucus list, nearest co-members by shared caucuses.
- **Caucus Profile** — growth + party-mix over time, ideology histogram,
  current roster.
- **Compare** — pick two members or two caucuses, get a three-column set diff
  (only A · both · only B).

## Stack

Vite + React 19 + TypeScript · Tailwind v4 · DuckDB-WASM (Parquet in-browser) ·
Sigma.js + Graphology · Observable Plot · Zustand · Python (uv + pandas + pyarrow)
for one-shot CSV → Parquet prep.

No backend, no auth, no API. The whole app is static files + a WebAssembly
SQL engine. First load boots DuckDB (~40MB wasm, cached after that) and
registers three Parquet files as views.

## Setup

One-time — generate Parquet files from the raw CSVs in `DATA/`:

```bash
uv sync
uv run python prep_data.py
```

This writes `public/data/{members,caucuses,memberships}.parquet` +
`metadata.json` (gitignored).

Then:

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

## Data

Three Parquet files generated from the CSVs in `DATA/`:

| Table         | Columns                                                        |
|---------------|----------------------------------------------------------------|
| `members`     | `member_id, cong, mc_name, party, state_abv, cd, nominate`     |
| `caucuses`    | `caucus_id, cong, caucus_name`                                 |
| `memberships` | `member_id, caucus_id, cong`                                   |

13 congresses (103, 105–116 — 104 missing in source). ~1.3k members,
~1.1k caucus entries, ~112k memberships. DW-NOMINATE coverage is partial
(congresses 106–110, 113–114); the UI degrades gracefully where absent.

Party codes are ICPSR: `100 = Dem · 200 = Rep · 328/329 = Ind/Other`.

`DATA/` is read-only — the original CSVs stay put. `public/data/*.parquet`
is regenerable output and not tracked.

## Layout

```
prep_data.py           # CSV → Parquet pipeline (pandas + pyarrow)
src/
  App.tsx              # DuckDB warmup + route switch
  lib/
    duckdb.ts          # wasm singleton + query()
    graph-builder.ts   # SQL → Graphology graph + layout
    store.ts           # zustand state
    router.tsx         # tiny hand-rolled router
  components/
    shell/ ui/ graph/ network/
  scenes/
    NetworkExplorer.tsx
    MemberProfile.tsx
    CaucusProfile.tsx
    Compare.tsx
```

See `CLAUDE.md` for deeper architecture notes.

## Extending to new congresses

Drop new `mc_attributes*.csv`, `caucus_attributes*.csv`, and
`caucus_membership*LONG.csv` files into `DATA/`, re-run
`uv run python prep_data.py`, refresh the browser. No migrations.
