"""ICPSR identity plumbing: the crosswalk and the source-data fixes."""
import pandas as pd

from build_dataset import fix_ids
from prep_external import ICPSR_DROP, ICPSR_REMAP, person_icpsr


def test_person_icpsr_prefers_bioguide():
    thomas = {1151: 29568}
    bioguide = {"S001211": 21776}
    assert person_icpsr({"bioguide_id": "S001211"}, thomas, bioguide) == 21776
    assert person_icpsr({"thomas_id": "01151"}, thomas, bioguide) == 29568
    assert person_icpsr({"thomas_id": "00000"}, thomas, bioguide) is None
    assert person_icpsr({}, thomas, bioguide) is None


def test_known_source_fixes_present():
    assert ICPSR_REMAP[(111, 14835)] == 20946  # Hunter Sr. id reused for Jr.
    assert ICPSR_REMAP[(114, 2605)] == 21522   # J. Dingell id reused for D. Dingell
    assert (112, 99911) in ICPSR_DROP          # President Obama in caucus data


def test_fix_ids_remaps_and_drops():
    df = pd.DataFrame(
        {
            "cong": [111, 111, 112, 114],
            "member_id": [14835, 999, 99911, 2605],
        }
    )
    out = fix_ids(df, "member_id")
    # Obama row dropped
    assert len(out) == 3
    assert 99911 not in out.member_id.values
    # remaps applied only for the matching congress
    assert out[out.cong == 111].member_id.tolist() == [20946, 999]
    assert out[out.cong == 114].member_id.tolist() == [21522]


def test_fix_ids_leaves_other_congresses_alone():
    df = pd.DataFrame({"cong": [110], "member_id": [14835]})
    out = fix_ids(df, "member_id")
    assert out.member_id.tolist() == [14835]  # Hunter Sr. legitimately in 110
