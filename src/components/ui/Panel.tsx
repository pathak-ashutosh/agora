import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, right, children, className }: Props) {
  return (
    <section
      className={cn(
        'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]',
        'bg-[linear-gradient(180deg,rgba(236,231,222,0.02),transparent_38%)]',
        'shadow-[0_1px_0_rgba(0,0,0,0.4)]',
        className
      )}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-[var(--color-border)]">
          {title && (
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)] truncate">
              {title}
            </h3>
          )}
          {right}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
