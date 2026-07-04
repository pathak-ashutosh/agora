"""
build_dataset.py — construct the caucus link-prediction dataset.

Task: for each consecutive congress transition N → N+1, predict which
(member, caucus) memberships APPEAR at N+1 that did not exist at N.

Candidates: (m, c) where m serves in both N and N+1, c exists in both
N and N+1, and m ∉ c at N.  Label: m ∈ c at N+1.

All features are computed from congress ≤ N only (no leakage):
  member  — party, DW-NOMINATE, seniority, caucus count
  caucus  — size, growth, age, party mix, ideology mean/std
  pair    — ideological distance, party/state match with caucus members,
            common-neighbor overlap + Adamic-Adar on the bipartite graph,
            cosponsorship ties to caucus members, roll-call agreement

Requires: prep_data.py + prep_external.py outputs in public/data/,
plus EXTERNAL/voteview/HSall_members.csv (for pre-103 seniority).

Writes research/pairs.parquet (~1.8M rows).  Run:
  uv run python research/build_dataset.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from prep_external import ICPSR_DROP, ICPSR_REMAP  # noqa: E402

DATA = ROOT / "public" / "data"
OUT = ROOT / "research"

TRANSITIONS = [(n, n + 1) for n in range(105, 116)]  # 105→106 … 115→116


def fix_ids(df: pd.DataFrame, id_col: str) -> pd.DataFrame:
    df = df[~df.apply(lambda r: (r["cong"], r[id_col]) in ICPSR_DROP, axis=1)]
    df = df.copy()
    df[id_col] = df.apply(
        lambda r: ICPSR_REMAP.get((r["cong"], r[id_col]), r[id_col]), axis=1
    )
    return df


def load_all():
    members = fix_ids(pd.read_parquet(DATA / "members.parquet"), "member_id")
    memberships = fix_ids(pd.read_parquet(DATA / "memberships.parquet"), "member_id")
    vv = pd.read_parquet(DATA / "members_voteview.parquet")
    votes = pd.read_parquet(DATA / "votes.parquet")
    cosp = pd.read_parquet(DATA / "cosponsorships.parquet")
    hs = pd.read_csv(
        ROOT / "EXTERNAL" / "voteview" / "HSall_members.csv",
        usecols=["congress", "chamber", "icpsr"],
        low_memory=False,
    )
    hs = hs[hs.chamber == "House"]
    return members, memberships, vv, votes, cosp, hs


def pairwise_vote_agreement(votes_c: pd.DataFrame, icpsrs: list[int]) -> np.ndarray:
    """Fraction of shared rollcalls where two members voted the same way (yea/nay)."""
    v = votes_c[votes_c.icpsr.isin(icpsrs)].copy()
    v["dir"] = np.select(
        [v.cast_code.isin([1, 2, 3]), v.cast_code.isin([4, 5, 6])], [1.0, -1.0], np.nan
    )
    mat = v.pivot_table(index="icpsr", columns="rollnumber", values="dir")
    mat = mat.reindex(icpsrs)
    X = mat.to_numpy()
    valid = ~np.isnan(X)
    Xz = np.where(valid, X, 0.0)
    agree_signed = Xz @ Xz.T          # (#agree − #disagree) on shared votes
    shared = valid.astype(float) @ valid.astype(float).T
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(shared > 0, (agree_signed / shared + 1) / 2, 0.5)


def cosponsor_weights(cosp_c: pd.DataFrame, icpsrs: list[int]) -> np.ndarray:
    """Symmetric member×member count of bills where one sponsored, other cosponsored."""
    idx = {m: i for i, m in enumerate(icpsrs)}
    n = len(icpsrs)
    W = np.zeros((n, n))
    c = cosp_c[cosp_c.icpsr.isin(idx) & ~cosp_c.withdrawn]
    sponsors = c[c.role == "sponsor"].set_index("bill_id").icpsr
    co = c[c.role == "cosponsor"][["bill_id", "icpsr"]]
    co = co[co.bill_id.isin(sponsors.index)]
    pairs = (
        co.assign(sp=sponsors.reindex(co.bill_id).to_numpy())
        .groupby(["icpsr", "sp"])
        .size()
    )
    for (a, b), w in pairs.items():
        if a != b:
            W[idx[a], idx[b]] += w
            W[idx[b], idx[a]] += w
    return W


def build_transition(n0, n1, members, memberships, vv, votes, cosp, hs):
    mem0 = members[members.cong == n0].drop_duplicates("member_id")
    mem1 = members[members.cong == n1]
    both = sorted(set(mem0.member_id) & set(mem1.member_id))
    idx = {m: i for i, m in enumerate(both)}

    ms0 = memberships[memberships.cong == n0]
    ms1 = memberships[memberships.cong == n1]
    caucs = sorted(set(ms0.caucus_id) & set(ms1.caucus_id))
    cidx = {c: j for j, c in enumerate(caucs)}

    # bipartite incidence at n0 (rows: members serving both, cols: shared caucuses)
    M = np.zeros((len(both), len(caucs)))
    for r in ms0.itertuples():
        if r.member_id in idx and r.caucus_id in cidx:
            M[idx[r.member_id], cidx[r.caucus_id]] = 1.0
    # membership at n1 (labels)
    L = np.zeros_like(M)
    for r in ms1.itertuples():
        if r.member_id in idx and r.caucus_id in cidx:
            L[idx[r.member_id], cidx[r.caucus_id]] = 1.0

    size_c = M.sum(0)                                   # caucus sizes at n0
    keep_c = size_c > 0                                 # active shared caucuses
    n_caucuses_m = M.sum(1)

    S = M @ M.T                                         # shared-caucus counts
    B = (S > 0).astype(float)
    np.fill_diagonal(B, 0.0)
    np.fill_diagonal(S, 0.0)
    with np.errstate(divide="ignore"):
        inv_log = np.where(size_c > 1, 1 / np.log(size_c), 0.0)
    A = (M * inv_log) @ M.T                             # Adamic-Adar member×member
    np.fill_diagonal(A, 0.0)

    denom = np.maximum(size_c, 1)
    cn_frac = B @ M / denom
    cn_w = S @ M / denom
    aa = A @ M / denom

    V = pairwise_vote_agreement(votes[votes.cong == n0], both)
    np.fill_diagonal(V, 0.0)
    vote_agree = V @ M / denom

    W = cosponsor_weights(cosp[cosp.cong == n0], both)
    cosp_w = W @ M / denom
    cosp_frac = (W > 0).astype(float) @ M / denom

    # member attributes
    m0 = mem0.set_index("member_id").reindex(both)
    vv0 = vv[vv.cong == n0].drop_duplicates("icpsr").set_index("icpsr").reindex(both)
    seniority = (
        hs[hs.congress <= n0].groupby("icpsr").congress.nunique().reindex(both).fillna(1)
    )
    party = m0.party.to_numpy()
    is_dem = (party == 100).astype(float)
    is_rep = (party == 200).astype(float)
    nom1 = vv0.nominate_dim1.to_numpy()
    nom2 = vv0.nominate_dim2.to_numpy()
    state = m0.state_abv.to_numpy()

    # caucus attributes at n0
    dem_M = is_dem @ M
    frac_dem_c = dem_M / denom
    mean_nom1_c = np.nan_to_num(nom1) @ M / denom
    sq = np.nan_to_num(nom1) ** 2 @ M / denom
    std_nom1_c = np.sqrt(np.maximum(sq - mean_nom1_c**2, 0))
    party_match = np.where(
        is_dem[:, None] == 1, frac_dem_c[None, :],
        np.where(is_rep[:, None] == 1, ((is_rep @ M) / denom)[None, :], 0.0),
    )
    state_mat = (state[:, None] == state[None, :]).astype(float)
    np.fill_diagonal(state_mat, 0.0)
    state_frac = state_mat @ M / denom

    ages = memberships[memberships.cong <= n0].groupby("caucus_id").cong.nunique()
    age_c = ages.reindex(caucs).fillna(1).to_numpy()
    prev_cong = {105: 103}.get(n0, n0 - 1)
    size_prev = (
        memberships[memberships.cong == prev_cong].groupby("caucus_id").size()
        .reindex(caucs).fillna(0).to_numpy()
    )
    growth_c = size_c - size_prev

    # assemble candidate pairs: m ∉ c at n0, caucus active
    cand = (M == 0) & keep_c[None, :]
    mi, cj = np.nonzero(cand)
    df = pd.DataFrame(
        {
            "n0": n0,
            "n1": n1,
            "member_id": np.array(both)[mi],
            "caucus_id": np.array(caucs)[cj],
            "label": L[mi, cj],
            "is_dem": is_dem[mi],
            "is_rep": is_rep[mi],
            "nom1": nom1[mi],
            "nom2": nom2[mi],
            "seniority": seniority.to_numpy()[mi],
            "n_caucuses_m": n_caucuses_m[mi],
            "size_c": size_c[cj],
            "growth_c": growth_c[cj],
            "age_c": age_c[cj],
            "frac_dem_c": frac_dem_c[cj],
            "mean_nom1_c": mean_nom1_c[cj],
            "std_nom1_c": std_nom1_c[cj],
            "ideo_dist": np.abs(np.nan_to_num(nom1)[mi] - mean_nom1_c[cj]),
            "party_match": party_match[mi, cj],
            "state_frac": state_frac[mi, cj],
            "cn_frac": cn_frac[mi, cj],
            "cn_w": cn_w[mi, cj],
            "aa": aa[mi, cj],
            "vote_agree": vote_agree[mi, cj],
            "cosp_w": cosp_w[mi, cj],
            "cosp_frac": cosp_frac[mi, cj],
            "pa": n_caucuses_m[mi] * size_c[cj],
        }
    )
    return df


def main():
    members, memberships, vv, votes, cosp, hs = load_all()
    frames = []
    for n0, n1 in TRANSITIONS:
        df = build_transition(n0, n1, members, memberships, vv, votes, cosp, hs)
        frames.append(df)
        print(
            f"  {n0}→{n1}: {len(df):,} pairs, {int(df.label.sum()):,} joins "
            f"({df.label.mean():.3%} base rate)"
        )
    pairs = pd.concat(frames, ignore_index=True)
    pairs.to_parquet(OUT / "pairs.parquet", index=False)
    print(f"wrote research/pairs.parquet: {len(pairs):,} rows")


if __name__ == "__main__":
    main()
