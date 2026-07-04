/**
 * In-browser inference for the temporal-GNN caucus-choice model.
 *
 * Two-tower serving split: node embeddings (GraphSAGE + GRU over congress
 * snapshots) are precomputed offline (research/export_model.py) and shipped
 * as tgnn_embeddings.parquet; this module runs the decoder MLP live with
 * ONNX Runtime Web over candidates fetched via DuckDB. Feature
 * standardization is baked into the ONNX graph — we feed raw values.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { query } from './duckdb';

// bundle build embeds the loader mjs; only the .wasm needs a URL
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1; // no SharedArrayBuffer requirement

interface TgnnMeta {
  features: string[];
  test_transitions: number[];
  embedding_dim: number;
  val_ap: number;
  seed: number;
}

let _session: Promise<ort.InferenceSession> | null = null;
let _meta: Promise<TgnnMeta> | null = null;

export function loadMeta(): Promise<TgnnMeta> {
  if (!_meta) _meta = fetch('/data/tgnn_meta.json').then((r) => r.json());
  return _meta;
}

function loadSession(): Promise<ort.InferenceSession> {
  if (!_session) {
    _session = ort.InferenceSession.create('/data/tgnn_decoder.onnx', {
      executionProviders: ['wasm'],
    });
  }
  return _session;
}

export interface ScoredCaucus {
  caucus_id: number;
  caucus_name: string;
  prob: number;
  rank: number;
  joined: boolean;
  wasBefore: boolean;
}

const EMB_COLS = Array.from({ length: 64 }, (_, i) => `e${i}`).join(', ');

/** Score every candidate caucus for one member at transition n0 → n0+1. */
export async function scoreMember(
  n0: number,
  memberId: number
): Promise<ScoredCaucus[]> {
  const [meta, session] = await Promise.all([loadMeta(), loadSession()]);
  const D = meta.embedding_dim;

  const [cands, memEmb, caucEmb] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT c.*, ca.caucus_name
       FROM tgnn_candidates c
       JOIN caucuses ca ON ca.caucus_id = c.caucus_id AND ca.cong = ?
       WHERE c.n0 = ? AND c.member_id = ?`,
      [n0 + 1, n0, memberId]
    ),
    query<Record<string, unknown>>(
      `SELECT ${EMB_COLS} FROM tgnn_embeddings
       WHERE n0 = ? AND kind = 'm' AND ext_id = ?`,
      [n0, memberId]
    ),
    query<Record<string, unknown>>(
      `SELECT ext_id, ${EMB_COLS} FROM tgnn_embeddings
       WHERE n0 = ? AND kind = 'c'`,
      [n0]
    ),
  ]);
  if (cands.length === 0 || memEmb.length === 0) return [];

  const zmRow = new Float32Array(D);
  for (let i = 0; i < D; i++) zmRow[i] = Number(memEmb[0][`e${i}`]);

  const caucVec = new Map<number, Float32Array>();
  for (const row of caucEmb) {
    const v = new Float32Array(D);
    for (let i = 0; i < D; i++) v[i] = Number(row[`e${i}`]);
    caucVec.set(Number(row.ext_id), v);
  }

  const rows = cands.filter((c) => caucVec.has(Number(c.caucus_id)));
  const B = rows.length;
  const zm = new Float32Array(B * D);
  const zc = new Float32Array(B * D);
  const f = new Float32Array(B * meta.features.length);
  rows.forEach((c, b) => {
    zm.set(zmRow, b * D);
    zc.set(caucVec.get(Number(c.caucus_id))!, b * D);
    meta.features.forEach((name, j) => {
      f[b * meta.features.length + j] = Number(c[name]);
    });
  });

  const out = await session.run({
    zm: new ort.Tensor('float32', zm, [B, D]),
    zc: new ort.Tensor('float32', zc, [B, D]),
    f: new ort.Tensor('float32', f, [B, meta.features.length]),
  });
  const logits = out.logit.data as Float32Array;

  const scored = rows.map((c, b) => ({
    caucus_id: Number(c.caucus_id),
    caucus_name: String(c.caucus_name),
    prob: 1 / (1 + Math.exp(-logits[b])),
    rank: 0,
    joined: Number(c.label) === 1,
    wasBefore: Number(c.was_before) === 1,
  }));
  scored.sort((a, b) => b.prob - a.prob);
  scored.forEach((s, i) => (s.rank = i + 1));
  return scored;
}
