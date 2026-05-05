"""
prep_data.py — convert raw CSVs in DATA/ to compact Parquet files in public/data/.

Reads:
  DATA/mc_attributes{N}.csv            — member metadata per congress
  DATA/caucus_attributes{N}.csv        — caucus metadata per congress
  DATA/caucus_membership{N}LONG.csv    — long-format memberships (0/1 flag)

Writes (core):
  public/data/members.parquet          — (cong, member_id, mc_name, party, state_abv, cd, nominate)
  public/data/caucuses.parquet         — (cong, caucus_id, caucus_name)
  public/data/memberships.parquet      — (cong, member_id, caucus_id)  [only rows where member=1]

Writes (derived analytics):
  public/data/member_stats.parquet     — per-cong centrality + cross-party share per member
  public/data/caucus_stats.parquet     — per-cong size, party mix, bipartisan score, nominate stats
  public/data/caucus_lifecycle.parquet — per-caucus first/last/peak congress + canonical name
  public/data/surprising_pairs.parquet — cross-party pairs with unusually high co-membership
  public/data/state_stats.parquet      — per (cong, state) delegation counts + nominate summary

  public/data/metadata.json            — summary (congress range, counts, derived table manifest)

Run with:
  uv run prep_data.py
"""
from __future__ import annotations

import json
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "DATA"
OUT_DIR = ROOT / "public" / "data"

# ICPSR state code -> USPS abbreviation
ICPSR_STATE = {
    1: "CT", 2: "ME", 3: "MA", 4: "NH", 5: "RI", 6: "VT",
    11: "DE", 12: "NJ", 13: "NY", 14: "PA",
    21: "IL", 22: "IN", 23: "MI", 24: "OH", 25: "WI",
    31: "IA", 32: "KS", 33: "MN", 34: "MO", 35: "NE", 36: "ND", 37: "SD",
    40: "VA", 41: "AL", 42: "AR", 43: "FL", 44: "GA", 45: "LA",
    46: "MS", 47: "NC", 48: "SC", 49: "TX",
    51: "KY", 52: "MD", 53: "OK", 54: "TN", 55: "DC", 56: "WV",
    61: "AZ", 62: "CO", 63: "ID", 64: "MT", 65: "NV", 66: "NM",
    67: "UT", 68: "WY",
    71: "CA", 72: "OR", 73: "WA",
    81: "AK", 82: "HI",
    # Also seen in some files:
    10: "CT", 20: "NJ", 50: "LA",
}

STATE_NAME_TO_ABV = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT", "DELAWARE": "DE",
    "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD",
    "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE",
    "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR",
    "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT",
    "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY",
    "DISTRICT OF COLUMBIA": "DC",
}


def normalize_state(row: pd.Series) -> str | None:
    """Extract a 2-letter state code from whatever columns are available."""
    if "state.abv" in row and pd.notna(row["state.abv"]):
        return str(row["state.abv"]).strip().upper()
    if "state_abv" in row and pd.notna(row["state_abv"]):
        return str(row["state_abv"]).strip().upper()
    if "statenm" in row and pd.notna(row["statenm"]):
        name = str(row["statenm"]).strip().upper()
        if name in STATE_NAME_TO_ABV:
            return STATE_NAME_TO_ABV[name]
    if "state" in row and pd.notna(row["state"]):
        val = row["state"]
        # Might already be an abbreviation (e.g. 116 has both `state` numeric and `state.abv`)
        if isinstance(val, str) and not val.strip().isdigit():
            return val.strip().upper()
        try:
            return ICPSR_STATE.get(int(float(val)))
        except (ValueError, TypeError):
            return None
    return None


def _load_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    # Strip unnamed index columns like '' or 'Unnamed: 0'
    drop_cols = [c for c in df.columns if c.startswith("Unnamed") or c == ""]
    return df.drop(columns=drop_cols)


def load_members() -> pd.DataFrame:
    frames = []
    for path in sorted(DATA_DIR.glob("mc_attributes*.csv")):
        # Skip _updated variants — they're reduced versions
        if "_updated" in path.name:
            continue
        df = _load_csv(path)
        # Normalize column names
        df = df.rename(columns={"mc.name": "mc_name", "id": "member_id"})
        # Apply state normalization per row
        df["state_abv"] = df.apply(normalize_state, axis=1)
        # Required columns
        cols = ["cong", "member_id", "mc_name", "party", "state_abv"]
        if "cd" in df.columns:
            cols.append("cd")
        else:
            df["cd"] = pd.NA
            cols.append("cd")
        if "nominate" in df.columns:
            cols.append("nominate")
        else:
            df["nominate"] = pd.NA
            cols.append("nominate")
        frames.append(df[cols])
    out = pd.concat(frames, ignore_index=True)
    out["cong"] = out["cong"].astype("int32")
    out["member_id"] = out["member_id"].astype("int32")
    out["party"] = out["party"].astype("int32")
    out["cd"] = pd.to_numeric(out["cd"], errors="coerce").astype("Int32")
    out["nominate"] = pd.to_numeric(out["nominate"], errors="coerce").astype("float32")
    out["mc_name"] = out["mc_name"].fillna("").astype(str).str.strip()
    out["state_abv"] = out["state_abv"].fillna("").astype(str)
    # Dedup: same (cong, member_id)
    out = out.drop_duplicates(subset=["cong", "member_id"]).reset_index(drop=True)
    return out


def load_caucuses() -> pd.DataFrame:
    frames = []
    for path in sorted(DATA_DIR.glob("caucus_attributes*.csv")):
        df = _load_csv(path)
        keep = ["cong", "caucus_id", "caucus_name"]
        frames.append(df[keep])
    out = pd.concat(frames, ignore_index=True)
    out["cong"] = out["cong"].astype("int32")
    out["caucus_id"] = out["caucus_id"].astype("int32")
    out["caucus_name"] = out["caucus_name"].fillna("").astype(str).str.strip()
    out = out.drop_duplicates(subset=["cong", "caucus_id"]).reset_index(drop=True)
    return out


def load_memberships() -> pd.DataFrame:
    frames = []
    for path in sorted(DATA_DIR.glob("caucus_membership*LONG.csv")):
        df = _load_csv(path)
        df = df.rename(columns={"id": "member_id", "caucusid": "caucus_id"})
        # Only rows where member == 1
        df = df[df["member"] == 1]
        frames.append(df[["cong", "member_id", "caucus_id"]])
    out = pd.concat(frames, ignore_index=True)
    out["cong"] = out["cong"].astype("int32")
    out["member_id"] = out["member_id"].astype("int32")
    out["caucus_id"] = out["caucus_id"].astype("int32")
    out = out.drop_duplicates().reset_index(drop=True)
    return out


# ---------------------------------------------------------------------------
# Derived analytics — precomputed per-congress stats + lifecycle
# ---------------------------------------------------------------------------


def _co_membership_graph(memberships_c: pd.DataFrame) -> nx.Graph:
    """Build a weighted member-member graph for one congress.
    Edge weight = # caucuses the two members share."""
    g = nx.Graph()
    # self-join via groupby on caucus_id
    by_caucus = memberships_c.groupby("caucus_id")["member_id"].apply(list)
    edge_weight: dict[tuple[int, int], int] = {}
    for members in by_caucus:
        ids = sorted(set(int(m) for m in members))
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = (ids[i], ids[j])
                edge_weight[key] = edge_weight.get(key, 0) + 1
    g.add_weighted_edges_from((a, b, w) for (a, b), w in edge_weight.items())
    return g


def compute_member_stats(
    memberships: pd.DataFrame, members: pd.DataFrame
) -> pd.DataFrame:
    """Per (cong, member_id): degree, betweenness, cross_party_share, mean_peer_nominate."""
    rows: list[dict] = []
    members_idx = members.set_index(["cong", "member_id"])
    for cong, mb_c in memberships.groupby("cong"):
        g = _co_membership_graph(mb_c)
        if g.number_of_nodes() == 0:
            continue
        # Betweenness uses distance = 1/weight so strong ties are "shorter"
        dist_g = nx.Graph()
        for u, v, data in g.edges(data=True):
            w = max(data.get("weight", 1), 1)
            dist_g.add_edge(u, v, distance=1.0 / w)
        bc = nx.betweenness_centrality(dist_g, weight="distance", normalized=True)

        # Cross-party share per member: among caucus co-memberships, fraction with opposite major party
        # Only meaningful for D (100) and R (200); other parties get null.
        party_by_id: dict[int, int] = {}
        cong_members = members[members["cong"] == int(cong)][["member_id", "party", "nominate"]]
        for _, r in cong_members.iterrows():
            party_by_id[int(r["member_id"])] = int(r["party"])
        nom_by_id: dict[int, float | None] = {}
        for _, r in cong_members.iterrows():
            val = r["nominate"]
            nom_by_id[int(r["member_id"])] = None if pd.isna(val) else float(val)

        for node in g.nodes:
            me_party = party_by_id.get(int(node))
            # Sum co-membership weights; split by peer's party
            total_w = 0
            cross_w = 0
            peer_nominate: list[float] = []
            for peer in g.neighbors(node):
                w = int(g[node][peer].get("weight", 1))
                total_w += w
                peer_party = party_by_id.get(int(peer))
                if (
                    me_party in (100, 200)
                    and peer_party in (100, 200)
                    and me_party != peer_party
                ):
                    cross_w += w
                pn = nom_by_id.get(int(peer))
                if pn is not None:
                    peer_nominate.append(pn)
            cross_share = None
            if me_party in (100, 200) and total_w > 0:
                # Denominator only counts peers in D or R
                dr_w = sum(
                    int(g[node][p].get("weight", 1))
                    for p in g.neighbors(node)
                    if party_by_id.get(int(p)) in (100, 200)
                )
                if dr_w > 0:
                    cross_share = cross_w / dr_w

            # degree = number of caucuses this member is in (from memberships directly)
            degree = int(
                ((mb_c["member_id"] == int(node))).sum()
            )
            rows.append(
                {
                    "cong": int(cong),
                    "member_id": int(node),
                    "degree": degree,
                    "betweenness": float(bc.get(node, 0.0)),
                    "cross_party_share": cross_share,
                    "mean_peer_nominate": (
                        float(np.mean(peer_nominate)) if peer_nominate else None
                    ),
                    "peer_count": int(g.degree(node)),
                }
            )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out["cong"] = out["cong"].astype("int32")
    out["member_id"] = out["member_id"].astype("int32")
    out["degree"] = out["degree"].astype("int32")
    out["peer_count"] = out["peer_count"].astype("int32")
    out["betweenness"] = out["betweenness"].astype("float32")
    out["cross_party_share"] = pd.to_numeric(
        out["cross_party_share"], errors="coerce"
    ).astype("float32")
    out["mean_peer_nominate"] = pd.to_numeric(
        out["mean_peer_nominate"], errors="coerce"
    ).astype("float32")
    return out


def compute_caucus_stats(
    memberships: pd.DataFrame, members: pd.DataFrame, caucuses: pd.DataFrame
) -> pd.DataFrame:
    """Per (cong, caucus_id): size, party mix, bipartisan score, nominate stats."""
    joined = memberships.merge(
        members[["cong", "member_id", "party", "nominate", "state_abv"]],
        on=["cong", "member_id"],
        how="left",
    )
    joined = joined.merge(
        caucuses[["cong", "caucus_id", "caucus_name"]],
        on=["cong", "caucus_id"],
        how="left",
    )

    def _agg(g: pd.DataFrame) -> pd.Series:
        dems = int((g["party"] == 100).sum())
        reps = int((g["party"] == 200).sum())
        other = int(((g["party"] != 100) & (g["party"] != 200)).sum())
        size = dems + reps + other
        dr = dems + reps
        bipartisan = (2.0 * min(dems, reps) / dr) if dr > 0 else 0.0
        noms = g["nominate"].dropna().to_numpy()
        mean_n = float(np.mean(noms)) if noms.size > 0 else None
        median_n = float(np.median(noms)) if noms.size > 0 else None
        std_n = float(np.std(noms)) if noms.size > 1 else None
        minority_share = min(dems, reps) / size if size > 0 else 0.0
        return pd.Series(
            {
                "size": size,
                "dems": dems,
                "reps": reps,
                "other": other,
                "minority_share": minority_share,
                "bipartisan_score": bipartisan,
                "mean_nominate": mean_n,
                "median_nominate": median_n,
                "std_nominate": std_n,
                "state_count": int(g["state_abv"].replace("", pd.NA).dropna().nunique()),
                "caucus_name": g["caucus_name"].dropna().iloc[0] if g["caucus_name"].notna().any() else "",
            }
        )

    out = (
        joined.groupby(["cong", "caucus_id"], as_index=False)
        .apply(_agg, include_groups=False)
        .reset_index(drop=True)
    )
    out["cong"] = out["cong"].astype("int32")
    out["caucus_id"] = out["caucus_id"].astype("int32")
    out["size"] = out["size"].astype("int32")
    out["dems"] = out["dems"].astype("int32")
    out["reps"] = out["reps"].astype("int32")
    out["other"] = out["other"].astype("int32")
    out["state_count"] = out["state_count"].astype("int32")
    out["minority_share"] = out["minority_share"].astype("float32")
    out["bipartisan_score"] = out["bipartisan_score"].astype("float32")
    out["mean_nominate"] = pd.to_numeric(out["mean_nominate"], errors="coerce").astype("float32")
    out["median_nominate"] = pd.to_numeric(out["median_nominate"], errors="coerce").astype("float32")
    out["std_nominate"] = pd.to_numeric(out["std_nominate"], errors="coerce").astype("float32")
    out["caucus_name"] = out["caucus_name"].fillna("").astype(str)
    return out


def compute_caucus_lifecycle(caucus_stats: pd.DataFrame) -> pd.DataFrame:
    """Per caucus_id: first/last/peak congress, peak size, total active congs, canonical name."""
    rows: list[dict] = []
    for caucus_id, g in caucus_stats.groupby("caucus_id"):
        # canonical name = most frequently seen non-empty name, breaking ties by latest cong
        named = g[g["caucus_name"].str.len() > 0]
        if len(named) > 0:
            counts = named["caucus_name"].value_counts()
            top = counts.index.tolist()
            latest_by_name: dict[str, int] = (
                named.groupby("caucus_name")["cong"].max().to_dict()
            )
            top.sort(key=lambda n: (-counts[n], -latest_by_name[n]))
            canonical = top[0]
        else:
            canonical = ""
        peak_row = g.sort_values("size", ascending=False).iloc[0]
        rows.append(
            {
                "caucus_id": int(caucus_id),
                "canonical_name": canonical,
                "first_cong": int(g["cong"].min()),
                "last_cong": int(g["cong"].max()),
                "active_congs": int(g["cong"].nunique()),
                "peak_cong": int(peak_row["cong"]),
                "peak_size": int(peak_row["size"]),
                "mean_size": float(g["size"].mean()),
                "mean_bipartisan": float(g["bipartisan_score"].mean()),
            }
        )
    out = pd.DataFrame(rows)
    out["caucus_id"] = out["caucus_id"].astype("int32")
    out["first_cong"] = out["first_cong"].astype("int32")
    out["last_cong"] = out["last_cong"].astype("int32")
    out["peak_cong"] = out["peak_cong"].astype("int32")
    out["active_congs"] = out["active_congs"].astype("int32")
    out["peak_size"] = out["peak_size"].astype("int32")
    out["mean_size"] = out["mean_size"].astype("float32")
    out["mean_bipartisan"] = out["mean_bipartisan"].astype("float32")
    return out


def compute_surprising_pairs(
    memberships: pd.DataFrame,
    members: pd.DataFrame,
    top_per_cong: int = 200,
) -> pd.DataFrame:
    """For each cong, cross-party (D-R) pairs ranked by (shared * ideology gap).
    Intuition: pairs who share many caucuses *despite* big ideological distance are notable."""
    rows: list[dict] = []
    for cong, mb_c in memberships.groupby("cong"):
        # Self-join on caucus to count shared caucuses
        df = mb_c.merge(mb_c, on=["cong", "caucus_id"], suffixes=("_a", "_b"))
        df = df[df["member_id_a"] < df["member_id_b"]]
        counts = (
            df.groupby(["member_id_a", "member_id_b"])
            .size()
            .reset_index(name="shared")
        )
        # attach party/nominate
        mc = members[members["cong"] == int(cong)][
            ["member_id", "mc_name", "party", "nominate", "state_abv"]
        ]
        counts = counts.merge(
            mc.rename(
                columns={
                    "member_id": "member_id_a",
                    "mc_name": "name_a",
                    "party": "party_a",
                    "nominate": "nominate_a",
                    "state_abv": "state_a",
                }
            ),
            on="member_id_a",
        )
        counts = counts.merge(
            mc.rename(
                columns={
                    "member_id": "member_id_b",
                    "mc_name": "name_b",
                    "party": "party_b",
                    "nominate": "nominate_b",
                    "state_abv": "state_b",
                }
            ),
            on="member_id_b",
        )
        # keep only cross-party D/R
        cross = counts[
            ((counts["party_a"] == 100) & (counts["party_b"] == 200))
            | ((counts["party_a"] == 200) & (counts["party_b"] == 100))
        ].copy()
        if cross.empty:
            continue
        # score: shared + ideology bonus if available
        gap = (cross["nominate_a"] - cross["nominate_b"]).abs()
        cross["ideology_gap"] = gap
        # baseline score is shared count; if gap available, multiply by (1 + gap)
        cross["score"] = cross["shared"] * (1.0 + gap.fillna(0.0))
        cross = cross.sort_values("score", ascending=False).head(top_per_cong)
        for _, r in cross.iterrows():
            rows.append(
                {
                    "cong": int(cong),
                    "member_a": int(r["member_id_a"]),
                    "member_b": int(r["member_id_b"]),
                    "name_a": str(r["name_a"]),
                    "name_b": str(r["name_b"]),
                    "party_a": int(r["party_a"]),
                    "party_b": int(r["party_b"]),
                    "state_a": str(r["state_a"]),
                    "state_b": str(r["state_b"]),
                    "shared": int(r["shared"]),
                    "ideology_gap": (
                        float(r["ideology_gap"])
                        if not pd.isna(r["ideology_gap"])
                        else None
                    ),
                    "score": float(r["score"]),
                }
            )
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    for c in ("cong", "member_a", "member_b", "party_a", "party_b", "shared"):
        out[c] = out[c].astype("int32")
    out["ideology_gap"] = pd.to_numeric(out["ideology_gap"], errors="coerce").astype(
        "float32"
    )
    out["score"] = out["score"].astype("float32")
    return out


def compute_state_stats(
    memberships: pd.DataFrame, members: pd.DataFrame
) -> pd.DataFrame:
    """Per (cong, state_abv): delegation count, dem/rep/other, mean/std nominate,
    mean caucus count per member, delegation cohesion = 1 - std(nominate)."""
    mc = members[members["state_abv"].str.len() > 0].copy()
    caucus_count = (
        memberships.groupby(["cong", "member_id"]).size().rename("caucus_count").reset_index()
    )
    mc = mc.merge(caucus_count, on=["cong", "member_id"], how="left")
    mc["caucus_count"] = mc["caucus_count"].fillna(0)

    def _agg(g: pd.DataFrame) -> pd.Series:
        dems = int((g["party"] == 100).sum())
        reps = int((g["party"] == 200).sum())
        other = int(((g["party"] != 100) & (g["party"] != 200)).sum())
        size = dems + reps + other
        noms = g["nominate"].dropna().to_numpy()
        mean_n = float(np.mean(noms)) if noms.size > 0 else None
        std_n = float(np.std(noms)) if noms.size > 1 else None
        # Cohesion: high when delegation is ideologically close. scale roughly to [0,1]
        cohesion = None if std_n is None else max(0.0, 1.0 - std_n)
        return pd.Series(
            {
                "delegation_size": size,
                "dems": dems,
                "reps": reps,
                "other": other,
                "mean_nominate": mean_n,
                "std_nominate": std_n,
                "cohesion": cohesion,
                "mean_caucus_count": float(g["caucus_count"].mean()) if size > 0 else 0.0,
            }
        )

    out = (
        mc.groupby(["cong", "state_abv"], as_index=False)
        .apply(_agg, include_groups=False)
        .reset_index(drop=True)
    )
    out["cong"] = out["cong"].astype("int32")
    out["delegation_size"] = out["delegation_size"].astype("int32")
    out["dems"] = out["dems"].astype("int32")
    out["reps"] = out["reps"].astype("int32")
    out["other"] = out["other"].astype("int32")
    out["mean_nominate"] = pd.to_numeric(out["mean_nominate"], errors="coerce").astype(
        "float32"
    )
    out["std_nominate"] = pd.to_numeric(out["std_nominate"], errors="coerce").astype(
        "float32"
    )
    out["cohesion"] = pd.to_numeric(out["cohesion"], errors="coerce").astype("float32")
    out["mean_caucus_count"] = out["mean_caucus_count"].astype("float32")
    return out


# ---------------------------------------------------------------------------
# Embeddings — matrix factorization over member × caucus + UMAP projection
# ---------------------------------------------------------------------------


def compute_factorization(
    memberships: pd.DataFrame,
    members: pd.DataFrame,
    caucuses: pd.DataFrame,
    dim: int = 32,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[int, int], dict[int, int]]:
    """Pool memberships across all congresses to form a member × caucus implicit-feedback
    matrix (entry = number of congresses a member was in a caucus). Factor with
    TruncatedSVD to get `dim`-dim embeddings for members and caucuses.

    Returns: (member_emb_df, caucus_emb_df, member_idx, caucus_idx)
    """
    # Unique member/caucus universes (pooled)
    member_ids = sorted(memberships["member_id"].unique().tolist())
    caucus_ids = sorted(memberships["caucus_id"].unique().tolist())
    member_idx = {int(mid): i for i, mid in enumerate(member_ids)}
    caucus_idx = {int(cid): i for i, cid in enumerate(caucus_ids)}

    pooled = (
        memberships.groupby(["member_id", "caucus_id"]).size().reset_index(name="n")
    )
    rows = pooled["member_id"].map(member_idx).to_numpy()
    cols = pooled["caucus_id"].map(caucus_idx).to_numpy()
    # Log-weight so large counts don't dominate
    vals = np.log1p(pooled["n"].to_numpy().astype(np.float32))

    mat = csr_matrix(
        (vals, (rows, cols)),
        shape=(len(member_ids), len(caucus_ids)),
        dtype=np.float32,
    )

    # TruncatedSVD → U Σ V^T
    actual_dim = min(dim, min(mat.shape) - 1)
    svd = TruncatedSVD(n_components=actual_dim, random_state=0)
    member_emb = svd.fit_transform(mat).astype(np.float32)
    caucus_emb = (svd.components_.T * np.sqrt(svd.singular_values_)).astype(np.float32)

    # L2-normalize rows so cosine == dot
    member_emb = normalize(member_emb, norm="l2").astype(np.float32)
    caucus_emb = normalize(caucus_emb, norm="l2").astype(np.float32)

    # Write as long-format tables: (id, d, v)
    m_rows = []
    for mid, i in member_idx.items():
        for d in range(actual_dim):
            m_rows.append({"member_id": mid, "d": d, "v": float(member_emb[i, d])})
    c_rows = []
    for cid, i in caucus_idx.items():
        for d in range(actual_dim):
            c_rows.append({"caucus_id": cid, "d": d, "v": float(caucus_emb[i, d])})

    member_df = pd.DataFrame(m_rows)
    caucus_df = pd.DataFrame(c_rows)
    member_df["member_id"] = member_df["member_id"].astype("int32")
    member_df["d"] = member_df["d"].astype("int16")
    member_df["v"] = member_df["v"].astype("float32")
    caucus_df["caucus_id"] = caucus_df["caucus_id"].astype("int32")
    caucus_df["d"] = caucus_df["d"].astype("int16")
    caucus_df["v"] = caucus_df["v"].astype("float32")

    return member_df, caucus_df, member_idx, caucus_idx


def _dense_from_long(
    long_df: pd.DataFrame, id_col: str, idx_map: dict[int, int], dim: int
) -> np.ndarray:
    out = np.zeros((len(idx_map), dim), dtype=np.float32)
    for _, row in long_df.iterrows():
        i = idx_map[int(row[id_col])]
        d = int(row["d"])
        if d < dim:
            out[i, d] = float(row["v"])
    return out


def compute_similar(
    emb: np.ndarray, ids: list[int], top_k: int = 10, name: str = "id"
) -> pd.DataFrame:
    """Top-K cosine neighbors for each row of `emb`. Returns (id, neighbor, rank, score)."""
    # emb is already L2-normalized → cosine == dot
    scores = emb @ emb.T  # (N, N)
    # Set diagonal to -inf so self-match never wins
    np.fill_diagonal(scores, -np.inf)
    # Argpartition for top_k
    k = min(top_k, scores.shape[1] - 1)
    top_idx = np.argpartition(-scores, kth=k, axis=1)[:, :k]
    rows = []
    for i, nbrs in enumerate(top_idx):
        # Sort the k neighbors by score desc
        nbr_scores = scores[i, nbrs]
        order = np.argsort(-nbr_scores)
        for rank, j in enumerate(order):
            ni = int(nbrs[j])
            rows.append(
                {
                    name: int(ids[i]),
                    f"neighbor_{name}": int(ids[ni]),
                    "rank": rank + 1,
                    "score": float(nbr_scores[j]),
                }
            )
    df = pd.DataFrame(rows)
    df[name] = df[name].astype("int32")
    df[f"neighbor_{name}"] = df[f"neighbor_{name}"].astype("int32")
    df["rank"] = df["rank"].astype("int16")
    df["score"] = df["score"].astype("float32")
    return df


def compute_projection(
    emb: np.ndarray, ids: list[int]
) -> pd.DataFrame:
    """2D UMAP projection of the row-embeddings. Falls back to PCA if UMAP fails."""
    n = emb.shape[0]
    if n < 5:
        pts = emb[:, :2]
    else:
        try:
            import umap

            reducer = umap.UMAP(
                n_components=2,
                n_neighbors=min(15, n - 1),
                metric="cosine",
                random_state=0,
            )
            pts = reducer.fit_transform(emb)
        except Exception as e:  # noqa: BLE001
            print(f"  UMAP unavailable ({e}) — falling back to SVD top-2")
            pts = emb[:, :2]
    # Robust centering + scaling: center on median, scale by 95th percentile
    # of absolute deviation so a handful of outliers don't squash the main
    # cluster into a corner. Clip the tails to the canvas edge.
    pts = pts - np.median(pts, axis=0)
    scale = np.percentile(np.abs(pts), 95)
    if scale > 0:
        pts = pts / scale
    pts = np.clip(pts, -1.1, 1.1)
    df = pd.DataFrame(
        {
            "member_id": [int(i) for i in ids],
            "x": pts[:, 0].astype("float32"),
            "y": pts[:, 1].astype("float32"),
        }
    )
    df["member_id"] = df["member_id"].astype("int32")
    return df


def compute_link_predictions(
    member_emb: np.ndarray,
    caucus_emb: np.ndarray,
    member_ids: list[int],
    caucus_ids: list[int],
    memberships: pd.DataFrame,
    caucuses: pd.DataFrame,
    top_k: int = 10,
) -> pd.DataFrame:
    """For each (cong, member) predict top-K caucuses the member is NOT in
    but the model scores highly. Caucus pool = caucuses active in that cong."""
    m_idx = {mid: i for i, mid in enumerate(member_ids)}
    c_idx = {cid: i for i, cid in enumerate(caucus_ids)}

    # Held memberships per (cong, member)
    held: dict[tuple[int, int], set[int]] = {}
    for _, r in memberships.iterrows():
        held.setdefault((int(r["cong"]), int(r["member_id"])), set()).add(
            int(r["caucus_id"])
        )

    # Caucuses active per cong
    active: dict[int, list[int]] = {}
    for _, r in caucuses.iterrows():
        active.setdefault(int(r["cong"]), []).append(int(r["caucus_id"]))

    rows: list[dict] = []
    for (cong, mid), owned in held.items():
        if mid not in m_idx:
            continue
        pool = active.get(cong, [])
        pool_idx = [c_idx[c] for c in pool if c in c_idx and c not in owned]
        if not pool_idx:
            continue
        me = member_emb[m_idx[mid]]
        scores = caucus_emb[pool_idx] @ me  # cosine since normalized
        k = min(top_k, len(pool_idx))
        top = np.argpartition(-scores, kth=k - 1)[:k]
        order = top[np.argsort(-scores[top])]
        for rank, j in enumerate(order):
            cid = caucus_ids[pool_idx[j]]
            rows.append(
                {
                    "cong": cong,
                    "member_id": mid,
                    "caucus_id": int(cid),
                    "rank": rank + 1,
                    "score": float(scores[j]),
                }
            )
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["cong"] = df["cong"].astype("int32")
    df["member_id"] = df["member_id"].astype("int32")
    df["caucus_id"] = df["caucus_id"].astype("int32")
    df["rank"] = df["rank"].astype("int16")
    df["score"] = df["score"].astype("float32")
    return df


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading members...")
    members = load_members()
    print(f"  {len(members):,} rows across {members['cong'].nunique()} congresses")
    members.to_parquet(OUT_DIR / "members.parquet", compression="zstd", index=False)

    print("Loading caucuses...")
    caucuses = load_caucuses()
    print(f"  {len(caucuses):,} rows")
    caucuses.to_parquet(OUT_DIR / "caucuses.parquet", compression="zstd", index=False)

    print("Loading memberships...")
    memberships = load_memberships()
    print(f"  {len(memberships):,} rows")
    memberships.to_parquet(OUT_DIR / "memberships.parquet", compression="zstd", index=False)

    # ---- derived analytics ----
    print("Computing member stats (centrality + cross-party share)...")
    member_stats = compute_member_stats(memberships, members)
    print(f"  {len(member_stats):,} rows")
    member_stats.to_parquet(
        OUT_DIR / "member_stats.parquet", compression="zstd", index=False
    )

    print("Computing caucus stats (bipartisan score + nominate summary)...")
    caucus_stats = compute_caucus_stats(memberships, members, caucuses)
    print(f"  {len(caucus_stats):,} rows")
    caucus_stats.to_parquet(
        OUT_DIR / "caucus_stats.parquet", compression="zstd", index=False
    )

    print("Computing caucus lifecycle...")
    caucus_lifecycle = compute_caucus_lifecycle(caucus_stats)
    print(f"  {len(caucus_lifecycle):,} rows")
    caucus_lifecycle.to_parquet(
        OUT_DIR / "caucus_lifecycle.parquet", compression="zstd", index=False
    )

    print("Computing surprising cross-party pairs...")
    surprising_pairs = compute_surprising_pairs(memberships, members)
    print(f"  {len(surprising_pairs):,} rows")
    surprising_pairs.to_parquet(
        OUT_DIR / "surprising_pairs.parquet", compression="zstd", index=False
    )

    print("Computing state stats...")
    state_stats = compute_state_stats(memberships, members)
    print(f"  {len(state_stats):,} rows")
    state_stats.to_parquet(
        OUT_DIR / "state_stats.parquet", compression="zstd", index=False
    )

    # ---- embeddings ----
    print("Computing member × caucus factorization (TruncatedSVD)...")
    member_emb_df, caucus_emb_df, member_idx, caucus_idx = compute_factorization(
        memberships, members, caucuses, dim=32
    )
    print(
        f"  members {len(member_idx):,} × caucuses {len(caucus_idx):,} → dim 32"
    )
    member_emb_df.to_parquet(
        OUT_DIR / "member_embeddings.parquet", compression="zstd", index=False
    )
    caucus_emb_df.to_parquet(
        OUT_DIR / "caucus_embeddings.parquet", compression="zstd", index=False
    )

    member_ids_sorted = sorted(member_idx.keys(), key=lambda m: member_idx[m])
    caucus_ids_sorted = sorted(caucus_idx.keys(), key=lambda c: caucus_idx[c])
    dim = int(member_emb_df["d"].max()) + 1 if not member_emb_df.empty else 0
    member_emb_dense = _dense_from_long(
        member_emb_df, "member_id", member_idx, dim
    )
    caucus_emb_dense = _dense_from_long(
        caucus_emb_df, "caucus_id", caucus_idx, dim
    )

    print("Computing similar members (top-10)...")
    similar_members = compute_similar(
        member_emb_dense, member_ids_sorted, top_k=10, name="member_id"
    )
    similar_members.to_parquet(
        OUT_DIR / "similar_members.parquet", compression="zstd", index=False
    )
    print(f"  {len(similar_members):,} rows")

    print("Computing similar caucuses (top-10)...")
    similar_caucuses = compute_similar(
        caucus_emb_dense, caucus_ids_sorted, top_k=10, name="caucus_id"
    )
    similar_caucuses.to_parquet(
        OUT_DIR / "similar_caucuses.parquet", compression="zstd", index=False
    )
    print(f"  {len(similar_caucuses):,} rows")

    print("Computing 2D projection (UMAP)...")
    projection = compute_projection(member_emb_dense, member_ids_sorted)
    projection.to_parquet(
        OUT_DIR / "member_projection.parquet", compression="zstd", index=False
    )
    print(f"  {len(projection):,} rows")

    print("Computing link predictions (top-10 per member per cong)...")
    link_preds = compute_link_predictions(
        member_emb_dense,
        caucus_emb_dense,
        member_ids_sorted,
        caucus_ids_sorted,
        memberships,
        caucuses,
        top_k=10,
    )
    link_preds.to_parquet(
        OUT_DIR / "link_predictions.parquet", compression="zstd", index=False
    )
    print(f"  {len(link_preds):,} rows")

    meta = {
        "congress_min": int(members["cong"].min()),
        "congress_max": int(members["cong"].max()),
        "congresses": sorted(members["cong"].unique().tolist()),
        "member_count": int(members["member_id"].nunique()),
        "caucus_count": int(caucuses["caucus_id"].nunique()),
        "membership_count": int(len(memberships)),
        "has_nominate": sorted(
            members[members["nominate"].notna()]["cong"].unique().tolist()
        ),
        "derived_tables": [
            "member_stats",
            "caucus_stats",
            "caucus_lifecycle",
            "surprising_pairs",
            "state_stats",
            "member_embeddings",
            "caucus_embeddings",
            "similar_members",
            "similar_caucuses",
            "member_projection",
            "link_predictions",
        ],
        "embedding_dim": int(dim),
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))

    # Small sidecar for the in-browser NL search. Keeps the payload minimal —
    # (id, canonical_name) only, one entry per caucus.
    names_json = [
        {"id": int(r["caucus_id"]), "name": str(r["canonical_name"] or "")}
        for _, r in caucus_lifecycle.iterrows()
        if str(r["canonical_name"] or "").strip()
    ]
    (OUT_DIR / "caucus_names.json").write_text(json.dumps(names_json))
    print(f"  caucus_names.json: {len(names_json)} entries")

    print("\nMetadata:")
    print(json.dumps(meta, indent=2))

    for p in sorted(OUT_DIR.glob("*")):
        print(f"  {p.name}: {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
