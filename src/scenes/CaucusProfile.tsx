import { useMemo, useState, useEffect } from 'react';
import * as Plot from '@observablehq/plot';
import { Panel } from '@/components/ui/Panel';
import { PlotChart } from '@/components/ui/PlotChart';
import { SceneHeader } from '@/components/ui/SceneHeader';
import { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';
import { useQuery } from '@/lib/use-query';
import { partyInfo, formatCongress } from '@/lib/utils';
import { searchNl, type NlMatch } from '@/lib/nl-search';
import { Sparkles, Search } from 'lucide-react';

function useCaucusIdFromQuery(): number | null {
  const [id, setId] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search).get('id');
    return p ? Number(p) : null;
  });
  useEffect(() => {
    const onChange = () => {
      const p = new URLSearchParams(window.location.search).get('id');
      setId(p ? Number(p) : null);
    };
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return id;
}

export function CaucusProfile() {
  const caucusId = useCaucusIdFromQuery();
  if (caucusId == null) return <CaucusSearch />;
  return <CaucusDetailPage caucusId={caucusId} />;
}

function CaucusSearch() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'exact' | 'semantic'>('exact');
  const [nlResults, setNlResults] = useState<NlMatch[]>([]);
  const [nlStatus, setNlStatus] = useState<string | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  const exactQuery = useQuery<{
    caucus_id: number;
    caucus_name: string;
    latest_cong: number;
    cong_count: bigint;
    total_members: bigint;
  }>(
    mode === 'exact' && q.length >= 2
      ? `SELECT c.caucus_id, MAX(c.caucus_name) AS caucus_name,
                MAX(c.cong) AS latest_cong,
                COUNT(DISTINCT c.cong) AS cong_count,
                COUNT(DISTINCT mb.member_id) AS total_members
         FROM caucuses c
         LEFT JOIN memberships mb ON mb.caucus_id = c.caucus_id AND mb.cong = c.cong
         WHERE UPPER(c.caucus_name) LIKE UPPER(?)
         GROUP BY c.caucus_id
         ORDER BY caucus_name
         LIMIT 200`
      : null,
    [`%${q}%`]
  );

  // Semantic search: debounce, run NL embedding + cosine
  useEffect(() => {
    if (mode !== 'semantic' || q.length < 3) {
      setNlResults([]);
      setNlStatus(null);
      return;
    }
    let cancelled = false;
    setNlLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await searchNl(q, 25, (m) => {
          if (!cancelled) setNlStatus(m);
        });
        if (!cancelled) {
          setNlResults(res);
          setNlStatus(null);
        }
      } catch (err) {
        if (!cancelled) setNlStatus(`error: ${(err as Error).message}`);
      } finally {
        if (!cancelled) setNlLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [mode, q]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-3xl mx-auto space-y-5">
        <SceneHeader
          kicker="1,100+ caucuses, 1993–2020"
          title="Caucuses"
          lede={
            <>
              Search by name, or switch to <em>semantic</em> mode to query by
              topic — “veterans healthcare”, “agriculture &amp; rural policy” —
              matched by an embedding model running in your browser.
            </>
          }
        />

        <div className="flex items-center gap-3 reveal reveal-1">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] pointer-events-none"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                mode === 'semantic'
                  ? 'try “immigration reform” or “cybersecurity”…'
                  : 'Search caucus by name…'
              }
              className="w-full pl-10 pr-4 py-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-soft)] transition-shadow"
            />
          </div>
          <div className="flex rounded-full border border-[var(--color-border-strong)] p-0.5 shrink-0">
            {(['exact', 'semantic'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider flex items-center gap-1.5 transition-all ${
                  mode === m
                    ? 'bg-[var(--color-accent)] text-black font-semibold'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {m === 'semantic' && <Sparkles size={10} />}
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === 'semantic' && nlStatus && (
          <div className="text-[11px] font-mono text-[var(--color-text-dim)]">
            {nlLoading ? '⟳ ' : ''}
            {nlStatus}
            {nlStatus === 'cached' && (
              <span className="ml-2 text-[var(--color-text-dim)]">
                (embeddings loaded from browser cache)
              </span>
            )}
          </div>
        )}

        {mode === 'exact' && q.length >= 2 && exactQuery.loading && <SkeletonRows n={6} />}
        {mode === 'semantic' && nlLoading && !nlStatus && <SkeletonRows n={6} />}

        {mode === 'exact' && exactQuery.data && exactQuery.data.length > 0 && (
          <Panel title={`${exactQuery.data.length} results`} className="reveal">
            <div className="divide-y divide-[var(--color-border)]">
              {exactQuery.data.map((c) => (
                <a
                  key={c.caucus_id}
                  href={`/caucus?id=${c.caucus_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', `/caucus?id=${c.caucus_id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 row-hover group"
                >
                  <div className="flex-1 min-w-0 text-sm truncate group-hover:text-[var(--color-accent)] transition-colors">{c.caucus_name}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)] font-mono tabular-nums shrink-0">
                    {String(c.cong_count)} congs · {String(c.total_members)} members
                  </div>
                </a>
              ))}
            </div>
          </Panel>
        )}

        {mode === 'semantic' && nlResults.length > 0 && (
          <Panel title={`${nlResults.length} semantic matches`} className="reveal">
            <div className="divide-y divide-[var(--color-border)]">
              {nlResults.map((r) => (
                <a
                  key={r.id}
                  href={`/caucus?id=${r.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', `/caucus?id=${r.id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 row-hover group"
                >
                  <div className="flex-1 min-w-0 text-sm truncate group-hover:text-[var(--color-accent)] transition-colors">{r.name}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)] font-mono tabular-nums shrink-0">
                    cos {r.score.toFixed(2)}
                  </div>
                </a>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function CaucusDetailPage({ caucusId }: { caucusId: number }) {
  const history = useQuery<{
    cong: number;
    caucus_name: string;
    members: bigint;
    dems: bigint;
    reps: bigint;
    other: bigint;
    mean_nominate: number | null;
    median_nominate: number | null;
    std_nominate: number | null;
    bipartisan_score: number | null;
  }>(
    `SELECT cs.cong,
            cs.caucus_name,
            cs.size AS members,
            cs.dems, cs.reps, cs.other,
            cs.mean_nominate, cs.median_nominate, cs.std_nominate,
            cs.bipartisan_score
     FROM caucus_stats cs
     WHERE cs.caucus_id = ?
     ORDER BY cs.cong`,
    [caucusId]
  );

  const lifecycle = useQuery<{
    canonical_name: string;
    first_cong: number;
    last_cong: number;
    peak_cong: number;
    peak_size: number;
    active_congs: number;
    mean_bipartisan: number;
  }>(
    `SELECT canonical_name, first_cong, last_cong, peak_cong, peak_size,
            active_congs, mean_bipartisan
     FROM caucus_lifecycle
     WHERE caucus_id = ?
     LIMIT 1`,
    [caucusId]
  );

  const latest = history.data?.[history.data.length - 1];

  const roster = useQuery<{
    member_id: number;
    mc_name: string;
    party: number;
    state_abv: string;
    nominate: number | null;
  }>(
    latest
      ? `SELECT m.member_id, m.mc_name, m.party, m.state_abv, m.nominate
         FROM memberships mb
         JOIN members m ON m.member_id = mb.member_id AND m.cong = mb.cong
         WHERE mb.caucus_id = ? AND mb.cong = ?
         ORDER BY m.mc_name`
      : null,
    latest ? [caucusId, latest.cong] : []
  );

  // Similar caucuses from the SVD embedding space
  const similar = useQuery<{
    neighbor_caucus_id: number;
    score: number;
    caucus_name: string;
    peak_size: number;
  }>(
    `SELECT sc.neighbor_caucus_id, sc.score,
            COALESCE(cl.canonical_name, '') AS caucus_name,
            cl.peak_size
     FROM similar_caucuses sc
     LEFT JOIN caucus_lifecycle cl ON cl.caucus_id = sc.neighbor_caucus_id
     WHERE sc.caucus_id = ?
     ORDER BY sc.rank
     LIMIT 10`,
    [caucusId]
  );

  const driftOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!history.data) return null;
    const rows = history.data
      .filter((r) => r.mean_nominate != null)
      .map((r) => ({
        cong: r.cong,
        mean: r.mean_nominate as number,
        lo:
          (r.mean_nominate as number) - (r.std_nominate ?? 0),
        hi:
          (r.mean_nominate as number) + (r.std_nominate ?? 0),
      }));
    if (rows.length < 2) return null;
    return {
      height: 150,
      marginLeft: 44,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'DW-NOMINATE', domain: [-1, 1], grid: true },
      marks: [
        Plot.ruleY([0], { stroke: '#374151' }),
        Plot.areaY(rows, { x: 'cong', y1: 'lo', y2: 'hi', fill: '#f59e0b', fillOpacity: 0.15 }),
        Plot.lineY(rows, { x: 'cong', y: 'mean', stroke: '#f59e0b', strokeWidth: 2 }),
        Plot.dot(rows, { x: 'cong', y: 'mean', fill: '#f59e0b', r: 3 }),
      ],
    };
  }, [history.data]);

  const bipartisanOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!history.data) return null;
    const rows = history.data
      .filter((r) => r.bipartisan_score != null)
      .map((r) => ({
        cong: r.cong,
        score: (r.bipartisan_score as number) * 100,
      }));
    if (rows.length < 2) return null;
    return {
      height: 150,
      marginLeft: 44,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'Bipartisan score (%)', domain: [0, 100], grid: true },
      marks: [
        Plot.areaY(rows, { x: 'cong', y: 'score', fill: '#10b981', fillOpacity: 0.15 }),
        Plot.lineY(rows, { x: 'cong', y: 'score', stroke: '#10b981', strokeWidth: 2 }),
        Plot.dot(rows, { x: 'cong', y: 'score', fill: '#10b981', r: 3 }),
      ],
    };
  }, [history.data]);

  const growthOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!history.data) return null;
    const rows = history.data.flatMap((r) => [
      { cong: r.cong, party: 'Dem', count: Number(r.dems) },
      { cong: r.cong, party: 'Rep', count: Number(r.reps) },
      { cong: r.cong, party: 'Other', count: Number(r.other) },
    ]);
    return {
      height: 200,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'Members', grid: true },
      color: { domain: ['Dem', 'Rep', 'Other'], range: ['#3b82f6', '#ef4444', '#9ca3af'] },
      marks: [
        Plot.barY(rows, {
          x: 'cong',
          y: 'count',
          fill: 'party',
        }),
      ],
    };
  }, [history.data]);

  const ideologyHist = useMemo<Plot.PlotOptions | null>(() => {
    if (!roster.data || !roster.data.some((r) => r.nominate != null)) return null;
    return {
      height: 160,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'DW-NOMINATE', domain: [-1, 1], grid: true },
      y: { label: 'Members' },
      color: { domain: ['Dem', 'Rep', 'Other'], range: ['#3b82f6', '#ef4444', '#9ca3af'] },
      marks: [
        Plot.rectY(
          roster.data
            .filter((r) => r.nominate != null)
            .map((r) => ({
              nominate: r.nominate as number,
              party: r.party === 100 ? 'Dem' : r.party === 200 ? 'Rep' : 'Other',
            })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (Plot.binX as any)(
            { y: 'count' },
            { x: 'nominate', fill: 'party', thresholds: 20 }
          )
        ),
        Plot.ruleY([0], { stroke: '#374151' }),
      ],
    };
  }, [roster.data]);

  if (history.loading || !latest) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-96" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-56 rounded-lg" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-44 rounded-lg" />
            <Skeleton className="h-44 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  const totalMembers =
    Number(latest.dems) + Number(latest.reps) + Number(latest.other);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-start justify-between reveal">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] mb-1.5">
              caucus profile
            </div>
            <h1 className="font-display text-3xl leading-tight">
              {lifecycle.data?.[0]?.canonical_name || latest.caucus_name}
            </h1>
            <div className="text-sm text-[var(--color-text-muted)] mt-2">
              {history.data!.length} congresses ({formatCongress(history.data![0].cong)}–
              {formatCongress(latest.cong)}) · {totalMembers} members in{' '}
              {formatCongress(latest.cong)}
            </div>
            {lifecycle.data?.[0] && (
              <div className="flex items-center gap-2 mt-2.5 text-[10px] uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-mono">
                  peak {formatCongress(lifecycle.data[0].peak_cong)} ·{' '}
                  {lifecycle.data[0].peak_size}
                </span>
                <span className="px-2 py-0.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)] font-mono">
                  {(lifecycle.data[0].mean_bipartisan * 100).toFixed(0)}% avg bipartisan
                </span>
              </div>
            )}
          </div>
          <a
            href="/caucus"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/caucus');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="text-xs px-2.5 py-1.5 rounded-full border border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors"
          >
            ← search
          </a>
        </header>

        <Panel className="reveal reveal-1" title="Growth & party mix over time">
          <div className="p-3">{growthOptions && <PlotChart options={growthOptions} />}</div>
        </Panel>

        <div className="grid grid-cols-2 gap-4">
          <Panel className="reveal reveal-2" title="Ideology drift (mean ± 1σ)">
            <div className="p-3">
              {driftOptions ? (
                <PlotChart options={driftOptions} />
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] py-6 text-center">
                  not enough DW-NOMINATE coverage
                </div>
              )}
            </div>
          </Panel>
          <Panel className="reveal reveal-2" title="Bipartisanship over time">
            <div className="p-3">
              {bipartisanOptions ? (
                <PlotChart options={bipartisanOptions} />
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] py-6 text-center">
                  single-congress caucus
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Panel className="reveal reveal-3" title={`Ideology spread — ${formatCongress(latest.cong)}`}>
            <div className="p-3">
              {ideologyHist ? (
                <PlotChart options={ideologyHist} />
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] py-6 text-center">
                  No DW-NOMINATE available for this congress
                </div>
              )}
            </div>
          </Panel>

          <Panel
            className="reveal reveal-3"
            title="Similar caucuses (embedding cosine)"
            right={
              <span className="text-[10px] text-[var(--color-text-dim)]">
                derived from member-overlap SVD
              </span>
            }
          >
            <div className="p-2">
              {similar.data?.length === 0 ? (
                <div className="text-xs text-[var(--color-text-dim)] py-3 text-center">
                  no neighbors
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-border)]">
                  {similar.data?.map((s, i) => (
                    <a
                      key={s.neighbor_caucus_id}
                      href={`/caucus?id=${s.neighbor_caucus_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        window.history.pushState({}, '', `/caucus?id=${s.neighbor_caucus_id}`);
                        window.dispatchEvent(new PopStateEvent('popstate'));
                      }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded row-hover text-xs"
                    >
                      <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums w-5 shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {s.caucus_name || `caucus ${s.neighbor_caucus_id}`}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-dim)] shrink-0">
                        {s.score.toFixed(2)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Panel className="reveal reveal-4" title={`Roster — ${formatCongress(latest.cong)} (${roster.data?.length ?? 0})`}>
            <div className="p-3 max-h-80 overflow-y-auto">
              <div className="space-y-0.5 text-xs">
                {roster.data?.map((m) => (
                  <a
                    key={m.member_id}
                    href={`/member?id=${m.member_id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', `/member?id=${m.member_id}`);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="flex items-center gap-2 hover:text-[var(--color-text)]"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: partyInfo(m.party).color }}
                    />
                    <span className="text-[var(--color-text-muted)] truncate flex-1">
                      {m.mc_name} <span className="text-[var(--color-text-dim)]">{m.state_abv}</span>
                    </span>
                    {m.nominate != null && (
                      <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums">
                        {m.nominate.toFixed(2)}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
