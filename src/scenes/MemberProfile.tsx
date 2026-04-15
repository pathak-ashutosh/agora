import { useMemo, useState, useEffect } from 'react';
import * as Plot from '@observablehq/plot';
import { Panel } from '@/components/ui/Panel';
import { PlotChart } from '@/components/ui/PlotChart';
import { useQuery } from '@/lib/use-query';
import { partyInfo, formatCongress } from '@/lib/utils';

function useMemberIdFromQuery(): number | null {
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

export function MemberProfile() {
  const memberId = useMemberIdFromQuery();

  if (memberId == null) {
    return <MemberSearch />;
  }
  return <MemberDetailPage memberId={memberId} />;
}

function MemberSearch() {
  const [q, setQ] = useState('');
  const { data } = useQuery<{
    member_id: number;
    mc_name: string;
    party: number;
    state_abv: string;
    latest_cong: number;
    cong_count: bigint;
  }>(
    q.length >= 2
      ? `SELECT member_id, mc_name, MAX(party) AS party, MAX(state_abv) AS state_abv,
              MAX(cong) AS latest_cong, COUNT(DISTINCT cong) AS cong_count
         FROM members
         WHERE UPPER(mc_name) LIKE UPPER(?)
         GROUP BY member_id, mc_name
         ORDER BY mc_name
         LIMIT 100`
      : null,
    [`%${q}%`]
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Search any member of Congress to see their caucus history, co-members, and ideology trajectory.
          </p>
        </header>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="w-full px-3 py-2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />

        {data && data.length > 0 && (
          <Panel title={`${data.length} results`}>
            <div className="divide-y divide-[var(--color-border)]">
              {data.map((m) => (
                <a
                  key={m.member_id}
                  href={`/member?id=${m.member_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', `/member?id=${m.member_id}`);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: partyInfo(m.party).color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{m.mc_name}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)] font-mono">
                      {partyInfo(m.party).short} · {m.state_abv} · {String(m.cong_count)} congresses · latest{' '}
                      {formatCongress(m.latest_cong)}
                    </div>
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

function MemberDetailPage({ memberId }: { memberId: number }) {
  // Career: all congresses this member appeared in
  const career = useQuery<{
    cong: number;
    mc_name: string;
    party: number;
    state_abv: string;
    cd: number | null;
    nominate: number | null;
    caucus_count: bigint;
  }>(
    `SELECT m.cong, m.mc_name, m.party, m.state_abv, m.cd, m.nominate,
            COUNT(mb.caucus_id) AS caucus_count
     FROM members m
     LEFT JOIN memberships mb ON mb.member_id = m.member_id AND mb.cong = m.cong
     WHERE m.member_id = ?
     GROUP BY m.cong, m.mc_name, m.party, m.state_abv, m.cd, m.nominate
     ORDER BY m.cong`,
    [memberId]
  );

  const latest = career.data?.[career.data.length - 1];

  // Current-congress caucus list
  const currentCaucuses = useQuery<{
    cong: number;
    caucus_id: number;
    caucus_name: string;
  }>(
    latest
      ? `SELECT c.cong, c.caucus_id, c.caucus_name
         FROM memberships mb
         JOIN caucuses c ON c.caucus_id = mb.caucus_id AND c.cong = mb.cong
         WHERE mb.member_id = ? AND mb.cong = ?
         ORDER BY c.caucus_name`
      : null,
    latest ? [memberId, latest.cong] : []
  );

  // Nearest neighbors by shared caucuses (latest cong)
  const neighbors = useQuery<{
    member_id: number;
    mc_name: string;
    party: number;
    state_abv: string;
    shared: bigint;
  }>(
    latest
      ? `SELECT other.member_id, m.mc_name, m.party, m.state_abv, COUNT(*) AS shared
         FROM memberships mine
         JOIN memberships other
           ON mine.caucus_id = other.caucus_id
          AND mine.cong = other.cong
          AND mine.member_id <> other.member_id
         JOIN members m ON m.member_id = other.member_id AND m.cong = other.cong
         WHERE mine.member_id = ? AND mine.cong = ?
         GROUP BY other.member_id, m.mc_name, m.party, m.state_abv
         ORDER BY shared DESC
         LIMIT 15`
      : null,
    latest ? [memberId, latest.cong] : []
  );

  const ideologyOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!career.data || !career.data.some((r) => r.nominate != null)) return null;
    const rows = career.data
      .filter((r) => r.nominate != null)
      .map((r) => ({ cong: r.cong, score: r.nominate as number, party: r.party }));
    return {
      height: 140,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'DW-NOMINATE', domain: [-1, 1], grid: true },
      marks: [
        Plot.ruleY([0], { stroke: '#374151' }),
        Plot.lineY(rows, { x: 'cong', y: 'score', stroke: '#f59e0b', strokeWidth: 2 }),
        Plot.dot(rows, {
          x: 'cong',
          y: 'score',
          fill: (d) => partyInfo(d.party).color,
          r: 4,
        }),
      ],
    };
  }, [career.data]);

  const caucusCountOptions = useMemo<Plot.PlotOptions | null>(() => {
    if (!career.data) return null;
    return {
      height: 140,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'Caucus count', grid: true },
      marks: [
        Plot.barY(career.data, {
          x: 'cong',
          y: (d) => Number(d.caucus_count),
          fill: (d) => partyInfo(d.party).color,
        }),
      ],
    };
  }, [career.data]);

  if (career.loading || !latest) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-dim)] text-sm">
        Loading member…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Header */}
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{latest.mc_name}</h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-[var(--color-text-muted)]">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: partyInfo(latest.party).color }}
              />
              {partyInfo(latest.party).name} · {latest.state_abv}
              {latest.cd != null ? `-${latest.cd}` : ''} ·{' '}
              {career.data!.length} congresses ({formatCongress(career.data![0].cong)}–
              {formatCongress(latest.cong)})
            </div>
          </div>
          <a
            href="/member"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/member');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← back to search
          </a>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <Panel title="Ideology trajectory (DW-NOMINATE)">
            <div className="p-3">
              {ideologyOptions ? (
                <PlotChart options={ideologyOptions} />
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] py-4 text-center">
                  No DW-NOMINATE score in source data
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Caucus count over time">
            <div className="p-3">
              {caucusCountOptions ? <PlotChart options={caucusCountOptions} /> : null}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Panel title={`Caucuses — ${formatCongress(latest.cong)}`}>
            <div className="p-3 max-h-96 overflow-y-auto text-xs space-y-0.5">
              {currentCaucuses.data?.map((c) => (
                <div key={c.caucus_id} className="text-[var(--color-text-muted)] truncate">
                  · {c.caucus_name}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={`Nearest co-members — ${formatCongress(latest.cong)}`}>
            <div className="p-3 max-h-96 overflow-y-auto">
              <div className="space-y-1 text-xs">
                {neighbors.data?.map((n) => (
                  <a
                    key={n.member_id}
                    href={`/member?id=${n.member_id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      window.history.pushState({}, '', `/member?id=${n.member_id}`);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="flex items-center justify-between gap-2 py-1 hover:text-[var(--color-text)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: partyInfo(n.party).color }}
                      />
                      <span className="truncate text-[var(--color-text-muted)]">
                        {n.mc_name} <span className="text-[var(--color-text-dim)]">{n.state_abv}</span>
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--color-text-dim)] tabular-nums shrink-0">
                      {String(n.shared)} shared
                    </span>
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
