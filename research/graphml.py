"""
graphml.py — graph ML models for caucus link prediction, evaluated on the
same temporal protocol as baselines.py (train ≤ 111→112, test 112→113 …).

Models (all pure numpy/torch — no PyG/gensim):
  svd        — truncated SVD of the bipartite incidence at N, score = uΣv
  deepwalk   — skip-gram over uniform random walks on the N graph, dot score
               (unsupervised, per-transition; p=q=1 node2vec)
  gnn        — 2-layer GraphSAGE over the bipartite graph + node features,
               MLP decoder on (z_m, z_c); trained on transitions 105→106 …
               110→111, early-stopped on 111→112, applied to test graphs
  gnn+feats  — same, decoder additionally sees the engineered pair features

Reference rows (popularity, logistic regression) are recomputed for a
self-contained table.  Run after build_dataset.py:
  uv run python research/graphml.py
Writes research/results_graphml.md
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import svds

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
from baselines import FEATURES, evaluate  # noqa: E402
from prep_external import ICPSR_DROP, ICPSR_REMAP  # noqa: E402

SEED = 0
DEVICE = "cpu"  # graphs are tiny; kernel-launch overhead makes MPS slower
VAL_N0 = 111
PAIR_FEATS = [
    "ideo_dist", "party_match", "state_frac", "cn_frac", "cn_w", "aa",
    "vote_agree", "cosp_w", "cosp_frac",
]
MEMBER_FEATS = ["is_dem", "is_rep", "nom1", "nom2", "seniority", "n_caucuses_m"]
CAUCUS_FEATS = ["size_c", "growth_c", "age_c", "frac_dem_c", "mean_nom1_c", "std_nom1_c"]


# ---------------------------------------------------------------- graph build

def load_memberships() -> pd.DataFrame:
    ms = pd.read_parquet(HERE.parent / "public" / "data" / "memberships.parquet")
    ms = ms[~ms.apply(lambda r: (r.cong, r.member_id) in ICPSR_DROP, axis=1)].copy()
    ms["member_id"] = ms.apply(
        lambda r: ICPSR_REMAP.get((r.cong, r.member_id), r.member_id), axis=1
    )
    return ms


class TransitionGraph:
    """Bipartite incidence + node features for one transition, aligned to pairs."""

    def __init__(self, sub: pd.DataFrame, ms: pd.DataFrame):
        self.n0 = int(sub.n0.iloc[0])
        self.members = np.sort(sub.member_id.unique())
        self.caucuses = np.sort(sub.caucus_id.unique())
        self.midx = {m: i for i, m in enumerate(self.members)}
        self.cidx = {c: j for j, c in enumerate(self.caucuses)}
        self.nm, self.nc = len(self.members), len(self.caucuses)
        self.n = self.nm + self.nc

        ms0 = ms[ms.cong == self.n0]
        rows = [self.midx[m] for m, c in zip(ms0.member_id, ms0.caucus_id)
                if m in self.midx and c in self.cidx]
        cols = [self.cidx[c] for m, c in zip(ms0.member_id, ms0.caucus_id)
                if m in self.midx and c in self.cidx]
        self.M = csr_matrix(
            (np.ones(len(rows)), (rows, cols)), shape=(self.nm, self.nc)
        )

        # candidate pair index arrays aligned with `sub` row order
        self.pair_m = sub.member_id.map(self.midx).to_numpy()
        self.pair_c = sub.caucus_id.map(self.cidx).to_numpy()

        # node features (member rows then caucus rows, disjoint slots)
        mf = sub.groupby("member_id")[MEMBER_FEATS].first().reindex(self.members)
        cf = sub.groupby("caucus_id")[CAUCUS_FEATS].first().reindex(self.caucuses)
        xm = np.hstack([np.ones((self.nm, 1)), np.zeros((self.nm, 1)),
                        mf.to_numpy(), np.zeros((self.nm, len(CAUCUS_FEATS)))])
        xc = np.hstack([np.zeros((self.nc, 1)), np.ones((self.nc, 1)),
                        np.zeros((self.nc, len(MEMBER_FEATS))), cf.to_numpy()])
        self.X = np.nan_to_num(np.vstack([xm, xc]).astype(np.float32))

    def adjacency_norm(self) -> torch.Tensor:
        """Symmetric-normalized homogeneous adjacency with self-loops (sparse)."""
        M = self.M.tocoo()
        r = np.concatenate([M.row, M.col + self.nm, np.arange(self.n)])
        c = np.concatenate([M.col + self.nm, M.row, np.arange(self.n)])
        v = np.ones(len(r), dtype=np.float32)
        deg = np.bincount(r, weights=v, minlength=self.n)
        dinv = 1.0 / np.sqrt(np.maximum(deg, 1))
        v = (v * dinv[r] * dinv[c]).astype(np.float32)
        i = torch.tensor(np.vstack([r, c]), dtype=torch.long)
        return torch.sparse_coo_tensor(i, torch.tensor(v), (self.n, self.n)).coalesce()

    def neighbor_csr(self):
        """CSR over the homogeneous node set for random walks."""
        M = self.M.tocoo()
        r = np.concatenate([M.row, M.col + self.nm])
        c = np.concatenate([M.col + self.nm, M.row])
        A = csr_matrix((np.ones(len(r)), (r, c)), shape=(self.n, self.n))
        return A.indptr, A.indices


# ------------------------------------------------------------------ models

def svd_scores(g: TransitionGraph, k: int = 32) -> np.ndarray:
    k = min(k, min(g.M.shape) - 1)
    u, s, vt = svds(g.M.astype(float), k=k)
    R = (u * s) @ vt
    return R[g.pair_m, g.pair_c]


def deepwalk_scores(
    g: TransitionGraph, rng: np.random.Generator, dim=64, n_walks=10,
    length=30, window=5, neg=5, epochs=3, batch=8192,
) -> np.ndarray:
    indptr, indices = g.neighbor_csr()
    deg = np.diff(indptr)
    starts = np.repeat(np.nonzero(deg > 0)[0], n_walks)
    W = np.empty((len(starts), length), dtype=np.int64)
    W[:, 0] = starts
    for t in range(1, length):
        cur = W[:, t - 1]
        off = (rng.random(len(cur)) * deg[cur]).astype(np.int64)
        W[:, t] = indices[indptr[cur] + off]

    centers, contexts = [], []
    for d in range(1, window + 1):
        centers += [W[:, :-d].ravel(), W[:, d:].ravel()]
        contexts += [W[:, d:].ravel(), W[:, :-d].ravel()]
    centers = np.concatenate(centers)
    contexts = np.concatenate(contexts)

    freq = np.bincount(W.ravel(), minlength=g.n).astype(np.float64) ** 0.75
    neg_probs = torch.tensor(freq / freq.sum(), dtype=torch.float32)

    torch.manual_seed(SEED)
    emb_in = nn.Embedding(g.n, dim)
    emb_out = nn.Embedding(g.n, dim)
    nn.init.normal_(emb_in.weight, std=0.05)
    nn.init.normal_(emb_out.weight, std=0.05)
    opt = torch.optim.Adam(list(emb_in.parameters()) + list(emb_out.parameters()), lr=0.01)

    n_pairs = len(centers)
    for _ in range(epochs):
        perm = rng.permutation(n_pairs)
        for lo in range(0, n_pairs, batch):
            sel = perm[lo: lo + batch]
            u = emb_in(torch.from_numpy(centers[sel]))
            v = emb_out(torch.from_numpy(contexts[sel]))
            vneg = emb_out(torch.multinomial(neg_probs, len(sel) * neg, replacement=True)
                           .view(len(sel), neg))
            pos = F.logsigmoid((u * v).sum(-1))
            negl = F.logsigmoid(-(vneg @ u.unsqueeze(-1)).squeeze(-1)).sum(-1)
            loss = -(pos + negl).mean()
            opt.zero_grad(); loss.backward(); opt.step()

    Z = emb_in.weight.detach().numpy()
    had = Z[g.pair_m] * Z[g.pair_c + g.nm]
    return had.sum(-1), had


class Sage(nn.Module):
    def __init__(self, d_in: int, d_pair: int, hidden: int = 64, dropout: float = 0.3):
        super().__init__()
        self.self1 = nn.Linear(d_in, hidden)
        self.nei1 = nn.Linear(d_in, hidden)
        self.self2 = nn.Linear(hidden, hidden)
        self.nei2 = nn.Linear(hidden, hidden)
        self.dropout = dropout
        self.dec = nn.Sequential(
            nn.Linear(hidden * 3 + d_pair, 128), nn.ReLU(),
            nn.Dropout(dropout), nn.Linear(128, 1),
        )

    def encode(self, X, A):
        h = F.relu(self.self1(X) + self.nei1(torch.sparse.mm(A, X)))
        h = F.dropout(h, self.dropout, self.training)
        return self.self2(h) + self.nei2(torch.sparse.mm(A, h))

    def forward(self, X, A, mi, ci, pair_x):
        z = self.encode(X, A)
        zm, zc = z[mi], z[ci]
        parts = [zm, zc, zm * zc]
        if pair_x is not None:
            parts.append(pair_x)
        return self.dec(torch.cat(parts, -1)).squeeze(-1)


def train_gnn(graphs, pairs, use_pair_feats: bool, x_stats, pf_stats):
    torch.manual_seed(SEED)
    d_pair = len(PAIR_FEATS) if use_pair_feats else 0
    model = Sage(graphs[105].X.shape[1], d_pair)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)

    def tensors(n0):
        g = graphs[n0]
        sub = pairs[pairs.n0 == n0]
        X = torch.tensor((g.X - x_stats[0]) / x_stats[1])
        A = g.adjacency_norm()
        mi = torch.from_numpy(g.pair_m)
        ci = torch.from_numpy(g.pair_c + g.nm)
        px = None
        if use_pair_feats:
            px = torch.tensor(
                ((sub[PAIR_FEATS].to_numpy() - pf_stats[0]) / pf_stats[1]).astype(np.float32)
            )
        y = torch.tensor(sub.label.to_numpy(), dtype=torch.float32)
        return X, A, mi, ci, px, y

    train_n0 = [n for n in graphs if n < VAL_N0 and n in set(pairs.n0)]
    cache = {n: tensors(n) for n in list(graphs)}
    best_ap, best_state, patience = -1.0, None, 0
    from sklearn.metrics import average_precision_score

    for epoch in range(1000):
        model.train()
        for n0 in train_n0:
            X, A, mi, ci, px, y = cache[n0]
            w = (len(y) - y.sum()) / y.sum()
            logits = model(X, A, mi, ci, px)
            loss = F.binary_cross_entropy_with_logits(logits, y, pos_weight=w)
            opt.zero_grad(); loss.backward(); opt.step()
        model.eval()
        with torch.no_grad():
            X, A, mi, ci, px, y = cache[VAL_N0]
            ap = average_precision_score(y.numpy(), model(X, A, mi, ci, px).numpy())
        if ap > best_ap:
            best_ap, patience = ap, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 75:
                break
    model.load_state_dict(best_state)
    model.eval()

    scores = {}
    with torch.no_grad():
        for n0 in graphs:
            X, A, mi, ci, px, _ = cache[n0]
            scores[n0] = model(X, A, mi, ci, px).numpy()
    return scores, best_ap, epoch


# -------------------------------------------------------------------- main

def main():
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    pairs = pd.read_parquet(HERE / "pairs.parquet")
    pairs[FEATURES] = pairs[FEATURES].fillna(pairs[FEATURES].median())
    ms = load_memberships()

    graphs = {n0: TransitionGraph(pairs[pairs.n0 == n0], ms)
              for n0 in sorted(pairs.n0.unique())}
    test = pairs[pairs.n1 > 112].copy()
    train = pairs[pairs.n1 <= 112]

    # unsupervised scores per transition
    col = np.empty(len(pairs))
    for n0, g in graphs.items():
        col[pairs.n0.to_numpy() == n0] = svd_scores(g)
    pairs["score_svd"] = col
    print(f"score_svd done ({time.time()-t0:.0f}s)")

    col = np.empty(len(pairs))
    dw_had = np.empty((len(pairs), 64), dtype=np.float32)
    for n0, g in graphs.items():
        mask = pairs.n0.to_numpy() == n0
        col[mask], dw_had[mask] = deepwalk_scores(g, rng)
    pairs["score_dw"] = col
    print(f"score_dw done ({time.time()-t0:.0f}s)")
    test = pairs[pairs.n1 > 112].copy()

    # gnn (feature standardization from train transitions only)
    x_all = np.vstack([graphs[n].X for n in graphs if n <= VAL_N0])
    x_stats = (x_all.mean(0, keepdims=True).astype(np.float32),
               (x_all.std(0, keepdims=True) + 1e-6).astype(np.float32))
    pf = train[PAIR_FEATS].to_numpy()
    pf_stats = (pf.mean(0, keepdims=True), pf.std(0, keepdims=True) + 1e-6)

    rows = []
    for name, upf in [("gnn (GraphSAGE)", False), ("gnn + pair features", True)]:
        scores, val_ap, epochs = train_gnn(graphs, pairs, upf, x_stats, pf_stats)
        col = np.empty(len(test))
        tn0 = test.n0.to_numpy()
        for n0 in np.unique(tn0):
            col[tn0 == n0] = scores[n0][pairs[pairs.n0 == n0].index.isin(test.index)]
        test[f"score_{name}"] = col
        rows.append({"model": name, **evaluate(test, f"score_{name}")})
        print(f"{name}: val AP {val_ap:.3f} @ epoch {epochs} ({time.time()-t0:.0f}s)")

    # reference + unsupervised rows
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    lr = make_pipeline(StandardScaler(),
                       LogisticRegression(max_iter=2000, class_weight="balanced"))
    lr.fit(train[FEATURES], train.label)
    test["score_lr"] = lr.predict_proba(test[FEATURES])[:, 1]

    # supervised use of deepwalk embeddings: features + hadamard(z_m, z_c)
    tr_mask = (pairs.n1 <= 112).to_numpy()
    te_mask = (pairs.n1 > 112).to_numpy()
    Xtr = np.hstack([train[FEATURES].to_numpy(), dw_had[tr_mask]])
    Xte = np.hstack([test[FEATURES].to_numpy(), dw_had[te_mask]])
    lr_emb = make_pipeline(StandardScaler(),
                           LogisticRegression(max_iter=3000, class_weight="balanced"))
    lr_emb.fit(Xtr, train.label)
    test["score_lr_emb"] = lr_emb.predict_proba(Xte)[:, 1]
    print(f"lr+emb done ({time.time()-t0:.0f}s)")

    ref = [("popularity (caucus size)", "size_c"),
           ("logistic regression (features)", "score_lr"),
           ("svd embedding (k=32)", "score_svd"),
           ("deepwalk (dot)", "score_dw"),
           ("LR features + deepwalk hadamard", "score_lr_emb")]
    rows = [{"model": n, **evaluate(test, c)} for n, c in ref] + rows

    lines = [
        "# Caucus link prediction — graph ML results",
        "",
        "Same protocol as results_baselines.md: test = transitions 112→113 … 115→116,",
        "metrics averaged over transitions. GNNs train on 105→106 … 110→111 with",
        f"early stopping on {VAL_N0}→{VAL_N0+1} (val AP). Seed {SEED}, single run.",
        "",
        "| model | ROC-AUC | PR-AUC | recall@10 |",
        "|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| {r['model']} | {r['auc']:.3f} | {r['ap']:.3f} | {r['r10']:.3f} |")

    from sklearn.metrics import average_precision_score, roc_auc_score
    lines += ["", "## Per-transition (ROC-AUC / PR-AUC)", "",
              "| transition | base rate | popularity | LR | gnn+feats |", "|---|---|---|---|---|"]
    for n0, g in test.groupby("n0"):
        cells = [
            f"{roc_auc_score(g.label, g[c]):.3f} / {average_precision_score(g.label, g[c]):.3f}"
            for c in ["size_c", "score_lr", "score_gnn + pair features"]
        ]
        lines.append(
            f"| {n0}→{n0+1} | {g.label.mean():.2%} | " + " | ".join(cells) + " |"
        )
    lines += ["", "Limitations: single seed; GNN early-stops on 111→112 val AP; ",
              "deepwalk/SVD are per-transition (no cross-congress alignment needed for scoring)."]
    out = HERE / "results_graphml.md"
    out.write_text("\n".join(lines) + "\n")
    print(pd.DataFrame(rows).round(3).to_string(index=False))
    print(f"wrote {out} ({time.time()-t0:.0f}s total)")


if __name__ == "__main__":
    main()
