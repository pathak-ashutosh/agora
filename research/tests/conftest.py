import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))            # prep_external
sys.path.insert(0, str(ROOT / "research"))  # baselines, temporal, …
