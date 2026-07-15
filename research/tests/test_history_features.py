"""History features are the paper's core claim — pin their semantics on
synthetic data where every value is hand-checkable. Leakage here would
invalidate every headline number."""
import pandas as pd
import pytest

from temporal import HIST, add_history_features, prev_cong


def make_fixture():
    """Members 1–2, caucuses 10/20, congresses 103–112.

    member 1: in caucus 10 during 105–106, left, candidate to rejoin at 111→112.
    member 2: never in caucus 10.
    caucus 20 exists only to give member 1 a current membership.
    """
    ms = pd.DataFrame(
        [
            (105, 1, 10),
            (106, 1, 10),
            (110, 1, 20),
            (111, 1, 20),
            (110, 2, 20),
            (111, 2, 20),
            (111, 3, 10),  # caucus 10 active at 111 via member 3
            (110, 3, 10),
        ],
        columns=["cong", "member_id", "caucus_id"],
    )
    pairs = pd.DataFrame(
        [
            # (n0, n1, member, caucus) candidates at 111→112
            (111, 112, 1, 10),  # rejoin candidate: was in 10 at 105-106
            (111, 112, 2, 10),  # never a member
        ],
        columns=["n0", "n1", "member_id", "caucus_id"],
    )
    return pairs, ms


def test_prev_cong_handles_the_104_gap():
    assert prev_cong(105) == 103  # congress 104 missing in source data
    assert prev_cong(111) == 110


def test_rejoin_features():
    pairs, ms = make_fixture()
    out = add_history_features(pairs.copy(), ms)
    m1 = out[out.member_id == 1].iloc[0]
    m2 = out[out.member_id == 2].iloc[0]

    assert m1.was_before == 1.0
    assert m1.n_before == 2.0          # member of caucus 10 in 105 and 106
    assert m1.gap_since == 111 - 106   # congresses since last membership
    assert m2.was_before == 0.0
    assert m2.n_before == 0.0
    assert m2.gap_since == 0.0


def test_member_churn_features():
    pairs, ms = make_fixture()
    out = add_history_features(pairs.copy(), ms)
    m1 = out[out.member_id == 1].iloc[0]
    # member 1 at n0=111 holds {20}, at prev cong 110 held {20} → 0 new joins
    assert m1.m_joins_prev == 0.0
    assert m1.m_no_prev == 0.0


def test_caucus_openness():
    pairs, ms = make_fixture()
    out = add_history_features(pairs.copy(), ms)
    # caucus 10 at 111 = {3}; at 110 = {3} → no new members → openness 0
    assert out[out.caucus_id == 10].c_new_frac_prev.unique().tolist() == [0.0]


def test_no_future_leakage():
    """A membership that only exists at n1 must not influence features at n0."""
    pairs, ms = make_fixture()
    ms_with_future = pd.concat(
        [ms, pd.DataFrame([(112, 2, 10)], columns=["cong", "member_id", "caucus_id"])],
        ignore_index=True,
    )
    base = add_history_features(pairs.copy(), ms)
    with_future = add_history_features(pairs.copy(), ms_with_future)
    for col in HIST:
        assert (base[col] == with_future[col]).all(), f"leak via {col}"
