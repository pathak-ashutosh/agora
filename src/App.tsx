import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { useRoute } from '@/lib/router';
import { ensureDuckDB } from '@/lib/duckdb';
import { NetworkExplorer } from '@/scenes/NetworkExplorer';
import { MemberProfile } from '@/scenes/MemberProfile';
import { CaucusProfile } from '@/scenes/CaucusProfile';
import { Compare } from '@/scenes/Compare';

function Scene() {
  const path = useRoute();
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
      <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text-dim)] text-xs gap-2">
        <div className="font-mono text-lg text-[var(--color-text)]">
          agora<span className="text-[var(--color-accent)]">.</span>
        </div>
        <div>booting duckdb · loading parquet…</div>
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
