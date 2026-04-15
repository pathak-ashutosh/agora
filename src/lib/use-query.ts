import { useEffect, useState } from 'react';
import { query } from './duckdb';

export interface QueryState<T> {
  data: T[] | undefined;
  loading: boolean;
  error: Error | undefined;
}

/**
 * Thin hook around DuckDB `query()`. Re-runs whenever the SQL or any
 * parameter changes. Parameters should be primitives for stable equality.
 */
export function useQuery<T = Record<string, unknown>>(
  sql: string | null,
  params: readonly unknown[] = []
): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  });

  const paramKey = JSON.stringify(params);

  useEffect(() => {
    if (!sql) {
      setState({ data: undefined, loading: false, error: undefined });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    query<T>(sql, params)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: undefined });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: undefined, loading: false, error: err });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, paramKey]);

  return state;
}
