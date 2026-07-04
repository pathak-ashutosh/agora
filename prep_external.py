"""
prep_external.py — convert EXTERNAL/ raw data into Parquet in public/data/.

Run scripts/fetch_external.sh first. Companion to prep_data.py (which handles
the original DATA/ caucus CSVs); this handles the external sources that extend
the project to roll-call votes and cosponsorship networks.

Reads:
  EXTERNAL/voteview/HSall_members.csv        — all-congress member file
  EXTERNAL/voteview/H{N}_votes.csv           — House roll-call votes
  EXTERNAL/voteview/H{N}_rollcalls.csv       — rollcall metadata
  EXTERNAL/propublica_bills/{N}.zip          — bulk bill JSON (sponsor+cosponsors)
  EXTERNAL/legislators/legislators-*.csv     — thomas/bioguide → icpsr crosswalk

Writes:
  public/data/members_voteview.parquet  — (cong, icpsr, bioguide_id, party_code,
                                           nominate_dim1, nominate_dim2, born)
  public/data/bills.parquet             — one row per House bill, sponsor_icpsr
  public/data/cosponsorships.parquet    — (cong, bill_id, icpsr, role,
                                           sponsored_at, original, withdrawn)
  public/data/votes.parquet             — (cong, rollnumber, icpsr, cast_code)
  public/data/rollcalls.parquet         — (cong, rollnumber, date, bill_id,
                                           yea, nay, result, question)

Run with:
  uv run prep_external.py
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
EXT = ROOT / "EXTERNAL"
OUT = ROOT / "public" / "data"

CONGS = [103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116]
HOUSE_BILL_TYPES = {"hr", "hres", "hjres", "hconres"}

# Source-data ICPSR fixes (see DATA quirks): father's ID reused for successor,
# and President Obama appearing as a "member" in cong 112 caucus data.
ICPSR_REMAP = {(111, 14835): 20946, (114, 2605): 21522}  # Hunter Jr., D. Dingell
ICPSR_DROP = {(112, 99911)}  # Obama


def build_crosswalk() -> tuple[dict[int, int], dict[str, int]]:
    """thomas_id → icpsr and bioguide_id → icpsr."""
    frames = [
        pd.read_csv(EXT / "legislators" / f, low_memory=False)
        for f in ("legislators-historical.csv", "legislators-current.csv")
    ]
    leg = pd.concat(frames, ignore_index=True)
    leg = leg.dropna(subset=["icpsr_id"])
    thomas = {
        int(t): int(i)
        for t, i in zip(leg["thomas_id"], leg["icpsr_id"])
        if pd.notna(t)
    }
    bioguide = {
        b: int(i) for b, i in zip(leg["bioguide_id"], leg["icpsr_id"]) if pd.notna(b)
    }
    # Supplement with Voteview's own bioguide↔icpsr pairs (covers recent members
    # whose icpsr_id hasn't landed in congress-legislators yet).
    vv = pd.read_csv(EXT / "voteview" / "HSall_members.csv", low_memory=False)
    vv = vv.dropna(subset=["bioguide_id"])
    for b, i in zip(vv["bioguide_id"], vv["icpsr"]):
        bioguide.setdefault(b, int(i))
    return thomas, bioguide


def person_icpsr(p: dict, thomas: dict[int, int], bioguide: dict[str, int]) -> int | None:
    if p.get("bioguide_id"):
        return bioguide.get(p["bioguide_id"])
    if p.get("thomas_id"):
        return thomas.get(int(p["thomas_id"]))
    return None


def parse_bills() -> tuple[pd.DataFrame, pd.DataFrame]:
    thomas, bioguide = build_crosswalk()
    bill_rows, cosp_rows = [], []
    unmatched = 0

    for cong in CONGS:
        zpath = EXT / "propublica_bills" / f"{cong}.zip"
        with zipfile.ZipFile(zpath) as zf:
            names = [
                n
                for n in zf.namelist()
                if n.endswith("/data.json")
                and ("/bills/" in n or n.startswith("bills/"))
                and "/amendments/" not in n
            ]
            for name in names:
                after = name.split("bills/", 1)[1]
                bill_type = after.split("/")[0]
                if bill_type not in HOUSE_BILL_TYPES:
                    continue
                b = json.loads(zf.read(name))
                sponsor = b.get("sponsor") or {}
                s_icpsr = person_icpsr(sponsor, thomas, bioguide)
                if sponsor and s_icpsr is None:
                    unmatched += 1
                bill_id = b["bill_id"]
                bill_rows.append(
                    {
                        "cong": cong,
                        "bill_id": bill_id,
                        "bill_type": bill_type,
                        "number": int(b["number"]),
                        "introduced_at": b.get("introduced_at"),
                        "title": b.get("short_title") or b.get("official_title"),
                        "top_subject": b.get("subjects_top_term"),
                        "status": b.get("status"),
                        "sponsor_icpsr": s_icpsr,
                        "n_cosponsors": len(b.get("cosponsors", [])),
                    }
                )
                if s_icpsr is not None:
                    cosp_rows.append(
                        {
                            "cong": cong,
                            "bill_id": bill_id,
                            "icpsr": s_icpsr,
                            "role": "sponsor",
                            "sponsored_at": b.get("introduced_at"),
                            "original": True,
                            "withdrawn": False,
                        }
                    )
                for c in b.get("cosponsors", []):
                    c_icpsr = person_icpsr(c, thomas, bioguide)
                    if c_icpsr is None:
                        unmatched += 1
                        continue
                    cosp_rows.append(
                        {
                            "cong": cong,
                            "bill_id": bill_id,
                            "icpsr": c_icpsr,
                            "role": "cosponsor",
                            "sponsored_at": c.get("sponsored_at"),
                            "original": bool(c.get("original_cosponsor", False)),
                            "withdrawn": c.get("withdrawn_at") is not None,
                        }
                    )
        print(f"  cong {cong}: {sum(r['cong'] == cong for r in bill_rows)} bills")

    print(f"  unmatched sponsor/cosponsor records: {unmatched}")
    return pd.DataFrame(bill_rows), pd.DataFrame(cosp_rows)


def parse_voteview() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    mem = pd.read_csv(EXT / "voteview" / "HSall_members.csv", low_memory=False)
    mem = mem[(mem.chamber == "House") & (mem.congress.isin(CONGS))]
    members = mem[
        [
            "congress",
            "icpsr",
            "bioguide_id",
            "state_abbrev",
            "district_code",
            "party_code",
            "nominate_dim1",
            "nominate_dim2",
            "born",
        ]
    ].rename(columns={"congress": "cong"})

    votes = pd.concat(
        [
            pd.read_csv(EXT / "voteview" / f"H{c}_votes.csv", usecols=["congress", "rollnumber", "icpsr", "cast_code"])
            for c in CONGS
        ],
        ignore_index=True,
    ).rename(columns={"congress": "cong"})

    rc_cols = ["congress", "rollnumber", "date", "bill_number", "yea_count", "nay_count", "vote_result", "vote_question"]
    rollcalls = pd.concat(
        [pd.read_csv(EXT / "voteview" / f"H{c}_rollcalls.csv", usecols=rc_cols, low_memory=False) for c in CONGS],
        ignore_index=True,
    ).rename(columns={"congress": "cong", "bill_number": "bill_id"})

    return members, votes, rollcalls


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    print("parsing voteview…")
    members, votes, rollcalls = parse_voteview()
    members.to_parquet(OUT / "members_voteview.parquet", index=False)
    votes.to_parquet(OUT / "votes.parquet", index=False)
    rollcalls.to_parquet(OUT / "rollcalls.parquet", index=False)
    print(f"  members {len(members):,} · votes {len(votes):,} · rollcalls {len(rollcalls):,}")

    print("parsing bills…")
    bills, cosp = parse_bills()
    bills.to_parquet(OUT / "bills.parquet", index=False)
    cosp.to_parquet(OUT / "cosponsorships.parquet", index=False)
    print(f"  bills {len(bills):,} · sponsorship rows {len(cosp):,}")

    for f in ["members_voteview", "votes", "rollcalls", "bills", "cosponsorships"]:
        p = OUT / f"{f}.parquet"
        print(f"  {p.name}: {p.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
