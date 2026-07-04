"""
baselines.py — evaluate caucus link-prediction baselines on pairs.parquet.

Temporal split (agreed protocol): train on transitions ending ≤ 112,
test on 112→113 … 115→116.  No tuning on test.

Models:
  ranking heuristics — popularity (caucus size), preferential attachment,
    common-neighbor fraction, Adamic-Adar, cosponsorship ties, vote agreement
  logistic regression — all engineered features, standardized
  hist gradient boosting — same features, stronger tabular baseline

Metrics (per test transition, then mean):
  ROC-AUC, average precision (PR-AUC), macro recall@10 per member
  (fraction of a member's true new joins ranked in their top 10 candidates).

Run:  uv run python research/baselines.py
Writes research/results_baselines.md
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).parent
TRAIN_MAX_N1 = 112

FEATURES = [
    "is_dem", "is_rep", "nom1", "nom2", "seniority", "n_caucuses_m",
    "size_c", "growth_c", "age_c", "frac_dem_c", "mean_nom1_c", "std_nom1_c",
    "ideo_dist", "party_match", "state_frac",
    "cn_frac", "cn_w", "aa", "vote_agree", "cosp_w", "cosp_frac", "pa",
]

HEURISTICS = {
    "popularity (caucus size)": "size_c",
    "preferential attachment": "pa",
    "common neighbors": "cn_frac",
    "adamic-adar": "aa",
    "cosponsorship ties": "cosp_frac",
    "vote agreement": "vote_agree",
}


def recall_at_k(df: pd.DataFrame, score_col: str, k: int = 10) -> float:
    """Macro over members with ≥1 join: share of their joins in their top-k."""
    recalls = []
    for _, g in df.groupby("member_id"):
        pos = g.label.sum()
        if pos == 0:
            continue
        topk = g.nlargest(k, score_col)
        recalls.append(topk.label.sum() / pos)
    return float(np.mean(recalls))


def evaluate(test: pd.DataFrame, score_col: str) -> dict[str, float]:
    per_auc, per_ap, per_rec = [], [], []
    for _, g in test.groupby("n0"):
        per_auc.append(roc_auc_score(g.label, g[score_col]))
        per_ap.append(average_precision_score(g.label, g[score_col]))
        per_rec.append(recall_at_k(g, score_col))
    return {
        "auc": float(np.mean(per_auc)),
        "ap": float(np.mean(per_ap)),
        "r10": float(np.mean(per_rec)),
    }


def main():
    pairs = pd.read_parquet(HERE / "pairs.parquet")
    pairs[FEATURES] = pairs[FEATURES].fillna(pairs[FEATURES].median())
    train = pairs[pairs.n1 <= TRAIN_MAX_N1]
    test = pairs[pairs.n1 > TRAIN_MAX_N1].copy()
    print(
        f"train {len(train):,} pairs ({int(train.label.sum()):,} pos) · "
        f"test {len(test):,} pairs ({int(test.label.sum()):,} pos)"
    )

    rows = []
    for name, col in HEURISTICS.items():
        rows.append({"model": name, **evaluate(test, col)})

    lr = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0),
    )
    lr.fit(train[FEATURES], train.label)
    test["score_lr"] = lr.predict_proba(test[FEATURES])[:, 1]
    rows.append({"model": "logistic regression", **evaluate(test, "score_lr")})

    gb = HistGradientBoostingClassifier(random_state=0)
    gb.fit(train[FEATURES], train.label)
    test["score_gb"] = gb.predict_proba(test[FEATURES])[:, 1]
    rows.append({"model": "hist gradient boosting", **evaluate(test, "score_gb")})

    res = pd.DataFrame(rows)
    base = test.label.mean()

    lines = [
        "# Caucus link prediction — baseline results",
        "",
        f"Train: transitions 105→106 … 111→112 ({len(train):,} pairs, {int(train.label.sum()):,} joins)  ",
        f"Test: 112→113 … 115→116 ({len(test):,} pairs, {int(test.label.sum()):,} joins, base rate {base:.2%})  ",
        "Metrics averaged over the 4 test transitions. recall@10 is macro over members with ≥1 join.",
        "",
        "| model | ROC-AUC | PR-AUC | recall@10 |",
        "|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| {r['model']} | {r['auc']:.3f} | {r['ap']:.3f} | {r['r10']:.3f} |")

    coefs = pd.Series(
        lr.named_steps["logisticregression"].coef_[0], index=FEATURES
    ).sort_values(key=abs, ascending=False)
    lines += ["", "## LR coefficients (standardized)", "", "```",
              coefs.round(3).to_string(), "```", ""]

    out = HERE / "results_baselines.md"
    out.write_text("\n".join(lines))
    print(res.round(3).to_string(index=False))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
