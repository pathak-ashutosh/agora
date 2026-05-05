# agora

Local research tool for exploring U.S. congressional caucus networks.
Members, caucuses, memberships, and DW-NOMINATE ideology scores across
congresses 103–116 — all queried in the browser, no backend.

## What's in it

- **Network Explorer** — interactive Sigma/WebGL graph of members or caucuses,
  filtered by congress, party, state. Top-N by degree, double-click to expand
  a node's neighborhood. Edges are co-membership or ideology similarity.
  Louvain community colors. Export the current view as PNG.
- **Insights** — precomputed analytics per congress: top-20 bridge members by
  betweenness centrality, most bipartisan caucuses (D/R balance × log size),
  surprising cross-party alliances (high co-membership despite ideological
  distance).
- **Geography** — tile-grid cartogram of state delegations. Toggle between
  caucus participation, delegation ideology (DW-NOMINATE), ideological
  cohesion, and delegation size. Click a state to filter the network.
- **Member Profile** — ideology trajectory, caucus count, bridge score
  (betweenness over time), cross-party caucus share, current caucus list,
  nearest co-members.
- **Caucus Profile** — growth + party mix, ideology drift (mean ± 1σ over
  time), bipartisanship over time, lifecycle badges (peak congress, avg
  bipartisan %), roster.
- **Embedding Space** — 2D UMAP projection of a 32-dim Truncated-SVD
  embedding of the member × caucus matrix. Each point is a member; proximity
  means similar caucus portfolios. Partisan structure emerges without
  supervision.
- **Compare** — pick two members or two caucuses. For members: ideology
  trajectory overlay + three-column caucus diff. For caucuses: size +
  bipartisan overlays + member diff.

**ML baked into profiles:**
- MemberProfile shows **similar members** (cosine over SVD embeddings) and
  **predicted caucuses** (link prediction — caucuses a member is not in but
  the model scores highly for them).
- CaucusProfile shows **similar caucuses** (same embedding space).
- Caucus search has a **semantic mode** — type phrases like "veterans
  healthcare" or "agriculture policy" and a MiniLM sentence model embeds the
  query client-side, cosine-ranks all caucus names. Model weights stream from
  the HuggingFace CDN on first use; caucus-name embeddings are computed once
  and cached in IndexedDB.

**Shareable URLs.** Every filter, selection, and comparison is encoded in the
URL. Hit the Share button to copy a link; opening it restores the exact view.

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

Core Parquet files, generated from the CSVs in `DATA/`:

| Table         | Columns                                                        |
|---------------|----------------------------------------------------------------|
| `members`     | `member_id, cong, mc_name, party, state_abv, cd, nominate`     |
| `caucuses`    | `caucus_id, cong, caucus_name`                                 |
| `memberships` | `member_id, caucus_id, cong`                                   |

Derived analytics (precomputed once by `prep_data.py`, read as views):

| Table               | Per-row unit        | Notable columns                                                             |
|---------------------|---------------------|-----------------------------------------------------------------------------|
| `member_stats`      | (cong, member_id)   | `degree, betweenness, cross_party_share, mean_peer_nominate, peer_count`    |
| `caucus_stats`      | (cong, caucus_id)   | `size, dems, reps, other, bipartisan_score, mean/median/std_nominate`       |
| `caucus_lifecycle`  | caucus_id           | `canonical_name, first/last/peak_cong, peak_size, mean_bipartisan`          |
| `surprising_pairs`  | (cong, pair)        | cross-party `shared` × `ideology_gap`, top 200 per congress                 |
| `state_stats`       | (cong, state_abv)   | `delegation_size, party mix, mean/std_nominate, cohesion, mean_caucus_count`|
| `member_embeddings` | (member_id, d, v)   | 32-d Truncated-SVD of pooled member × caucus matrix (L2-normalized)         |
| `caucus_embeddings` | (caucus_id, d, v)   | same factorization, caucus side                                             |
| `similar_members`   | (member_id, rank)   | top-10 cosine neighbors per member                                          |
| `similar_caucuses`  | (caucus_id, rank)   | top-10 cosine neighbors per caucus                                          |
| `member_projection` | member_id           | 2D UMAP coordinates over member embeddings                                  |
| `link_predictions`  | (cong, member_id)   | top-10 caucus recommendations per member per congress                       |

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
    Insights.tsx
    Geography.tsx
    EmbeddingSpace.tsx
    MemberProfile.tsx
    CaucusProfile.tsx
    Compare.tsx
  lib/
    nl-search.ts          # Transformers.js MiniLM + IndexedDB cache for semantic caucus search
    ...
```

See `CLAUDE.md` for deeper architecture notes.

## Extending to new congresses

Drop new `mc_attributes*.csv`, `caucus_attributes*.csv`, and
`caucus_membership*LONG.csv` files into `DATA/`, re-run
`uv run python prep_data.py`, refresh the browser. No migrations.
