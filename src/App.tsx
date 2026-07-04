import { useEffect, useState } from 'react';
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

function Scene() {
  const path = useRoute();
  if (path.startsWith('/research')) return <Research />;
  if (path.startsWith('/insights')) return <Insights />;
  if (path.startsWith('/geography')) return <Geography />;
  if (path.startsWith('/embedding')) return <EmbeddingSpace />;
  if (path.startsWith('/member')) return <MemberProfile />;
  if (path.startsWith('/caucus')) return <CaucusProfile />;
  if (path.startsWith('/compare')) return <Compare />;
  return <NetworkExplorer />;
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
      <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-dim)] text-xs gap-4">
        <div className="font-mono text-xl text-[var(--color-text)]">
          agora<span className="text-[var(--color-accent)]">.</span>
        </div>
        <div className="w-48 h-0.5 bg-[var(--color-border)] overflow-hidden rounded">
          <div className="h-full w-1/3 bg-[var(--color-accent)] animate-pulse" />
        </div>
        <div className="font-mono">booting duckdb · loading parquet…</div>
        <div className="text-[10px] text-[var(--color-text-dim)] max-w-xs text-center">
          all analytics run in-browser. nothing leaves your machine.
        </div>
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
