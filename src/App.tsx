import { Component, useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { useRoute } from '@/lib/router';
import { ensureDuckDB } from '@/lib/duckdb';
import { NetworkExplorer } from '@/scenes/NetworkExplorer';
import { MemberProfile } from '@/scenes/MemberProfile';
import { CaucusProfile } from '@/scenes/CaucusProfile';
import { Compare } from '@/scenes/Compare';
import { Insights } from '@/scenes/Insights';
import { Geography } from '@/scenes/Geography';
import { EmbeddingSpace } from '@/scenes/EmbeddingSpace';
import { Research } from '@/scenes/Research';

/** A scene that throws must not blank the whole app. */
class SceneBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-[var(--color-text-muted)]">
          <div className="font-display text-lg text-[var(--color-text)]">
            This view hit an error
          </div>
          <div className="font-mono text-xs text-[var(--color-text-dim)] max-w-md text-center">
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 px-3 py-1.5 rounded-full border border-[var(--color-border-strong)] text-xs hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
          >
            try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Scene() {
  const path = useRoute();
  const scene = (() => {
    if (path.startsWith('/research')) return <Research />;
    if (path.startsWith('/insights')) return <Insights />;
    if (path.startsWith('/geography')) return <Geography />;
    if (path.startsWith('/embedding')) return <EmbeddingSpace />;
    if (path.startsWith('/member')) return <MemberProfile />;
    if (path.startsWith('/caucus')) return <CaucusProfile />;
    if (path.startsWith('/compare')) return <Compare />;
    return <NetworkExplorer />;
  })();
  // key on the first path segment so switching routes remounts with a fresh
  // entrance (reveal animations), while query-param changes stay in place
  const seg = path.split('?')[0].split('/')[1] || 'network';
  return (
    <div key={seg} className="flex-1 flex overflow-hidden reveal">
      <SceneBoundary resetKey={seg}>{scene}</SceneBoundary>
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureDuckDB()
      .then(() => setReady(true))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-rep)] text-sm font-mono">
        Failed to load data engine: {error}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-dim)] text-xs gap-5">
        <div className="font-display text-4xl text-[var(--color-text)] reveal">
          agora<span className="text-[var(--color-accent)]">.</span>
        </div>
        <div className="text-[9px] uppercase tracking-[0.3em] reveal reveal-1">
          congressional networks
        </div>
        <div className="w-52 h-px bg-[var(--color-border)] overflow-hidden rounded reveal reveal-2">
          <div className="h-full w-1/3 bg-[var(--color-accent)] animate-[shimmer-bar_1.1s_ease-in-out_infinite]" />
        </div>
        <div className="font-mono text-[10px] reveal reveal-3">
          booting duckdb · loading parquet…
        </div>
        <div className="text-[10px] max-w-xs text-center reveal reveal-4">
          all analytics run in-browser. nothing leaves your machine.
        </div>
        <style>{`@keyframes shimmer-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[var(--color-bg)] text-[var(--color-text)]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <Scene />
      </div>
    </div>
  );
}
