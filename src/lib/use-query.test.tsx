import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from './use-query';
import { query } from './duckdb';

vi.mock('./duckdb', () => ({
  query: vi.fn(),
}));

const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
});

describe('useQuery', () => {
  it('loads data and clears the loading flag', async () => {
    mockQuery.mockResolvedValue([{ n: 1 }]);
    const { result } = renderHook(() => useQuery('SELECT 1', []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([{ n: 1 }]);
    expect(result.current.error).toBeUndefined();
  });

  it('null sql skips the query entirely (gating)', async () => {
    const { result } = renderHook(() => useQuery(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('surfaces query errors', async () => {
    mockQuery.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useQuery('SELECT bad', []));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error!.message).toBe('boom');
    expect(result.current.data).toBeUndefined();
  });

  it('re-runs when params change', async () => {
    mockQuery.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useQuery('SELECT ?', [id]),
      { initialProps: { id: 1 } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ id: 2 });
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
    expect(mockQuery).toHaveBeenLastCalledWith('SELECT ?', [2]);
  });

  it('ignores results from unmounted renders (no state update after cancel)', async () => {
    let resolve!: (v: unknown[]) => void;
    mockQuery.mockImplementation(
      () => new Promise<unknown[]>((r) => (resolve = r)) as Promise<never>
    );
    const { unmount } = renderHook(() => useQuery('SELECT slow', []));
    unmount();
    resolve([{ late: true }]); // must not throw or warn
  });
});
