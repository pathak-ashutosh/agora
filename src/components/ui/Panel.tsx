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
        'rounded border border-[var(--color-border)] bg-[var(--color-surface)]',
        className
      )}
    >
      {(title || right) && (
        <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          {title && (
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
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
