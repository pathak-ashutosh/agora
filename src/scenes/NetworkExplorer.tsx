import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import { SigmaGraph, type SigmaGraphHandle } from '@/components/graph/SigmaGraph';
import { NetworkFilters } from '@/components/network/NetworkFilters';
import { GraphStatsPanel } from '@/components/network/GraphStats';
import { NodeDetail } from '@/components/network/NodeDetail';
import { buildGraph, type GraphStats } from '@/lib/graph-builder';
import { useApp } from '@/lib/store';
import { readUrlState, buildUrl, replaceUrl } from '@/lib/url-state';
import { Download, Info, X } from 'lucide-react';

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
    setCong,
    setNodeMode,
    setEdgeKind,
    setTopN,
    setMinEdgeWeight,
    toggleParty,
    toggleState,
  } = useApp();

  const [graph, setGraph] = useState<Graph | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable keys for effect dep array
  const partiesKey = useMemo(() => [...parties].sort().join(','), [parties]);
  const statesKey = useMemo(() => [...states].sort().join(','), [states]);
  const expandedKey = useMemo(() => [...expanded].sort().join('|'), [expanded]);

  // --- URL state sync ---
  const hydratedFromUrl = useRef(false);
  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const u = readUrlState();
    if (u.cong !== undefined) setCong(u.cong);
    if (u.nodeMode) setNodeMode(u.nodeMode);
    if (u.edgeKind) setEdgeKind(u.edgeKind);
    if (u.topN !== undefined) setTopN(u.topN);
    if (u.minEdgeWeight !== undefined) setMinEdgeWeight(u.minEdgeWeight);
    if (u.parties) {
      for (const p of u.parties) toggleParty(p);
    }
    if (u.states) {
      for (const s of u.states) toggleState(s);
    }
    if (u.expanded) {
      for (const id of u.expanded) useApp.getState().expand(id);
    }
    if (u.selection) setSelection(u.selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write back to URL (replaceState — filter tweaks shouldn't pollute history)
  useEffect(() => {
    if (!hydratedFromUrl.current) return;
    const url = buildUrl({
      path: '/',
      cong,
      nodeMode,
      edgeKind,
      topN,
      minEdgeWeight,
      parties: [...parties],
      states: [...states],
      expanded: [...expanded],
      selection,
    });
    replaceUrl(url);
  }, [cong, nodeMode, edgeKind, topN, minEdgeWeight, partiesKey, statesKey, expandedKey, selection, parties, states, expanded]);

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

  const sigmaRef = useRef<SigmaGraphHandle>(null);
  const exportPng = () => {
    const url = sigmaRef.current?.toPngDataURL();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `agora-${nodeMode}-${cong}-${Date.now()}.png`;
    a.click();
  };

  const [introDismissed, setIntroDismissed] = useState(() => {
    try {
      return window.localStorage.getItem('agora-intro-dismissed') === '1';
    } catch {
      return false;
    }
  });
  const dismissIntro = () => {
    setIntroDismissed(true);
    try {
      window.localStorage.setItem('agora-intro-dismissed', '1');
    } catch {
      // storage may be disabled — ignore
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left controls */}
      <div className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-3 overflow-y-auto">
        <NetworkFilters />
        <GraphStatsPanel stats={stats} loading={loading} />
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative bg-[var(--color-bg)]">
        {!introDismissed && (
          <div className="absolute top-3 left-3 z-10 max-w-md rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 backdrop-blur px-3.5 py-3 text-[11px] text-[var(--color-text-muted)] shadow-[0_8px_32px_rgba(0,0,0,0.5)] reveal">
            <div className="flex items-start gap-2.5">
              <Info size={13} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-display text-[13px] text-[var(--color-text)] mb-1">
                  How this works
                </div>
                <p className="leading-relaxed">
                  Nodes are members of Congress, sized by caucus count. Edges connect
                  members who share caucuses. Colors = party.{' '}
                  <span className="text-[var(--color-text-dim)]">
                    Click a node for detail · double-click to pin · drag to pan · scroll to zoom.
                  </span>
                </p>
              </div>
              <button
                onClick={dismissIntro}
                className="text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
                aria-label="Dismiss intro"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-rep)] text-sm">
            Error: {error}
          </div>
        ) : loading && !graph ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--color-text-dim)] text-xs">
            <div className="relative w-10 h-10">
              <div className="absolute inset-0 rounded-full border border-[var(--color-border-strong)]" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--color-accent)] animate-spin" />
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em]">
              computing layout…
            </div>
          </div>
        ) : graph && graph.order === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-dim)] text-xs">
            <div className="font-display text-base text-[var(--color-text-muted)]">
              No members match current filters
            </div>
            <div className="text-[10px]">Clear filters or switch congress to see the graph.</div>
          </div>
        ) : graph ? (
          <SigmaGraph
            ref={sigmaRef}
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
          <div className="absolute top-3 right-3 flex items-center gap-2 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface)]/95 backdrop-blur px-2.5 py-1.5 rounded-full border border-[var(--color-border-strong)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            rebuilding…
          </div>
        ) : null}

        {graph && graph.order > 0 && (
          <button
            onClick={exportPng}
            title="Download current view as PNG"
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-surface)]/95 backdrop-blur border border-[var(--color-border-strong)] rounded-full hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] active:scale-95 transition-all"
          >
            <Download size={12} />
            <span>PNG</span>
          </button>
        )}
      </div>

      {/* Right detail */}
      <div className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg)] p-3 overflow-y-auto">
        <NodeDetail />
      </div>
    </div>
  );
}
