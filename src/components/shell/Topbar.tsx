import { useApp } from '@/lib/store';
import { formatCongress } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { loadMetadata } from '@/lib/metadata';

export function Topbar() {
  const cong = useApp((s) => s.cong);
  const setCong = useApp((s) => s.setCong);
  const [congresses, setCongresses] = useState<number[]>([]);
  const [hasNominate, setHasNominate] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadMetadata().then((m) => {
      setCongresses(m.congresses);
      setHasNominate(new Set(m.has_nominate));
      if (!m.congresses.includes(cong)) {
        setCong(m.congresses[m.congresses.length - 1]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idx = congresses.indexOf(cong);

  return (
    <header className="h-14 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-6">
      <div className="flex items-center gap-3">
        <div className="text-xs uppercase tracking-widest text-[var(--color-text-dim)]">
          Congress
        </div>
        <div className="font-mono text-lg font-semibold tabular-nums">
          {formatCongress(cong)}
        </div>
        {hasNominate.has(cong) ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)] font-mono">
            DW-NOMINATE
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 flex-1 max-w-2xl">
        <input
          type="range"
          min={0}
          max={Math.max(0, congresses.length - 1)}
          value={Math.max(0, idx)}
          onChange={(e) => setCong(congresses[Number(e.target.value)])}
          className="flex-1 accent-[var(--color-accent)]"
          disabled={congresses.length === 0}
        />
        <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums">
          <span>{congresses[0] ?? '—'}</span>
          <span>·</span>
          <span>{congresses[congresses.length - 1] ?? '—'}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-dem)] mr-1.5" />
          Dem
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-rep)] mr-1.5" />
          Rep
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-ind)] mr-1.5" />
          Ind
        </span>
      </div>
    </header>
  );
}
