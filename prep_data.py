"""
prep_data.py — convert raw CSVs in DATA/ to compact Parquet files in public/data/.

Reads:
  DATA/mc_attributes{N}.csv            — member metadata per congress
  DATA/caucus_attributes{N}.csv        — caucus metadata per congress
  DATA/caucus_membership{N}LONG.csv    — long-format memberships (0/1 flag)

Writes:
  public/data/members.parquet          — (cong, member_id, mc_name, party, state_abv, cd, nominate)
  public/data/caucuses.parquet         — (cong, caucus_id, caucus_name)
  public/data/memberships.parquet      — (cong, member_id, caucus_id)  [only rows where member=1]
  public/data/metadata.json            — summary (congress range, counts)

Run with:
  uv run prep_data.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

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
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))

    print("\nMetadata:")
    print(json.dumps(meta, indent=2))

    for p in sorted(OUT_DIR.glob("*")):
        print(f"  {p.name}: {p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
