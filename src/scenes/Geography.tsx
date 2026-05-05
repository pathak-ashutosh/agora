import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { useQuery } from '@/lib/use-query';
import { useApp } from '@/lib/store';
import { formatCongress } from '@/lib/utils';
import { STATE_GRID, STATE_GRID_COLS, STATE_GRID_ROWS } from '@/lib/state-grid';
import { navigate } from '@/lib/router';

type Metric = 'mean_caucus' | 'nominate' | 'cohesion' | 'delegation';

interface StateRow {
  state_abv: string;
  delegation_size: number;
  dems: number;
  reps: number;
  other: number;
  mean_nominate: number | null;
  cohesion: number | null;
  mean_caucus_count: number;
}

const METRICS: { key: Metric; label: string; help: string }[] = [
  { key: 'mean_caucus', label: 'Caucus participation', help: 'avg caucuses per MC in state delegation' },
  { key: 'nominate', label: 'Delegation ideology', help: 'mean DW-NOMINATE of state delegation' },
  { key: 'cohesion', label: 'Ideological cohesion', help: '1 − std(NOMINATE) — high = tight delegation' },
  { key: 'delegation', label: 'Delegation size', help: 'MCs per state (House + Senate)' },
];

export function Geography() {
  const cong = useApp((s) => s.cong);
  const [metric, setMetric] = useState<Metric>('mean_caucus');

  const rows = useQuery<StateRow>(
    `SELECT state_abv, delegation_size, dems, reps, other,
            mean_nominate, cohesion, mean_caucus_count
     FROM state_stats
     WHERE cong = ?`,
    [cong]
  );

  const byState = useMemo(() => {
    const map = new Map<string, StateRow>();
    if (rows.data) for (const r of rows.data) map.set(r.state_abv, r);
    return map;
  }, [rows.data]);

  // Compute min/max for active metric to scale color
  const scale = useMemo(() => {
    if (!rows.data || rows.data.length === 0) return { lo: 0, hi: 1 };
    const vals: number[] = [];
    for (const r of rows.data) {
      const v = extractMetric(r, metric);
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) return { lo: 0, hi: 1 };
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return { lo, hi };
  }, [rows.data, metric]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Geography — {formatCongress(cong)} Congress
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            State delegations on a tile-grid cartogram (every state one cell, regardless of size).
            Click a state to filter the Network Explorer to it.
          </p>
        </header>

        <Panel
          title={`${METRICS.find((m) => m.key === metric)?.label}`}
          right={
            <div className="flex gap-1">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMetric(m.key)}
                  title={m.help}
                  className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                    metric === m.key
                      ? 'bg-[var(--color-accent)] text-black'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          }
        >
          <div className="p-4">
            <StateGrid
              byState={byState}
              metric={metric}
              scale={scale}
              onClick={(abv) => {
                navigate(`/?states=${abv}`);
              }}
            />
            <Legend metric={metric} scale={scale} />
            <p className="mt-3 text-[11px] text-[var(--color-text-dim)]">
              {METRICS.find((m) => m.key === metric)?.help}
            </p>
          </div>
        </Panel>

        <Panel title="Delegations in detail">
          <div className="p-3 max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
                <tr>
                  <th className="text-left py-1 px-2">State</th>
                  <th className="text-right py-1 px-2">D/R/O</th>
                  <th className="text-right py-1 px-2">Mean cauc</th>
                  <th className="text-right py-1 px-2">Mean nom</th>
                  <th className="text-right py-1 px-2">Cohesion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.data
                  ?.slice()
                  .sort((a, b) => b.delegation_size - a.delegation_size)
                  .map((r) => (
                    <tr key={r.state_abv} className="hover:bg-[var(--color-surface-2)]">
                      <td className="py-1 px-2 font-mono">{r.state_abv}</td>
                      <td className="py-1 px-2 text-right font-mono tabular-nums text-[var(--color-text-muted)]">
                        {r.dems}/{r.reps}/{r.other}
                      </td>
                      <td className="py-1 px-2 text-right font-mono tabular-nums">
                        {r.mean_caucus_count.toFixed(1)}
                      </td>
                      <td className="py-1 px-2 text-right font-mono tabular-nums">
                        {r.mean_nominate != null ? r.mean_nominate.toFixed(2) : '—'}
                      </td>
                      <td className="py-1 px-2 text-right font-mono tabular-nums">
                        {r.cohesion != null ? r.cohesion.toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function extractMetric(r: StateRow, m: Metric): number | null {
  if (m === 'mean_caucus') return r.mean_caucus_count;
  if (m === 'nominate') return r.mean_nominate;
  if (m === 'cohesion') return r.cohesion;
  if (m === 'delegation') return r.delegation_size;
  return null;
}

function colorFor(value: number | null, metric: Metric, scale: { lo: number; hi: number }): string {
  if (value == null || !Number.isFinite(value)) return 'transparent';
  const { lo, hi } = scale;
  if (hi === lo) return '#f59e0b55';

  if (metric === 'nominate') {
    // diverging: red for liberal (negative) to red/right for conservative (positive)
    // Actually: blue (Dem-leaning) to red (Rep-leaning). center at 0.
    const t = Math.max(-1, Math.min(1, value));
    if (t < 0) {
      const a = Math.abs(t);
      return `rgba(59, 130, 246, ${0.2 + a * 0.8})`;
    }
    return `rgba(239, 68, 68, ${0.2 + t * 0.8})`;
  }

  // sequential: amber ramp
  const t = (value - lo) / (hi - lo);
  const alpha = 0.15 + t * 0.85;
  return `rgba(245, 158, 11, ${alpha})`;
}

function StateGrid({
  byState,
  metric,
  scale,
  onClick,
}: {
  byState: Map<string, { state_abv: string; delegation_size: number; dems: number; reps: number; other: number; mean_nominate: number | null; cohesion: number | null; mean_caucus_count: number }>;
  metric: Metric;
  scale: { lo: number; hi: number };
  onClick: (abv: string) => void;
}) {
  const cellSize = 46;
  const gap = 2;
  const width = STATE_GRID_COLS * cellSize + (STATE_GRID_COLS - 1) * gap;
  const height = STATE_GRID_ROWS * cellSize + (STATE_GRID_ROWS - 1) * gap;
  return (
    <div className="flex justify-center">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full h-auto"
      >
        {STATE_GRID.map((cell) => {
          const row = byState.get(cell.abv);
          const metricVal = row ? extractMetric(row, metric) : null;
          const fill = colorFor(metricVal, metric, scale);
          const x = cell.col * (cellSize + gap);
          const y = cell.row * (cellSize + gap);
          const active = row != null;
          return (
            <g
              key={cell.abv}
              transform={`translate(${x} ${y})`}
              onClick={() => active && onClick(cell.abv)}
              style={{ cursor: active ? 'pointer' : 'default' }}
            >
              <title>
                {cell.name}
                {row
                  ? ` · D${row.dems} R${row.reps} O${row.other}${row.mean_nominate != null ? ` · nom ${row.mean_nominate.toFixed(2)}` : ''}`
                  : ' · no data'}
              </title>
              <rect
                width={cellSize}
                height={cellSize}
                rx={4}
                ry={4}
                fill={fill}
                stroke="var(--color-border-strong)"
                strokeWidth={0.8}
              />
              <text
                x={cellSize / 2}
                y={cellSize / 2 + 1}
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontWeight: 600,
                  fill: 'var(--color-text)',
                  pointerEvents: 'none',
                }}
              >
                {cell.abv}
              </text>
              {row && row.delegation_size > 0 && (
                <text
                  x={cellSize / 2}
                  y={cellSize - 6}
                  textAnchor="middle"
                  style={{
                    fontSize: 8,
                    fill: 'var(--color-text-dim)',
                    fontFamily: 'ui-monospace, monospace',
                    pointerEvents: 'none',
                  }}
                >
                  {row.delegation_size}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ metric, scale }: { metric: Metric; scale: { lo: number; hi: number } }) {
  const fmt = (v: number) =>
    metric === 'nominate' || metric === 'cohesion'
      ? v.toFixed(2)
      : metric === 'mean_caucus'
        ? v.toFixed(1)
        : String(Math.round(v));

  if (metric === 'nominate') {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 text-[10px] font-mono text-[var(--color-text-dim)]">
        <span>more Dem</span>
        <div
          className="h-2 w-48 rounded"
          style={{
            background:
              'linear-gradient(to right, rgba(59,130,246,1), rgba(59,130,246,0.2), rgba(239,68,68,0.2), rgba(239,68,68,1))',
          }}
        />
        <span>more Rep</span>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-center justify-center gap-2 text-[10px] font-mono text-[var(--color-text-dim)]">
      <span>{fmt(scale.lo)}</span>
      <div
        className="h-2 w-48 rounded"
        style={{
          background: 'linear-gradient(to right, rgba(245,158,11,0.15), rgba(245,158,11,1))',
        }}
      />
      <span>{fmt(scale.hi)}</span>
    </div>
  );
}
