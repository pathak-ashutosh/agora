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
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 px-4 py-2 text-[13px] transition-colors duration-150',
        'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]/60',
        '[&>svg]:transition-transform [&>svg]:duration-150 hover:[&>svg]:scale-110 hover:[&>svg]:-rotate-3',
        active && 'text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-1/2 -translate-y-1/2 h-0 w-[2px] rounded-full bg-[var(--color-accent)] transition-all duration-200',
          active && 'h-5'
        )}
      />
      {children}
    </a>
  );
}
