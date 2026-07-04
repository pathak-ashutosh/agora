/**
 * DuckDB-WASM singleton. Instantiates the engine, registers the three
 * Parquet files from /data/ as virtual tables, and exposes `query()`.
 *
 * Data files are served statically by Vite from public/data/*.parquet.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm, mainWorker: mvp_worker },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: eh_worker },
};

let _conn: duckdb.AsyncDuckDBConnection | null = null;
let _ready: Promise<void> | null = null;

async function instantiate(): Promise<void> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!, { type: 'module' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();

  // Register the three parquet files as views. With DuckDB-WASM, reading a
  // parquet from a relative URL works by first registering the file URL.
  const origin = window.location.origin;
  const files = [
    'members',
    'caucuses',
    'memberships',
    'member_stats',
    'caucus_stats',
    'caucus_lifecycle',
    'surprising_pairs',
    'state_stats',
    'member_embeddings',
    'caucus_embeddings',
    'similar_members',
    'similar_caucuses',
    'member_projection',
    'link_predictions',
    'tgnn_embeddings',
    'tgnn_candidates',
  ];
  for (const name of files) {
    const url = `${origin}/data/${name}.parquet`;
    await db.registerFileURL(
      `${name}.parquet`,
      url,
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );
  }

  // Create views so queries can just say FROM members / caucuses / memberships
  for (const name of files) {
    await conn.query(
      `CREATE OR REPLACE VIEW ${name} AS SELECT * FROM read_parquet('${name}.parquet')`
    );
  }

  _conn = conn;
}

export function ensureDuckDB(): Promise<void> {
  if (!_ready) _ready = instantiate();
  return _ready;
}

/**
 * Run a SQL query and return plain JS objects.
 * Uses the persistent connection. Parameters are passed positionally via `?`.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T[]> {
  await ensureDuckDB();
  if (!_conn) throw new Error('DuckDB connection not initialized');

  let result;
  if (params.length === 0) {
    result = await _conn.query(sql);
  } else {
    const stmt = await _conn.prepare(sql);
    try {
      result = await stmt.query(...params);
    } finally {
      await stmt.close();
    }
  }
  return result.toArray().map((row) => row.toJSON()) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
