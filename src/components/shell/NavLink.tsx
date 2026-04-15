import type { ReactNode } from 'react';
import { navigate, useRoute } from '@/lib/router';
import { cn } from '@/lib/utils';

interface Props {
  to: string;
  children: ReactNode;
}

export function NavLink({ to, children }: Props) {
  const path = useRoute();
  const active = to === '/' ? path === '/' : path.startsWith(to);
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
      className={cn(
        'flex items-center gap-3 px-4 py-2 text-sm transition-colors',
        'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]',
        active && 'text-[var(--color-text)] bg-[var(--color-surface-2)] border-l-2 border-[var(--color-accent)] -ml-[2px]'
      )}
    >
      {children}
    </a>
  );
}
