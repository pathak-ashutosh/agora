import { Panel } from '@/components/ui/Panel';
import type { GraphStats as GraphStatsType } from '@/lib/graph-builder';

export function GraphStatsPanel({ stats, loading }: { stats: GraphStatsType | null; loading: boolean }) {
  return (
    <Panel title="Graph" className="text-xs">
      <div className="p-3 grid grid-cols-2 gap-y-2 gap-x-4 font-mono tabular-nums">
        <Row label="Nodes" value={loading ? '…' : stats?.nodeCount ?? 0} />
        <Row label="Edges" value={loading ? '…' : stats?.edgeCount ?? 0} />
        <Row label="Communities" value={loading ? '…' : stats?.communityCount ?? 0} />
        <Row label="Density" value={loading ? '…' : density(stats)} />
        <div className="col-span-2 pt-2 mt-1 border-t border-[var(--color-border)]">
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider mb-1">
            Congress totals
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <Row label="Members" value={stats?.totalMembers ?? '—'} />
            <Row label="Caucuses" value={stats?.totalCaucuses ?? '—'} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
        {label}
      </span>
      <span className="text-[var(--color-text)]">{value}</span>
    </div>
  );
}

function density(stats: GraphStatsType | null): string {
  if (!stats || stats.nodeCount < 2) return '—';
  const possible = (stats.nodeCount * (stats.nodeCount - 1)) / 2;
  return (stats.edgeCount / possible).toFixed(3);
}
