"""
temporal.py — history-aware models on the CONDITIONAL caucus-choice task.

Reframing (kills the popularity confound of the global task): among members
who join ≥1 new caucus at N+1, rank each member's candidate caucuses.
Metrics: MRR (first relevant), recall@5, recall@10 — macro over members,
then averaged over test transitions. Pooled ROC-AUC/PR-AUC kept for
continuity with results_baselines.md / results_graphml.md.

History features (visible only to temporal models):
  was_before      — m was a member of c in some congress < N (rejoin signal)
  n_before        — how many past congresses m was in c
  gap_since       — congresses since m last belonged to c
  m_joins_prev    — caucuses m joined at the previous transition (churn)
  m_no_prev       — m was not serving at the previous congress
  c_new_frac_prev — fraction of c's members at N who are new since N-1
                    (caucus "openness" to recruits)

Temporal GNN: shared GraphSAGE encoder applied to each congress graph in a
3-congress window (global node index, icpsr/caucus_id stable), masked GRU
across time, MLP decoder on [h_m, h_c, h_m⊙h_c, pair+history features].
3 seeds, mean±std. Same protocol: train 105→106 … 110→111, val 111→112,
test 112→113 … 115→116.

Run after build_dataset.py:  uv run python research/temporal.py
Writes research/results_temporal.md
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
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from baselines import FEATURES  # noqa: E402
from graphml import PAIR_FEATS, load_memberships  # noqa: E402

CONGS = [103] + list(range(105, 117))
VAL_N0 = 111
HIST = ["was_before", "n_before", "gap_since", "m_joins_prev", "m_no_prev",
        "c_new_frac_prev"]
SEEDS = [0, 1, 2]
WINDOW = 3


def prev_cong(n: int) -> int:
    return CONGS[CONGS.index(n) - 1]


# ------------------------------------------------------- history features

def add_history_features(pairs: pd.DataFrame, ms: pd.DataFrame) -> pd.DataFrame:
    mem_congs: dict[tuple[int, int], list[int]] = {}
    for r in ms.itertuples():
        mem_congs.setdefault((r.member_id, r.caucus_id), []).append(r.cong)

    member_sets = {
        (c, m): set(g.caucus_id)
        for (c, m), g in ms.groupby(["cong", "member_id"])
    }
    caucus_sets = {
        (c, cc): set(g.member_id)
        for (c, cc), g in ms.groupby(["cong", "caucus_id"])
    }

    was, nb, gap = [], [], []
    for m, c, n0 in zip(pairs.member_id, pairs.caucus_id, pairs.n0):
        past = [t for t in mem_congs.get((m, c), []) if t < n0]
        was.append(float(bool(past)))
        nb.append(float(len(past)))
        gap.append(float(n0 - max(past)) if past else 0.0)
    pairs["was_before"], pairs["n_before"], pairs["gap_since"] = was, nb, gap

    joins_prev, no_prev = [], []
    seen: dict[tuple[int, int], tuple[float, float]] = {}
    for m, n0 in zip(pairs.member_id, pairs.n0):
        key = (m, n0)
        if key not in seen:
            p = prev_cong(n0)
            cur = member_sets.get((n0, m), set())
            old = member_sets.get((p, m))
            seen[key] = (
                (float(len(cur - old)), 0.0) if old is not None else (0.0, 1.0)
            )
        j, npv = seen[key]
        joins_prev.append(j)
        no_prev.append(npv)
    pairs["m_joins_prev"], pairs["m_no_prev"] = joins_prev, no_prev

    cseen: dict[tuple[int, int], float] = {}
    newfrac = []
    for c, n0 in zip(pairs.caucus_id, pairs.n0):
        key = (c, n0)
        if key not in cseen:
            p = prev_cong(n0)
            cur = caucus_sets.get((n0, c), set())
            old = caucus_sets.get((p, c), set())
            cseen[key] = len(cur - old) / max(len(cur), 1)
        newfrac.append(cseen[key])
    pairs["c_new_frac_prev"] = newfrac
    return pairs


# ------------------------------------------------------------- evaluation

def conditional_metrics(df: pd.DataFrame, col: str) -> dict[str, float]:
    """MRR / R@5 / R@10 macro over joining members, averaged over transitions."""
    per_t = []
    for _, tg in df.groupby("n0"):
        mrr, r5, r10 = [], [], []
        for _, g in tg.groupby("member_id"):
            npos = int(g.label.sum())
            if npos == 0:
                continue
            order = g.label.to_numpy()[np.argsort(-g[col].to_numpy(), kind="stable")]
            first = int(np.argmax(order)) + 1
            mrr.append(1.0 / first)
            r5.append(order[:5].sum() / npos)
            r10.append(order[:10].sum() / npos)
        per_t.append((np.mean(mrr), np.mean(r5), np.mean(r10)))
    a = np.mean(per_t, axis=0)
    return {"mrr": a[0], "r5": a[1], "r10": a[2]}


def pooled_metrics(df: pd.DataFrame, col: str) -> dict[str, float]:
    aucs = [roc_auc_score(g.label, g[col]) for _, g in df.groupby("n0")]
    aps = [average_precision_score(g.label, g[col]) for _, g in df.groupby("n0")]
    return {"auc": float(np.mean(aucs)), "ap": float(np.mean(aps))}


def row(name, test, col):
    return {"model": name, **pooled_metrics(test, col), **conditional_metrics(test, col)}


# ------------------------------------------------------------ temporal gnn

class TemporalSage(nn.Module):
    def __init__(self, d_node: int, d_pair: int, hidden: int = 64, dropout: float = 0.3):
        super().__init__()
        self.self1 = nn.Linear(d_node, hidden)
        self.nei1 = nn.Linear(d_node, hidden)
        self.self2 = nn.Linear(hidden, hidden)
        self.nei2 = nn.Linear(hidden, hidden)
        self.gru = nn.GRUCell(hidden, hidden)
        self.dropout = dropout
        self.dec = nn.Sequential(
            nn.Linear(hidden * 3 + d_pair, 128), nn.ReLU(),
            nn.Dropout(dropout), nn.Linear(128, 1),
        )

    def encode_step(self, X, A):
        h = F.relu(self.self1(X) + self.nei1(torch.sparse.mm(A, X)))
        h = F.dropout(h, self.dropout, self.training)
        return self.self2(h) + self.nei2(torch.sparse.mm(A, h))

    def embed(self, steps):
        h = None
        for X, A, active in steps:  # oldest → newest congress in window
            z = self.encode_step(X, A)
            h_new = self.gru(z, h if h is not None else torch.zeros_like(z))
            h = h_new if h is None else torch.where(active.unsqueeze(1), h_new, h)
        return h

    def forward(self, steps, mi, ci, pair_x):
        h = self.embed(steps)
        zm, zc = h[mi], h[ci]
        return self.dec(torch.cat([zm, zc, zm * zc, pair_x], -1)).squeeze(-1)


def build_snapshots(ms: pd.DataFrame, pairs: pd.DataFrame):
    """Global node index + per-congress normalized adjacency, features, mask."""
    members = np.sort(np.union1d(ms.member_id.unique(), pairs.member_id.unique()))
    caucuses = np.sort(np.union1d(ms.caucus_id.unique(), pairs.caucus_id.unique()))
    midx = {m: i for i, m in enumerate(members)}
    cidx = {c: len(members) + j for j, c in enumerate(caucuses)}
    n = len(members) + len(caucuses)

    snaps = {}
    for t in CONGS:
        sub = ms[ms.cong == t]
        r = np.array([midx[m] for m in sub.member_id])
        c = np.array([cidx[x] for x in sub.caucus_id])
        rows = np.concatenate([r, c, np.arange(n)])
        cols = np.concatenate([c, r, np.arange(n)])
        deg = np.bincount(rows, minlength=n).astype(np.float32)
        dinv = 1.0 / np.sqrt(np.maximum(deg, 1))
        v = (np.ones(len(rows), dtype=np.float32) * dinv[rows] * dinv[cols])
        A = torch.sparse_coo_tensor(
            torch.tensor(np.vstack([rows, cols]), dtype=torch.long),
            torch.tensor(v), (n, n),
        ).coalesce()
        active = np.zeros(n, dtype=bool)
        active[r] = True
        active[c] = True
        X = np.zeros((n, 4), dtype=np.float32)
        X[: len(members), 0] = 1.0
        X[len(members):, 1] = 1.0
        X[:, 2] = np.log1p(np.maximum(deg - 1, 0))  # exclude self-loop
        X[:, 3] = active
        snaps[t] = (torch.tensor(X), A, torch.tensor(active))
    return snaps, midx, cidx


def train_temporal_gnn(pairs, ms, feat_cols, seed, return_artifacts=False):
    torch.manual_seed(seed)
    np.random.seed(seed)
    snaps, midx, cidx = build_snapshots(ms, pairs)

    train_mask = pairs.n1 <= 112
    fstats = (
        pairs.loc[train_mask, feat_cols].mean().to_numpy(),
        pairs.loc[train_mask, feat_cols].std().to_numpy() + 1e-6,
    )

    cache = {}
    for n0 in sorted(pairs.n0.unique()):
        sub = pairs[pairs.n0 == n0]
        window = [t for t in CONGS if t <= n0][-WINDOW:]
        px = torch.tensor(
            ((sub[feat_cols].to_numpy() - fstats[0]) / fstats[1]).astype(np.float32)
        )
        cache[n0] = (
            [snaps[t] for t in window],
            torch.tensor(sub.member_id.map(midx).to_numpy()),
            torch.tensor(sub.caucus_id.map(cidx).to_numpy()),
            px,
            torch.tensor(sub.label.to_numpy(), dtype=torch.float32),
        )

    model = TemporalSage(4, len(feat_cols))
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)
    train_n0 = [n for n in cache if n < VAL_N0]

    best_ap, best_state, patience = -1.0, None, 0
    for epoch in range(500):
        model.train()
        for n0 in train_n0:
            steps, mi, ci, px, y = cache[n0]
            w = (len(y) - y.sum()) / y.sum()
            loss = F.binary_cross_entropy_with_logits(
                model(steps, mi, ci, px), y, pos_weight=w
            )
            opt.zero_grad(); loss.backward(); opt.step()
        model.eval()
        with torch.no_grad():
            steps, mi, ci, px, y = cache[VAL_N0]
            ap = average_precision_score(y.numpy(), model(steps, mi, ci, px).numpy())
        if ap > best_ap:
            best_ap, patience = ap, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= 50:
                break
    model.load_state_dict(best_state)
    model.eval()

    out = {}
    with torch.no_grad():
        for n0, (steps, mi, ci, px, _) in cache.items():
            out[n0] = model(steps, mi, ci, px).numpy()
    if return_artifacts:
        return out, best_ap, epoch, {
            "model": model, "cache": cache, "midx": midx, "cidx": cidx,
            "fstats": fstats,
        }
    return out, best_ap, epoch


# -------------------------------------------------------------------- main

def main():
    t0 = time.time()
    pairs = pd.read_parquet(HERE / "pairs.parquet")
    pairs[FEATURES] = pairs[FEATURES].fillna(pairs[FEATURES].median())
    ms = load_memberships()
    pairs = add_history_features(pairs, ms)
    print(f"history features done ({time.time()-t0:.0f}s)")
    print(pairs.groupby("label")[["was_before", "c_new_frac_prev"]].mean().round(3))

    train = pairs[pairs.n1 <= 112]
    test = pairs[pairs.n1 > 112].copy()

    def fit_lr(cols, name):
        m = make_pipeline(StandardScaler(),
                          LogisticRegression(max_iter=3000, class_weight="balanced"))
        m.fit(train[cols], train.label)
        test[name] = m.predict_proba(test[cols])[:, 1]
        return m

    fit_lr(FEATURES, "score_lr")
    fit_lr(HIST, "score_lr_histonly")
    lr_h = fit_lr(FEATURES + HIST, "score_lr_hist")
    gb = HistGradientBoostingClassifier(random_state=0)
    gb.fit(train[FEATURES + HIST], train.label)
    test["score_gb_hist"] = gb.predict_proba(test[FEATURES + HIST])[:, 1]
    print(f"tabular models done ({time.time()-t0:.0f}s)")

    feat_cols = PAIR_FEATS + HIST
    gnn_rows = []
    for seed in SEEDS:
        scores, val_ap, ep = train_temporal_gnn(pairs, ms, feat_cols, seed)
        col = f"score_tgnn_{seed}"
        tn0 = test.n0.to_numpy()
        v = np.empty(len(test))
        for n0 in np.unique(tn0):
            v[tn0 == n0] = scores[n0]
        test[col] = v
        gnn_rows.append(row(f"tgnn s{seed}", test, col))
        print(f"tgnn seed {seed}: val AP {val_ap:.3f} @ ep {ep} ({time.time()-t0:.0f}s)")

    rows = [
        row("popularity (caucus size)", test, "size_c"),
        row("LR static features", test, "score_lr"),
        row("LR history features only", test, "score_lr_histonly"),
        row("LR static + history", test, "score_lr_hist"),
        row("GBM + history features", test, "score_gb_hist"),
    ]
    g = pd.DataFrame(gnn_rows)
    mean, std = g.drop(columns="model").mean(), g.drop(columns="model").std()
    rows.append({"model": "temporal GNN (3 seeds, mean)", **mean.to_dict()})

    lines = [
        "# Caucus choice — temporal models (conditional task)",
        "",
        "Conditional task: among members with ≥1 new join at N+1, rank their",
        "candidate caucuses. MRR/R@5/R@10 macro over members, averaged over the",
        "4 test transitions (112→113 … 115→116). AUC/AP pooled, for continuity.",
        "",
        "| model | ROC-AUC | PR-AUC | MRR | recall@5 | recall@10 |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['model']} | {r['auc']:.3f} | {r['ap']:.3f} | {r['mrr']:.3f} "
            f"| {r['r5']:.3f} | {r['r10']:.3f} |"
        )
    lines += [
        "",
        f"temporal GNN across seeds — AUC {mean.auc:.3f}±{std.auc:.3f}, "
        f"AP {mean.ap:.3f}±{std.ap:.3f}, MRR {mean.mrr:.3f}±{std.mrr:.3f}",
        "",
        "## LR + history coefficients (standardized, top 10)",
        "",
        "```",
    ]
    coefs = pd.Series(
        lr_h.named_steps["logisticregression"].coef_[0], index=FEATURES + HIST
    ).sort_values(key=abs, ascending=False)
    lines += [coefs.head(10).round(3).to_string(), "```", ""]

    out = HERE / "results_temporal.md"
    out.write_text("\n".join(lines))
    print(pd.DataFrame(rows).round(3).to_string(index=False))
    print(f"wrote {out} ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
