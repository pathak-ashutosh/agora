import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useApp } from '@/lib/store';
import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';
import type { GraphStats } from '@/lib/graph-builder';
import { cn } from '@/lib/utils';

const NODE_MODE_OPTS = [
  { value: 'members' as const, label: 'Members' },
  { value: 'caucuses' as const, label: 'Caucuses' },
];

const EDGE_OPTS = [
  { value: 'co_membership' as const, label: 'Shared caucuses' },
  { value: 'ideology' as const, label: 'Similar ideology' },
];

const EDGE_HELP: Record<string, string> = {
  co_membership: 'Linked if they share enough caucuses.',
  shared_caucuses: 'Linked if they share enough caucuses.',
  ideology: 'Linked if DW-NOMINATE scores are close.',
};

const PARTIES: { code: number; label: string; color: string }[] = [
  { code: 100, label: 'Dem', color: 'var(--color-dem)' },
  { code: 200, label: 'Rep', color: 'var(--color-rep)' },
  { code: 328, label: 'Ind', color: 'var(--color-ind)' },
];

/** House + Senate + delegates that show up in memberships. */
const STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC','PR','VI','GU','AS','MP',
] as const;

export function NetworkFilters({
  stats,
  loading,
}: {
  stats: GraphStats | null;
  loading: boolean;
}) {
  const {
    nodeMode,
    setNodeMode,
    edgeKind,
    setEdgeKind,
    topN,
    setTopN,
    minEdgeWeight,
    setMinEdgeWeight,
    parties,
    toggleParty,
    clearParties,
    states,
    toggleState,
    clearStates,
    clearExpansion,
  } = useApp();

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const total =
    nodeMode === 'members' ? stats?.totalMembers : stats?.totalCaucuses;
  const unit = nodeMode === 'members' ? 'members' : 'caucuses';
  const showing = stats?.nodeCount ?? 0;
  const connections = stats?.edgeCount ?? 0;

  const possible =
    stats && stats.nodeCount >= 2
      ? (stats.nodeCount * (stats.nodeCount - 1)) / 2
      : 0;
  const dens = possible > 0 ? connections / possible : 0;

  // Ideology edges ignore minEdgeWeight — but only in member mode. Caucus
  // graphs always use shared-member weights even if edgeKind is still ideology.
  const weightApplies = !(nodeMode === 'members' && edgeKind === 'ideology');
  const weightUnit = nodeMode === 'members' ? 'caucus' : 'member';
  const weightUnitPlural = nodeMode === 'members' ? 'caucuses' : 'members';

  // Use last-known stats while a rebuild is in flight so status rows don't
  // unmount and shove the controls around under the Advanced sliders.
  const overFiltered =
    weightApplies &&
    stats != null &&
    stats.nodeCount > 0 &&
    stats.edgeCount === 0 &&
    minEdgeWeight > 1;

  const overDense =
    weightApplies &&
    !overFiltered &&
    dens > 0.85 &&
    stats != null &&
    stats.nodeCount >= 20;

  return (
    <Panel title="View" className="text-xs">
      <div className="p-3 space-y-4">
        {/* Status */}
        <div className="space-y-1.5">
          <div className="font-mono tabular-nums text-[var(--color-text)]">
            {loading && !stats ? (
              <span className="text-[var(--color-text-dim)]">Loading…</span>
            ) : (
              <>
                Showing{' '}
                <span className="text-[var(--color-text)]">{showing}</span>
                {total != null && (
                  <span className="text-[var(--color-text-muted)]">
                    {' '}
                    of {total}
                  </span>
                )}{' '}
                <span className="text-[var(--color-text-muted)]">{unit}</span>
              </>
            )}
          </div>
          {/* Keep prior counts while rebuild runs — toggling on `loading` collapses this row and janks the panel. */}
          <div
            className={cn(
              'text-[11px] text-[var(--color-text-muted)] min-h-[1.25rem]',
              loading && stats != null && 'opacity-60'
            )}
          >
            {stats != null
              ? `${connections.toLocaleString()} connection${connections === 1 ? '' : 's'}`
              : loading
                ? '…'
                : null}
          </div>
          {overFiltered && (
            <p className="text-[11px] leading-snug text-[var(--color-text-muted)]">
              No pair shares ≥{minEdgeWeight} {weightUnitPlural} in this congress.{' '}
              <button
                onClick={() => setMinEdgeWeight(1)}
                className="underline decoration-dotted text-[var(--color-accent)] hover:opacity-80"
              >
                Require fewer shared {weightUnitPlural}
              </button>
            </p>
          )}
          {overDense && (
            <p className="text-[11px] leading-snug text-[var(--color-text-muted)]">
              Nearly everyone is linked — try requiring more shared {weightUnitPlural}{' '}
              in Advanced.
            </p>
          )}
        </div>

        <Field label="Nodes">
          <Toggle value={nodeMode} options={NODE_MODE_OPTS} onChange={setNodeMode} />
        </Field>

        {nodeMode === 'members' && (
          <Field label="Edges">
            <Toggle value={edgeKind} options={EDGE_OPTS} onChange={setEdgeKind} />
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-text-dim)]">
              {EDGE_HELP[edgeKind] ?? EDGE_HELP.co_membership}
            </p>
          </Field>
        )}

        <Field label="Party">
          <div className="flex gap-1.5 flex-wrap">
            {PARTIES.map(({ code, label, color }) => {
              const active = parties.has(code);
              return (
                <button
                  key={code}
                  onClick={() => toggleParty(code)}
                  className="px-2 py-1 rounded border text-xs font-medium transition-colors"
                  style={{
                    borderColor: active ? color : 'var(--color-border-strong)',
                    background: active ? `${color}22` : 'transparent',
                    color: active ? color : 'var(--color-text-muted)',
                  }}
                >
                  {label}
                </button>
              );
            })}
            {parties.size > 0 && (
              <button
                onClick={clearParties}
                className="px-2 py-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              >
                clear
              </button>
            )}
          </div>
        </Field>

        {/* Advanced */}
        <div className="border-t border-[var(--color-border)] pt-2">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors"
            aria-expanded={advancedOpen}
          >
            Advanced
            <ChevronDown
              size={14}
              className={cn(
                'shrink-0 transition-transform',
                advancedOpen && 'rotate-180'
              )}
            />
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-4">
              <Field
                label={`Show ${topN} ${nodeMode === 'members' ? 'people' : 'caucuses'}`}
                hint="Most-connected first"
              >
                <input
                  type="range"
                  min={20}
                  max={400}
                  step={10}
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </Field>

              <Field
                label={`Require ${minEdgeWeight} shared ${minEdgeWeight === 1 ? weightUnit : weightUnitPlural}`}
                hint={
                  !weightApplies
                    ? 'Applies to shared-caucus edges only'
                    : 'Higher = fewer, stronger links'
                }
              >
                <input
                  type="range"
                  min={1}
                  max={40}
                  step={1}
                  value={minEdgeWeight}
                  onChange={(e) => setMinEdgeWeight(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                  disabled={!weightApplies}
                />
              </Field>

              {nodeMode === 'members' && (
                <Field label="State">
                  <div className="max-h-28 overflow-y-auto flex gap-1 flex-wrap pr-0.5">
                    {STATE_CODES.map((code) => {
                      const active = states.has(code);
                      return (
                        <button
                          key={code}
                          onClick={() => toggleState(code)}
                          className={cn(
                            'px-1.5 py-0.5 rounded border font-mono text-[10px] transition-colors',
                            active
                              ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                              : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]'
                          )}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                  {states.size > 0 && (
                    <button
                      onClick={clearStates}
                      className="mt-1.5 text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
                    >
                      clear states
                    </button>
                  )}
                </Field>
              )}

              <button
                onClick={clearExpansion}
                className="w-full px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] rounded transition-colors"
              >
                Reset expansions
              </button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1.5">
        {label}
        {hint && (
          <span className="normal-case tracking-normal text-[var(--color-text-dim)]/80 ml-1.5">
            · {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
