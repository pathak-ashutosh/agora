import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { SceneHeader } from '@/components/ui/SceneHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery } from '@/lib/use-query';
import { partyInfo } from '@/lib/utils';
import { navigate } from '@/lib/router';

interface Row {
  member_id: number;
  x: number;
  y: number;
  mc_name: string;
  party: number;
  state_abv: string;
  degree: number;
}

export function EmbeddingSpace() {
  const { data, loading } = useQuery<Row>(
    `WITH latest AS (
       SELECT member_id, MAX(cong) AS cong
       FROM members
       GROUP BY member_id
     )
     SELECT mp.member_id, mp.x, mp.y,
            m.mc_name, m.party, m.state_abv,
            COALESCE(ms.degree, 0) AS degree
     FROM member_projection mp
     JOIN latest l ON l.member_id = mp.member_id
     JOIN members m ON m.member_id = l.member_id AND m.cong = l.cong
     LEFT JOIN member_stats ms ON ms.member_id = m.member_id AND ms.cong = m.cong`
  );

  const [hover, setHover] = useState<Row | null>(null);
  const [party, setParty] = useState<Set<number>>(new Set());
  const toggleParty = (p: number) => {
    setParty((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const points = useMemo(() => {
    if (!data) return [];
    if (party.size === 0) return data;
    return data.filter((r) => party.has(r.party));
  }, [data, party]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto space-y-4">
        <SceneHeader
          kicker="every member, one map"
          title="Embedding Space"
          lede="2D UMAP projection of a 32-dim Truncated-SVD embedding of the member × caucus matrix (pooled across all congresses). Each point is a member; proximity means similar caucus portfolios. Colors = party."
        />

        <Panel
          className="reveal reveal-1"
          title="Member embedding (UMAP 2D)"
          right={
            <div className="flex items-center gap-2">
              {[100, 200, 328].map((p) => {
                const pi = partyInfo(p);
                const active = party.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggleParty(p)}
                    className="px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider"
                    style={{
                      borderColor: active ? pi.color : 'var(--color-border-strong)',
                      background: active ? `${pi.color}22` : 'transparent',
                      color: active ? pi.color : 'var(--color-text-muted)',
                    }}
                  >
                    {pi.short}
                  </button>
                );
              })}
            </div>
          }
        >
          <div className="p-3 relative">
            {loading ? (
              <Skeleton className="w-full aspect-[760/560] rounded" />
            ) : (
              <Scatter
                points={points}
                onHover={setHover}
                onClick={(r) => navigate(`/member?id=${r.member_id}`)}
              />
            )}

            {hover && (
              <div className="absolute top-4 right-4 px-3.5 py-2.5 rounded-lg bg-[var(--color-surface-2)]/95 backdrop-blur border border-[var(--color-border-strong)] text-xs max-w-xs shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: partyInfo(hover.party).color }}
                  />
                  <span className="font-display text-sm">{hover.mc_name}</span>
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono">
                  {partyInfo(hover.party).short} · {hover.state_abv} · degree {hover.degree}
                </div>
              </div>
            )}
          </div>
        </Panel>

        <p className="text-[11px] text-[var(--color-text-dim)] text-center">
          hover a dot for detail · click to open member profile
        </p>
      </div>
    </div>
  );
}

function Scatter({
  points,
  onHover,
  onClick,
}: {
  points: Row[];
  onHover: (r: Row | null) => void;
  onClick: (r: Row) => void;
}) {
  const W = 760;
  const H = 560;
  const pad = 24;

  // Data is already scaled ~ [-1, 1]
  const toX = (v: number) => pad + ((v + 1) / 2) * (W - 2 * pad);
  const toY = (v: number) => pad + ((1 - (v + 1) / 2)) * (H - 2 * pad);
  const rOf = (degree: number) => Math.min(5, 1.4 + Math.sqrt(degree) * 0.35);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="bg-[var(--color-bg)] rounded border border-[var(--color-border)]"
      onMouseLeave={() => onHover(null)}
    >
      {/* subtle axes */}
      <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke="var(--color-border)" strokeDasharray="2,3" />
      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="var(--color-border)" strokeDasharray="2,3" />
      {points.map((p) => (
        <circle
          key={p.member_id}
          cx={toX(p.x)}
          cy={toY(p.y)}
          r={rOf(p.degree)}
          fill={partyInfo(p.party).color}
          fillOpacity={0.75}
          stroke="var(--color-bg)"
          strokeWidth={0.5}
          onMouseEnter={() => onHover(p)}
          onClick={() => onClick(p)}
          style={{ cursor: 'pointer', transition: 'r 0.15s ease, fill-opacity 0.15s ease' }}
          onMouseLeave={(e) => {
            (e.target as SVGCircleElement).setAttribute('fill-opacity', '0.75');
          }}
          onMouseOver={(e) => {
            (e.target as SVGCircleElement).setAttribute('fill-opacity', '1');
          }}
        />
      ))}
    </svg>
  );
}
