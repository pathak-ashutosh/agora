import { useEffect, useMemo, useState } from 'react';
import Graph from 'graphology';
import { SigmaGraph } from '@/components/graph/SigmaGraph';
import { NetworkFilters } from '@/components/network/NetworkFilters';
import { GraphStatsPanel } from '@/components/network/GraphStats';
import { NodeDetail } from '@/components/network/NodeDetail';
import { buildGraph, type GraphStats } from '@/lib/graph-builder';
import { useApp } from '@/lib/store';

export function NetworkExplorer() {
  const {
    cong,
    nodeMode,
    edgeKind,
    topN,
    parties,
    states,
    minEdgeWeight,
    expanded,
    selection,
    setSelection,
    expand,
  } = useApp();

  const [graph, setGraph] = useState<Graph | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable keys for effect dep array
  const partiesKey = useMemo(() => [...parties].sort().join(','), [parties]);
  const statesKey = useMemo(() => [...states].sort().join(','), [states]);
  const expandedKey = useMemo(() => [...expanded].sort().join('|'), [expanded]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    buildGraph({
      cong,
      mode: nodeMode,
      edgeKind,
      topN,
      parties: [...parties],
      states: [...states],
      minEdgeWeight,
      expanded: [...expanded],
    })
      .then(({ graph, stats }) => {
        if (cancelled) return;
        setGraph(graph);
        setStats(stats);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cong, nodeMode, edgeKind, topN, minEdgeWeight, partiesKey, statesKey, expandedKey]);

  const selectedNodeId = selection
    ? selection.kind === 'member'
      ? `m:${selection.id}`
      : `c:${selection.id}`
    : null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left controls */}
      <div className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-3 overflow-y-auto">
        <NetworkFilters />
        <GraphStatsPanel stats={stats} loading={loading} />
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative bg-[var(--color-bg)]">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-rep)] text-sm">
            Error: {error}
          </div>
        ) : loading && !graph ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-dim)] text-xs">
            Loading graph…
          </div>
        ) : graph ? (
          <SigmaGraph
            graph={graph}
            selectedNode={selectedNodeId}
            expandedNodes={expanded}
            onNodeClick={(nodeId) => {
              const [kind, rawId] = nodeId.split(':');
              setSelection({
                kind: kind === 'm' ? 'member' : 'caucus',
                id: Number(rawId),
              });
            }}
            onNodeDoubleClick={(nodeId) => expand(nodeId)}
            onBackgroundClick={() => setSelection(null)}
          />
        ) : null}

        {loading && graph ? (
          <div className="absolute top-2 right-2 text-[10px] font-mono text-[var(--color-text-dim)] bg-[var(--color-surface)] px-2 py-1 rounded border border-[var(--color-border)]">
            rebuilding…
          </div>
        ) : null}
      </div>

      {/* Right detail */}
      <div className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg)] p-3 overflow-y-auto">
        <NodeDetail />
      </div>
    </div>
  );
}
