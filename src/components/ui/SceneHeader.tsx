import type { ReactNode } from 'react';

/**
 * Shared editorial header for every scene: small-caps kicker, serif display
 * title, and a muted lede. Staggers in on mount.
 */
export function SceneHeader({
  kicker,
  title,
  lede,
  right,
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-6 reveal">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] mb-1.5">
          {kicker}
        </div>
        <h1 className="font-display text-[28px] leading-tight text-[var(--color-text)]">
          {title}
        </h1>
        {lede && (
          <p className="text-sm text-[var(--color-text-muted)] mt-1.5 leading-relaxed max-w-2xl">
            {lede}
          </p>
        )}
      </div>
      {right && <div className="shrink-0 pb-1">{right}</div>}
    </header>
  );
}
