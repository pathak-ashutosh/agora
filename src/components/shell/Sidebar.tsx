import { NavLink } from '@/components/shell/NavLink';
import {
  Network,
  User,
  Layers,
  GitCompareArrows,
  Sparkles,
  Map,
  Orbit,
  FlaskConical,
} from 'lucide-react';

const GROUPS = [
  {
    label: 'explore',
    items: [
      { to: '/', label: 'Network', icon: Network },
      { to: '/insights', label: 'Insights', icon: Sparkles },
      { to: '/geography', label: 'Geography', icon: Map },
      { to: '/embedding', label: 'Embedding', icon: Orbit },
    ],
  },
  {
    label: 'entities',
    items: [
      { to: '/member', label: 'Members', icon: User },
      { to: '/caucus', label: 'Caucuses', icon: Layers },
      { to: '/compare', label: 'Compare', icon: GitCompareArrows },
    ],
  },
  {
    label: 'study',
    items: [{ to: '/research', label: 'Research', icon: FlaskConical }],
  },
] as const;

export function Sidebar() {
  return (
    <aside className="w-48 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
      <div className="px-4 pt-5 pb-4 border-b border-[var(--color-border)]">
        <div className="font-display text-[22px] leading-none text-[var(--color-text)]">
          agora<span className="text-[var(--color-accent)]">.</span>
        </div>
        <div className="text-[9px] uppercase tracking-[0.24em] text-[var(--color-text-dim)] mt-2">
          congressional networks
        </div>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {GROUPS.map((g) => (
          <div key={g.label} className="mb-1.5">
            <div className="px-4 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.22em] text-[var(--color-text-dim)]">
              {g.label}
            </div>
            {g.items.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to}>
                <Icon size={15} strokeWidth={1.75} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)] space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-ind)] animate-pulse" />
          <span>runs entirely in-browser</span>
        </div>
        <div className="text-[9px] leading-snug opacity-80">
          data: Congressional Caucus Network (Ringe et al.) · DW-NOMINATE (Voteview)
        </div>
      </div>
    </aside>
  );
}
