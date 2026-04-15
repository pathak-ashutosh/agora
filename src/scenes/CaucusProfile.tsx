import { useMemo, useState, useEffect } from 'react';
import * as Plot from '@observablehq/plot';
import { Panel } from '@/components/ui/Panel';
import { PlotChart } from '@/components/ui/PlotChart';
import { useQuery } from '@/lib/use-query';
import { partyInfo, formatCongress } from '@/lib/utils';

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
  const { data } = useQuery<{
    caucus_id: number;
    caucus_name: string;
    latest_cong: number;
    cong_count: bigint;
    total_members: bigint;
  }>(
    q.length >= 2
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

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Caucuses</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Search for a caucus to see roster, party split, ideology spread, and growth over time.
          </p>
        </header>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search caucus by name…"
          className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />

        {data && data.length > 0 && (
          <Panel title={`${data.length} results`}>
            <div className="divide-y divide-[var(--color-border)]">
              {data.map((c) => (
                <a
                  key={c.caucus_id}
                  href={`/caucus?id=${c.caucus_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', `/caucus?id=${c.caucus_id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <div className="flex-1 min-w-0 text-sm truncate">{c.caucus_name}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)] font-mono tabular-nums shrink-0">
                    {String(c.cong_count)} congs · {String(c.total_members)} members
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
  }>(
    `SELECT c.cong, c.caucus_name,
            COUNT(DISTINCT mb.member_id) AS members,
            SUM(CASE WHEN m.party = 100 THEN 1 ELSE 0 END) AS dems,
            SUM(CASE WHEN m.party = 200 THEN 1 ELSE 0 END) AS reps,
            SUM(CASE WHEN m.party NOT IN (100, 200) THEN 1 ELSE 0 END) AS other,
            AVG(m.nominate) AS mean_nominate
     FROM caucuses c
     LEFT JOIN memberships mb ON mb.caucus_id = c.caucus_id AND mb.cong = c.cong
     LEFT JOIN members m ON m.member_id = mb.member_id AND m.cong = mb.cong
     WHERE c.caucus_id = ?
     GROUP BY c.cong, c.caucus_name
     ORDER BY c.cong`,
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

  const growthOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!history.data) return null;
    const rows = history.data.flatMap((r) => [
      { cong: r.cong, party: 'Dem', count: Number(r.dems), color: '#3b82f6' },
      { cong: r.cong, party: 'Rep', count: Number(r.reps), color: '#ef4444' },
      { cong: r.cong, party: 'Other', count: Number(r.other), color: '#9ca3af' },
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
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-dim)] text-sm">
        Loading caucus…
      </div>
    );
  }

  const totalMembers =
    Number(latest.dems) + Number(latest.reps) + Number(latest.other);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{latest.caucus_name}</h1>
            <div className="text-sm text-[var(--color-text-muted)] mt-1">
              {history.data!.length} congresses ({formatCongress(history.data![0].cong)}–
              {formatCongress(latest.cong)}) · {totalMembers} members in{' '}
              {formatCongress(latest.cong)}
            </div>
          </div>
          <a
            href="/caucus"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/caucus');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← back to search
          </a>
        </header>

        <Panel title="Growth & party mix over time">
          <div className="p-3">{growthOptions && <PlotChart options={growthOptions} />}</div>
        </Panel>

        <div className="grid grid-cols-2 gap-4">
          <Panel title={`Ideology spread — ${formatCongress(latest.cong)}`}>
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

          <Panel title={`Roster — ${formatCongress(latest.cong)} (${roster.data?.length ?? 0})`}>
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
