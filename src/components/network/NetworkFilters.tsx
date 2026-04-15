import { useApp } from '@/lib/store';
import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';

const NODE_MODE_OPTS = [
  { value: 'members' as const, label: 'Members' },
  { value: 'caucuses' as const, label: 'Caucuses' },
];

const EDGE_OPTS = [
  { value: 'co_membership' as const, label: 'Co-membership' },
  { value: 'ideology' as const, label: 'Ideology sim.' },
];

const PARTIES: { code: number; label: string; color: string }[] = [
  { code: 100, label: 'Dem', color: 'var(--color-dem)' },
  { code: 200, label: 'Rep', color: 'var(--color-rep)' },
  { code: 328, label: 'Ind', color: 'var(--color-ind)' },
];

export function NetworkFilters() {
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
    clearExpansion,
  } = useApp();

  return (
    <Panel title="Filters" className="text-xs">
      <div className="p-3 space-y-4">
        <Field label="Nodes">
          <Toggle value={nodeMode} options={NODE_MODE_OPTS} onChange={setNodeMode} />
        </Field>

        {nodeMode === 'members' && (
          <Field label="Edges">
            <Toggle value={edgeKind} options={EDGE_OPTS} onChange={setEdgeKind} />
          </Field>
        )}

        <Field label={`Top N by degree: ${topN}`}>
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

        <Field label={`Min edge weight: ${minEdgeWeight}`}>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={minEdgeWeight}
            onChange={(e) => setMinEdgeWeight(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </Field>

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

        <div className="pt-2 border-t border-[var(--color-border)]">
          <button
            onClick={clearExpansion}
            className="w-full px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] rounded transition-colors"
          >
            Reset expansions
          </button>
        </div>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
