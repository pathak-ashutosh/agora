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
      <div className="flex items-center gap-3 w-60 shrink-0">
        <div className="text-xs uppercase tracking-widest text-[var(--color-text-dim)]">
          Congress
        </div>
        <div className="font-mono text-lg font-semibold tabular-nums w-14 text-left">
          {formatCongress(displayCong)}
        </div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)] font-mono transition-opacity"
          style={{ visibility: hasNominate.has(displayCong) ? 'visible' : 'hidden' }}
          aria-hidden={!hasNominate.has(displayCong)}
        >
          DW-NOMINATE
        </span>
      </div>

      <div className="flex items-center gap-2 flex-1 max-w-2xl">
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
          className="flex-1 accent-[var(--color-accent)]"
          disabled={congresses.length === 0}
        />
        <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums w-16 justify-end">
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
        <button
          onClick={copyLink}
          title="Copy shareable link to current view"
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--color-border-strong)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)] transition-colors"
        >
          {copied ? <Check size={13} /> : <Link2 size={13} />}
          <span className="text-[10px] uppercase tracking-wider">
            {copied ? 'copied' : 'share'}
          </span>
        </button>
      </div>
    </header>
  );
}
