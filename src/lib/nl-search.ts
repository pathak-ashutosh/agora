/**
 * Natural-language caucus search using a small sentence-embedding model
 * (all-MiniLM-L6-v2) loaded via @huggingface/transformers. Runs entirely in
 * the browser; model weights come from the HF CDN on first use.
 *
 * Caucus-name embeddings are precomputed the first time the user opens NL
 * search, then cached in IndexedDB under a fingerprint so future sessions
 * skip the computation.
 */
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = '/models/all-MiniLM-L6-v2/';
const EMBED_DIM = 384;
const CACHE_DB = 'agora-nl-cache';
const CACHE_STORE = 'embeddings';
const CACHE_KEY = 'caucus-names-v2';

export interface NameEntry {
  id: number;
  name: string;
}

export interface NlMatch {
  id: number;
  name: string;
  score: number;
}

let _pipeline: FeatureExtractionPipeline | null = null;
let _cached: { ids: Int32Array; emb: Float32Array; names: Map<number, string> } | null = null;

// -- IndexedDB micro-helper (avoid pulling in a library) -----------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const req = tx.objectStore(CACHE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -- Model load + caucus-name embedding ---------------------------------

async function loadPipeline(
  onProgress?: (msg: string) => void
): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;
  onProgress?.('loading model…');
  const tx = await import('@huggingface/transformers');
  _pipeline = (await tx.pipeline('feature-extraction', MODEL_ID, {
    local_files_only: true,
    progress_callback: (p: unknown) => {
      if (onProgress && typeof p === 'object' && p && 'status' in p) {
        onProgress(String((p as { status: string }).status));
      }
    },
  })) as FeatureExtractionPipeline;
  return _pipeline;
}

async function embedBatch(
  pipe: FeatureExtractionPipeline,
  texts: string[]
): Promise<Float32Array[]> {
  const out = await pipe(texts, { pooling: 'mean', normalize: true });
  const flat = out.data as Float32Array;
  const rows: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    rows.push(flat.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
  }
  return rows;
}

export async function ensureCaucusEmbeddings(
  onProgress?: (msg: string) => void
): Promise<void> {
  if (_cached) return;

  const res = await fetch('/data/caucus_names.json');
  const names = (await res.json()) as NameEntry[];

  const cached = await idbGet<{
    ids: Int32Array;
    emb: Float32Array;
    version: number;
  }>(CACHE_KEY);

  if (cached && cached.ids.length === names.length) {
    const nameMap = new Map<number, string>();
    for (const n of names) nameMap.set(n.id, n.name);
    _cached = { ids: cached.ids, emb: cached.emb, names: nameMap };
    onProgress?.('cached');
    return;
  }

  onProgress?.('loading model…');
  const pipe = await loadPipeline(onProgress);

  const ids = new Int32Array(names.length);
  const emb = new Float32Array(names.length * EMBED_DIM);
  const batchSize = 32;
  for (let i = 0; i < names.length; i += batchSize) {
    const slice = names.slice(i, i + batchSize);
    const vecs = await embedBatch(
      pipe,
      slice.map((n) => n.name)
    );
    for (let j = 0; j < slice.length; j++) {
      ids[i + j] = slice[j].id;
      emb.set(vecs[j], (i + j) * EMBED_DIM);
    }
    onProgress?.(`embedding caucuses ${Math.min(i + batchSize, names.length)}/${names.length}`);
  }

  const nameMap = new Map<number, string>();
  for (const n of names) nameMap.set(n.id, n.name);
  _cached = { ids, emb, names: nameMap };
  await idbSet(CACHE_KEY, { ids, emb, version: 1 });
  onProgress?.('ready');
}

export async function searchNl(
  query: string,
  topK: number = 25,
  onProgress?: (msg: string) => void
): Promise<NlMatch[]> {
  await ensureCaucusEmbeddings(onProgress);
  if (!_cached) return [];
  const pipe = await loadPipeline(onProgress);
  const [qv] = await embedBatch(pipe, [query]);

  const N = _cached.ids.length;
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    const off = i * EMBED_DIM;
    for (let d = 0; d < EMBED_DIM; d++) s += _cached.emb[off + d] * qv[d];
    scores[i] = s;
  }

  const idxs: number[] = [];
  for (let i = 0; i < N; i++) idxs.push(i);
  idxs.sort((a, b) => scores[b] - scores[a]);
  const keep = idxs.slice(0, topK);
  return keep.map((i) => ({
    id: _cached!.ids[i],
    name: _cached!.names.get(_cached!.ids[i]) ?? '',
    score: scores[i],
  }));
}
