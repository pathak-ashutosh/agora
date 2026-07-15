import { useApp } from '@/lib/store';
import { formatCongress } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { loadMetadata } from '@/lib/metadata';
import { Link2, Check } from 'lucide-react';

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

  // Local drag state — decouples slider pixel updates from the committed cong.
  // Without this, every intermediate value during a drag fires setCong, which
  // cascades through URL rewrites + graph rebuilds and makes the slider feel
  // jittery (and sometimes lands on the wrong tick).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const displayIdx = dragIdx ?? Math.max(0, idx);
  const displayCong = congresses[displayIdx] ?? cong;

  // If cong changes externally (URL hydration, navigation), abandon any drag.
  const lastCommittedCong = useRef(cong);
  useEffect(() => {
    if (cong !== lastCommittedCong.current) {
      lastCommittedCong.current = cong;
      setDragIdx(null);
    }
  }, [cong]);

  const commit = (v: number) => {
    const next = congresses[v];
    if (next != null && next !== cong) {
      lastCommittedCong.current = next;
      setCong(next);
    }
    setDragIdx(null);
  };

  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* clipboard unavailable — silently ignore */
      });
  };

  return (
    <header className="h-14 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-5 gap-6">
      {/* Fixed-width left block so the slider track doesn't shift horizontally
          when the DW-NOMINATE badge appears/disappears between congresses. */}
      <div className="flex items-baseline gap-3 w-60 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-text-dim)]">
          Congress
        </div>
        <div className="font-display text-[22px] leading-none tabular w-16 text-left text-[var(--color-text)]">
          {formatCongress(displayCong)}
        </div>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-mono transition-opacity"
          style={{ visibility: hasNominate.has(displayCong) ? 'visible' : 'hidden' }}
          aria-hidden={!hasNominate.has(displayCong)}
        >
          DW-NOMINATE
        </span>
      </div>

      <div className="flex items-center gap-3 flex-1 max-w-2xl">
        <div className="relative flex-1 flex items-center">
          {/* tick rail under the slider — one notch per congress */}
          <div className="absolute inset-x-[7px] top-1/2 mt-[6px] flex justify-between pointer-events-none">
            {congresses.map((c, i) => (
              <span
                key={c}
                className="w-px h-1.5 rounded-full transition-colors"
                style={{
                  background:
                    i === displayIdx
                      ? 'var(--color-accent)'
                      : 'var(--color-border-strong)',
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, congresses.length - 1)}
            step={1}
            value={displayIdx}
            onChange={(e) => setDragIdx(Number(e.target.value))}
            onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
            onBlur={(e) => commit(Number((e.target as HTMLInputElement).value))}
            className="flex-1 w-full"
            aria-label="Congress"
            disabled={congresses.length === 0}
          />
        </div>
        <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] tabular w-16 justify-end">
          <span>{congresses[0] ?? '—'}</span>
          <span>–</span>
          <span>{congresses[congresses.length - 1] ?? '—'}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        {(
          [
            ['Dem', 'var(--color-dem)'],
            ['Rep', 'var(--color-rep)'],
            ['Ind', 'var(--color-ind)'],
          ] as const
        ).map(([label, color]) => (
          <span
            key={label}
            className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[10px]"
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: color }}
            />
            {label}
          </span>
        ))}
        <button
          onClick={copyLink}
          title="Copy shareable link to current view"
          className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--color-border-strong)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] active:scale-95 transition-all"
        >
          {copied ? <Check size={12} /> : <Link2 size={12} />}
          <span className="text-[10px] uppercase tracking-wider">
            {copied ? 'copied' : 'share'}
          </span>
        </button>
      </div>
    </header>
  );
}
