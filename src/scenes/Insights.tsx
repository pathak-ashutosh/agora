import { Panel } from '@/components/ui/Panel';
import { SceneHeader } from '@/components/ui/SceneHeader';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useQuery } from '@/lib/use-query';
import { useApp } from '@/lib/store';
import { partyInfo, formatCongress } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { Network, Scale, Users } from 'lucide-react';

interface BridgeRow {
  member_id: number;
  mc_name: string;
  party: number;
  state_abv: string;
  betweenness: number;
  degree: number;
  cross_party_share: number | null;
  peer_count: number;
}

interface BipartisanCaucusRow {
  caucus_id: number;
  caucus_name: string;
  size: number;
  dems: number;
  reps: number;
  bipartisan_score: number;
  std_nominate: number | null;
  state_count: number;
}

interface SurprisingPair {
  member_a: number;
  member_b: number;
  name_a: string;
  name_b: string;
  party_a: number;
  party_b: number;
  state_a: string;
  state_b: string;
  shared: number;
  ideology_gap: number | null;
  score: number;
}

export function Insights() {
  const cong = useApp((s) => s.cong);

  const bridges = useQuery<BridgeRow>(
    `SELECT ms.member_id, m.mc_name, m.party, m.state_abv,
            ms.betweenness, ms.degree, ms.cross_party_share, ms.peer_count
     FROM member_stats ms
     JOIN members m ON m.member_id = ms.member_id AND m.cong = ms.cong
     WHERE ms.cong = ? AND ms.peer_count >= 5
     ORDER BY ms.betweenness DESC
     LIMIT 20`,
    [cong]
  );

  const bipartisan = useQuery<BipartisanCaucusRow>(
    `SELECT caucus_id, caucus_name, size, dems, reps,
            bipartisan_score, std_nominate, state_count
     FROM caucus_stats
     WHERE cong = ? AND size >= 10 AND (dems + reps) >= 5
     ORDER BY bipartisan_score * LN(size + 1) DESC
     LIMIT 15`,
    [cong]
  );

  const pairs = useQuery<SurprisingPair>(
    `SELECT member_a, member_b, name_a, name_b, party_a, party_b,
            state_a, state_b, shared, ideology_gap, score
     FROM surprising_pairs
     WHERE cong = ?
     ORDER BY score DESC
     LIMIT 20`,
    [cong]
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-6xl mx-auto space-y-4">
        <SceneHeader
          kicker="who holds it together"
          title={<>Insights · {formatCongress(cong)} Congress</>}
          lede="Bridges, bipartisan caucuses, and surprising cross-party alliances — recomputed live for whichever congress the top-bar slider points at."
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel
            className="reveal reveal-1"
            title="Top bridges (by betweenness)"
            right={
              <span className="text-[10px] text-[var(--color-text-dim)]">
                members who connect otherwise-separated clusters
              </span>
            }
          >
            <div className="p-2">
              {bridges.loading && <SkeletonRows n={8} />}
              {bridges.data?.length === 0 && (
                <div className="text-xs text-[var(--color-text-dim)] p-4 text-center">
                  no bridge data for this congress
                </div>
              )}
              <div className="divide-y divide-[var(--color-border)]">
                {bridges.data?.map((r, i) => (
                  <button
                    key={r.member_id}
                    onClick={() => navigate(`/member?id=${r.member_id}`)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 rounded row-hover text-left text-xs group"
                  >
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums w-5 shrink-0">
                      {i + 1}
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0 transition-transform group-hover:scale-150"
                      style={{ background: partyInfo(r.party).color }}
                    />
                    <span className="flex-1 min-w-0 truncate group-hover:text-[var(--color-text)] transition-colors">
                      {r.mc_name}{' '}
                      <span className="text-[var(--color-text-dim)]">
                        {r.state_abv}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-[10px] font-mono tabular-nums text-[var(--color-text-dim)] shrink-0">
                      <span title="Betweenness">
                        bc{' '}
                        <span className="text-[var(--color-text-muted)]">
                          {r.betweenness.toFixed(3)}
                        </span>
                      </span>
                      {r.cross_party_share != null && (
                        <span title="Cross-party share">
                          x{' '}
                          <span className="text-[var(--color-text-muted)]">
                            {(r.cross_party_share * 100).toFixed(0)}%
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            className="reveal reveal-2"
            title="Most bipartisan caucuses"
            right={
              <span className="text-[10px] text-[var(--color-text-dim)]">
                size ≥ 10 · ranked by D/R balance × log(size)
              </span>
            }
          >
            <div className="p-2">
              {bipartisan.loading && <SkeletonRows n={8} />}
              <div className="divide-y divide-[var(--color-border)]">
                {bipartisan.data?.map((r, i) => (
                  <button
                    key={r.caucus_id}
                    onClick={() => navigate(`/caucus?id=${r.caucus_id}`)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 rounded row-hover text-left text-xs"
                  >
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums w-5 shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 truncate">{r.caucus_name}</span>
                    <SplitBar dems={r.dems} reps={r.reps} />
                    <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-dim)] w-10 text-right shrink-0">
                      {r.size}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <Panel
          className="reveal reveal-3"
          title="Surprising cross-party alliances"
          right={
            <span className="text-[10px] text-[var(--color-text-dim)]">
              high shared-caucus count despite party/ideology divide
            </span>
          }
        >
          <div className="p-2">
            {pairs.loading && <SkeletonRows n={6} />}
            {pairs.data?.length === 0 && (
              <div className="text-xs text-[var(--color-text-dim)] p-4 text-center">
                no cross-party pair data for this congress
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y md:divide-y-0 divide-[var(--color-border)]">
              {pairs.data?.slice(0, 12).map((p, i) => (
                <div
                  key={`${p.member_a}-${p.member_b}`}
                  className="flex items-center gap-2 py-1.5 text-xs"
                >
                  <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums w-5 shrink-0">
                    {i + 1}
                  </span>
                  <PairLink
                    name={p.name_a}
                    party={p.party_a}
                    state={p.state_a}
                    memberId={p.member_a}
                  />
                  <span className="text-[var(--color-text-dim)] shrink-0">↔</span>
                  <PairLink
                    name={p.name_b}
                    party={p.party_b}
                    state={p.state_b}
                    memberId={p.member_b}
                  />
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--color-text-dim)] shrink-0">
                    {p.shared} shared
                    {p.ideology_gap != null && p.ideology_gap > 0 && (
                      <>
                        {' · '}Δ{p.ideology_gap.toFixed(2)}
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <div className="grid grid-cols-3 gap-4 mt-2 reveal reveal-4">
          <Stat
            icon={<Network size={14} />}
            label="top bridge bc"
            value={
              bridges.data?.[0]?.betweenness != null
                ? bridges.data[0].betweenness.toFixed(3)
                : '—'
            }
            sub={bridges.data?.[0]?.mc_name ?? ''}
          />
          <Stat
            icon={<Scale size={14} />}
            label="most bipartisan"
            value={
              bipartisan.data?.[0]?.bipartisan_score != null
                ? `${(bipartisan.data[0].bipartisan_score * 100).toFixed(0)}%`
                : '—'
            }
            sub={bipartisan.data?.[0]?.caucus_name ?? ''}
          />
          <Stat
            icon={<Users size={14} />}
            label="cross-party pairs"
            value={String(pairs.data?.length ?? 0)}
            sub={`scored from co-membership`}
          />
        </div>
      </div>
    </div>
  );
}

function SplitBar({ dems, reps }: { dems: number; reps: number }) {
  const total = dems + reps;
  if (total === 0)
    return <div className="w-20 h-1.5 bg-[var(--color-border)] rounded" />;
  const dPct = (dems / total) * 100;
  return (
    <div className="w-20 h-1.5 rounded overflow-hidden flex shrink-0 bg-[var(--color-border)]">
      <span
        className="h-full"
        style={{ width: `${dPct}%`, background: '#3b82f6' }}
      />
      <span
        className="h-full"
        style={{ width: `${100 - dPct}%`, background: '#ef4444' }}
      />
    </div>
  );
}

function PairLink({
  name,
  party,
  state,
  memberId,
}: {
  name: string;
  party: number;
  state: string;
  memberId: number;
}) {
  return (
    <button
      onClick={() => navigate(`/member?id=${memberId}`)}
      className="flex items-center gap-1.5 min-w-0 hover:text-[var(--color-text)]"
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: partyInfo(party).color }}
      />
      <span className="truncate">
        {name}{' '}
        <span className="text-[var(--color-text-dim)]">{state}</span>
      </span>
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 card-hover">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
        <span className="text-[var(--color-accent)]">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="font-display text-2xl tabular mt-1.5">{value}</div>
      <div className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5">
        {sub}
      </div>
    </div>
  );
}
