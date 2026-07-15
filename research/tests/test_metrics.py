"""Evaluation metrics must be exactly right — every reported number flows
through these functions."""
import numpy as np
import pandas as pd
import pytest

from baselines import evaluate, recall_at_k
from temporal import conditional_metrics


def toy_transition(n0=112):
    """3 members × 4 candidate caucuses with a known perfect ranking."""
    rows = []
    # member 1: joins caucus A (score ranks it first) → MRR 1, R@k 1
    for cid, score, label in [(1, 0.9, 1), (2, 0.5, 0), (3, 0.4, 0), (4, 0.1, 0)]:
        rows.append((n0, 10, cid, score, label))
    # member 2: joins two caucuses, ranked 2nd and 3rd
    for cid, score, label in [(1, 0.9, 0), (2, 0.8, 1), (3, 0.7, 1), (4, 0.1, 0)]:
        rows.append((n0, 20, cid, score, label))
    # member 3: no joins → excluded from conditional metrics
    for cid, score, label in [(1, 0.9, 0), (2, 0.5, 0), (3, 0.4, 0), (4, 0.1, 0)]:
        rows.append((n0, 30, cid, score, label))
    return pd.DataFrame(rows, columns=["n0", "member_id", "caucus_id", "score", "label"])


def test_recall_at_k_counts_only_joining_members():
    df = toy_transition()
    # k=1: member 1 gets 1/1, member 2 gets 0.5 with k=2? — at k=1: top-1 of
    # member 2 is caucus 1 (label 0) → 0/2. macro over joiners = (1 + 0) / 2
    assert recall_at_k(df, "score", k=1) == pytest.approx(0.5)
    # k=3 captures both of member 2's joins → (1 + 1) / 2
    assert recall_at_k(df, "score", k=3) == pytest.approx(1.0)


def test_conditional_metrics_mrr_first_relevant():
    df = toy_transition()
    m = conditional_metrics(df, "score")
    # member 1 first relevant at rank 1 → 1.0; member 2 at rank 2 → 0.5
    assert m["mrr"] == pytest.approx((1.0 + 0.5) / 2)
    assert m["r5"] == pytest.approx(1.0)
    assert m["r10"] == pytest.approx(1.0)


def test_conditional_metrics_averages_over_transitions():
    a = toy_transition(n0=112)
    b = toy_transition(n0=113)
    # degrade transition b: shuffle scores so member 1's join ranks last
    b.loc[(b.member_id == 10) & (b.caucus_id == 1), "score"] = 0.0
    m_single = conditional_metrics(a, "score")
    m_both = conditional_metrics(pd.concat([a, b]), "score")
    assert m_both["mrr"] < m_single["mrr"]


def test_evaluate_perfect_and_random_scores():
    df = toy_transition()
    perfect = evaluate(df.assign(**{"score": df.label.astype(float)}), "score")
    assert perfect["auc"] == pytest.approx(1.0)
    assert perfect["ap"] == pytest.approx(1.0)

    rng = np.random.default_rng(0)
    big = pd.DataFrame(
        {
            "n0": 112,
            "member_id": np.repeat(np.arange(50), 40),
            "label": rng.random(2000) < 0.05,
            "score": rng.random(2000),
        }
    )
    big["label"] = big.label.astype(float)
    rand = evaluate(big, "score")
    assert 0.4 < rand["auc"] < 0.6  # chance level
