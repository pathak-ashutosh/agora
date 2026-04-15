import { NavLink } from '@/components/shell/NavLink';
import { Network, User, Layers, GitCompareArrows } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Network', icon: Network },
  { to: '/member', label: 'Members', icon: User },
  { to: '/caucus', label: 'Caucuses', icon: Layers },
  { to: '/compare', label: 'Compare', icon: GitCompareArrows },
] as const;

export function Sidebar() {
  return (
    <aside className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
      <div className="px-4 py-5 border-b border-[var(--color-border)]">
        <div className="font-mono text-lg font-semibold tracking-tight text-[var(--color-text)]">
          agora<span className="text-[var(--color-accent)]">.</span>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-dim)] mt-1">
          congressional networks
        </div>
      </div>
      <nav className="flex-1 py-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}>
            <Icon size={16} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)]">
        v0.1.0 · local
      </div>
    </aside>
  );
}
