"""
export_model.py — export the temporal GNN for in-browser inference.

Two-tower serving split: node embeddings (GraphSAGE+GRU over congress
snapshots) are computed offline here and shipped as Parquet; the decoder
MLP runs live in the browser via ONNX Runtime Web over candidates fetched
with DuckDB-WASM. Feature standardization is baked into the ONNX graph, so
the frontend feeds raw feature values.

Writes:
  public/data/tgnn_decoder.onnx       — (zm[B,64], zc[B,64], f[B,15]) → logit
  public/data/tgnn_embeddings.parquet — n0, kind (m|c), ext_id, e0..e63
  public/data/tgnn_candidates.parquet — test-transition candidate pairs:
                                        n0, member_id, caucus_id, label, 15 raw feats
  public/data/tgnn_meta.json          — feature order, transitions, dims

Run after build_dataset.py:  uv run python research/export_model.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from baselines import FEATURES  # noqa: E402
from graphml import PAIR_FEATS, load_memberships  # noqa: E402
from temporal import HIST, add_history_features, train_temporal_gnn  # noqa: E402

OUT = HERE.parent / "public" / "data"
TEST_N0 = [112, 113, 114, 115]
SEED = 0


class DecoderWrapper(nn.Module):
    """Decoder MLP with feature standardization baked in."""

    def __init__(self, dec: nn.Module, mean: np.ndarray, std: np.ndarray):
        super().__init__()
        self.dec = dec
        self.register_buffer("mean", torch.tensor(mean, dtype=torch.float32))
        self.register_buffer("std", torch.tensor(std, dtype=torch.float32))

    def forward(self, zm, zc, f):
        x = torch.cat([zm, zc, zm * zc, (f - self.mean) / self.std], -1)
        return self.dec(x)


def main():
    pairs = pd.read_parquet(HERE / "pairs.parquet")
    pairs[FEATURES] = pairs[FEATURES].fillna(pairs[FEATURES].median())
    ms = load_memberships()
    pairs = add_history_features(pairs, ms)
    feat_cols = PAIR_FEATS + HIST

    _, val_ap, _, art = train_temporal_gnn(
        pairs, ms, feat_cols, SEED, return_artifacts=True
    )
    model, cache = art["model"], art["cache"]
    midx, cidx, fstats = art["midx"], art["cidx"], art["fstats"]
    print(f"trained (val AP {val_ap:.3f})")

    # node embeddings for test transitions
    rev_m = {v: k for k, v in midx.items()}
    rev_c = {v: k for k, v in cidx.items()}
    emb_rows = []
    with torch.no_grad():
        for n0 in TEST_N0:
            steps, mi, ci, _, _ = cache[n0]
            h = model.embed(steps).numpy()
            for gi in np.unique(mi.numpy()):
                emb_rows.append((n0, "m", rev_m[gi], *h[gi]))
            for gi in np.unique(ci.numpy()):
                emb_rows.append((n0, "c", rev_c[gi], *h[gi]))
    emb = pd.DataFrame(
        emb_rows, columns=["n0", "kind", "ext_id"] + [f"e{i}" for i in range(64)]
    )
    emb.to_parquet(OUT / "tgnn_embeddings.parquet", compression="zstd", index=False)

    # candidates with raw features — float32, sorted + small row groups so
    # DuckDB-WASM range requests only fetch the queried member's rows
    cand = pairs[pairs.n0.isin(TEST_N0)][
        ["n0", "member_id", "caucus_id", "label"] + feat_cols
    ].copy()
    cand[feat_cols] = cand[feat_cols].astype(np.float32)
    cand["label"] = cand.label.astype(np.int8)
    cand = cand.sort_values(["n0", "member_id"], kind="stable")
    cand.to_parquet(
        OUT / "tgnn_candidates.parquet", compression="zstd", index=False,
        row_group_size=20_000,
    )

    # decoder → ONNX (eval mode: dropout off)
    model.eval()
    wrapper = DecoderWrapper(model.dec, fstats[0].astype(np.float32),
                             fstats[1].astype(np.float32))
    wrapper.eval()
    B = 4
    dummy = (torch.zeros(B, 64), torch.zeros(B, 64), torch.zeros(B, len(feat_cols)))
    torch.onnx.export(
        wrapper, dummy, OUT / "tgnn_decoder.onnx",
        input_names=["zm", "zc", "f"], output_names=["logit"],
        dynamic_axes={n: {0: "batch"} for n in ["zm", "zc", "f", "logit"]},
        opset_version=17, dynamo=False,
    )

    (OUT / "tgnn_meta.json").write_text(json.dumps({
        "features": feat_cols,
        "test_transitions": TEST_N0,
        "embedding_dim": 64,
        "val_ap": round(float(val_ap), 4),
        "seed": SEED,
    }, indent=2))

    # parity check: onnx vs torch on real rows
    import onnxruntime as ort
    sess = ort.InferenceSession(str(OUT / "tgnn_decoder.onnx"))
    n0 = 115
    steps, mi, ci, px, y = cache[n0]
    with torch.no_grad():
        h = model.embed(steps)
        zm, zc = h[mi[:512]], h[ci[:512]]
        want = model.dec(
            torch.cat([zm, zc, zm * zc, px[:512]], -1)
        ).squeeze(-1).numpy()
    raw_f = cand[cand.n0 == n0][feat_cols].to_numpy().astype(np.float32)[:512]
    got = sess.run(None, {
        "zm": zm.numpy(), "zc": zc.numpy(), "f": raw_f,
    })[0].squeeze(-1)
    err = np.abs(want - got).max()
    print(f"onnx parity max|Δ| = {err:.2e}")
    assert err < 1e-4

    for f in ["tgnn_decoder.onnx", "tgnn_embeddings.parquet", "tgnn_candidates.parquet"]:
        print(f"  {f}: {(OUT / f).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
