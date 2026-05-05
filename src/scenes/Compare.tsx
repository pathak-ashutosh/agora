import { useEffect, useMemo, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import { Panel } from '@/components/ui/Panel';
import { PlotChart } from '@/components/ui/PlotChart';
import { useQuery } from '@/lib/use-query';
import { partyInfo, formatCongress } from '@/lib/utils';
import { ArrowRight, ArrowLeft, X } from 'lucide-react';
import { replaceUrl } from '@/lib/url-state';
import { query } from '@/lib/duckdb';

type Side = 'left' | 'right';

interface PickedMember {
  kind: 'member';
  id: number;
  name: string;
  party: number;
  state: string;
  cong: number;
}

interface PickedCaucus {
  kind: 'caucus';
  id: number;
  name: string;
  cong: number;
}

type Picked = PickedMember | PickedCaucus;

function parsePickRef(s: string | null): { kind: 'member' | 'caucus'; id: number; cong?: number } | null {
  if (!s) return null;
  const m = /^([mc]):(\d+)(?:@(\d+))?$/.exec(s);
  if (!m) return null;
  return {
    kind: m[1] === 'm' ? 'member' : 'caucus',
    id: Number(m[2]),
    cong: m[3] ? Number(m[3]) : undefined,
  };
}

async function hydratePick(ref: { kind: 'member' | 'caucus'; id: number; cong?: number }): Promise<Picked | null> {
  if (ref.kind === 'member') {
    const rows = await query<{
      member_id: number;
      mc_name: string;
      party: number;
      state_abv: string;
      cong: number;
    }>(
      `SELECT member_id, mc_name, party, state_abv, cong
       FROM members
       WHERE member_id = ?
       ORDER BY cong DESC
       LIMIT 1`,
      [ref.id]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      kind: 'member',
      id: r.member_id,
      name: r.mc_name,
      party: r.party,
      state: r.state_abv,
      cong: ref.cong ?? r.cong,
    };
  }
  const rows = await query<{ caucus_id: number; caucus_name: string; cong: number }>(
    `SELECT caucus_id, caucus_name, cong
     FROM caucuses
     WHERE caucus_id = ?
     ORDER BY cong DESC
     LIMIT 1`,
    [ref.id]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    kind: 'caucus',
    id: r.caucus_id,
    name: r.caucus_name,
    cong: ref.cong ?? r.cong,
  };
}

function encodePick(p: Picked | null): string | null {
  if (!p) return null;
  const tag = p.kind === 'member' ? 'm' : 'c';
  return `${tag}:${p.id}@${p.cong}`;
}

export function Compare() {
  const [left, setLeft] = useState<Picked | null>(null);
  const [right, setRight] = useState<Picked | null>(null);
  const hydrated = useRef(false);

  // Hydrate from URL on mount
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const p = new URLSearchParams(window.location.search);
    const aRef = parsePickRef(p.get('a'));
    const bRef = parsePickRef(p.get('b'));
    (async () => {
      if (aRef) {
        const hydratedA = await hydratePick(aRef);
        if (hydratedA) setLeft(hydratedA);
      }
      if (bRef) {
        const hydratedB = await hydratePick(bRef);
        if (hydratedB) setRight(hydratedB);
      }
    })();
  }, []);

  // Write URL on state change
  useEffect(() => {
    if (!hydrated.current) return;
    const p = new URLSearchParams();
    const a = encodePick(left);
    const b = encodePick(right);
    if (a) p.set('a', a);
    if (b) p.set('b', b);
    const q = p.toString();
    replaceUrl(q ? `/compare?${q}` : '/compare');
  }, [left, right]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-6xl mx-auto space-y-4">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Compare</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Pick two members or two caucuses to diff their profiles side-by-side.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-4">
          <Side side="left" picked={left} onPick={setLeft} other={right} />
          <Side side="right" picked={right} onPick={setRight} other={left} />
        </div>

        {left && right && left.kind === right.kind && (
          <CompareDiff a={left} b={right} />
        )}

        {left && right && left.kind !== right.kind && (
          <div className="text-center text-xs text-[var(--color-text-dim)] py-6">
            Pick two of the same kind (both members or both caucuses) to see the diff.
          </div>
        )}
      </div>
    </div>
  );
}

function Side({
  side,
  picked,
  onPick,
  other,
}: {
  side: Side;
  picked: Picked | null;
  onPick: (p: Picked | null) => void;
  other: Picked | null;
}) {
  const [mode, setMode] = useState<'member' | 'caucus'>(other?.kind ?? 'member');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (other) setMode(other.kind);
  }, [other]);

  if (picked) {
    return (
      <Panel
        title={side === 'left' ? 'A' : 'B'}
        right={
          <button
            onClick={() => onPick(null)}
            className="text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          >
            <X size={14} />
          </button>
        }
      >
        <div className="p-4">
          <div className="text-sm font-semibold">{picked.name}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">
            {picked.kind === 'member'
              ? `${partyInfo(picked.party).name} · ${picked.state}`
              : 'Caucus'}{' '}
            · {formatCongress(picked.cong)}
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={side === 'left' ? 'A — pick one' : 'B — pick one'}>
      <div className="p-3 space-y-3">
        <div className="flex gap-1">
          {(['member', 'caucus'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 rounded text-xs ${
                mode === m
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {m === 'member' ? 'Member' : 'Caucus'}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="w-full px-2 py-1.5 rounded border border-[var(--color-border-strong)] bg-[var(--color-bg)] text-xs focus:outline-none focus:border-[var(--color-accent)]"
        />
        {mode === 'member' ? (
          <MemberResults q={q} onPick={onPick} />
        ) : (
          <CaucusResults q={q} onPick={onPick} />
        )}
      </div>
    </Panel>
  );
}

function MemberResults({ q, onPick }: { q: string; onPick: (p: Picked) => void }) {
  const { data } = useQuery<{
    member_id: number;
    mc_name: string;
    party: number;
    state_abv: string;
    latest_cong: number;
  }>(
    q.length >= 2
      ? `SELECT member_id, mc_name, MAX(party) AS party, MAX(state_abv) AS state_abv,
              MAX(cong) AS latest_cong
         FROM members
         WHERE UPPER(mc_name) LIKE UPPER(?)
         GROUP BY member_id, mc_name
         ORDER BY mc_name LIMIT 20`
      : null,
    [`%${q}%`]
  );
  return (
    <div className="max-h-60 overflow-y-auto text-xs space-y-0.5">
      {data?.map((m) => (
        <button
          key={m.member_id}
          onClick={() =>
            onPick({
              kind: 'member',
              id: m.member_id,
              name: m.mc_name,
              party: m.party,
              state: m.state_abv,
              cong: m.latest_cong,
            })
          }
          className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-[var(--color-surface-2)] rounded"
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: partyInfo(m.party).color }}
          />
          <span className="truncate flex-1">{m.mc_name}</span>
          <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
            {m.state_abv}
          </span>
        </button>
      ))}
    </div>
  );
}

function CaucusResults({ q, onPick }: { q: string; onPick: (p: Picked) => void }) {
  const { data } = useQuery<{
    caucus_id: number;
    caucus_name: string;
    latest_cong: number;
  }>(
    q.length >= 2
      ? `SELECT caucus_id, MAX(caucus_name) AS caucus_name, MAX(cong) AS latest_cong
         FROM caucuses
         WHERE UPPER(caucus_name) LIKE UPPER(?)
         GROUP BY caucus_id
         ORDER BY caucus_name LIMIT 20`
      : null,
    [`%${q}%`]
  );
  return (
    <div className="max-h-60 overflow-y-auto text-xs space-y-0.5">
      {data?.map((c) => (
        <button
          key={c.caucus_id}
          onClick={() =>
            onPick({
              kind: 'caucus',
              id: c.caucus_id,
              name: c.caucus_name,
              cong: c.latest_cong,
            })
          }
          className="w-full px-2 py-1 text-left hover:bg-[var(--color-surface-2)] rounded truncate"
        >
          {c.caucus_name}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff — shared-caucuses or shared-members set math
// ---------------------------------------------------------------------------

function CompareDiff({ a, b }: { a: Picked; b: Picked }) {
  if (a.kind === 'member' && b.kind === 'member') {
    return <MemberDiff a={a} b={b} />;
  }
  if (a.kind === 'caucus' && b.kind === 'caucus') {
    return <CaucusDiff a={a} b={b} />;
  }
  return null;
}

function MemberDiff({ a, b }: { a: PickedMember; b: PickedMember }) {
  const cong = Math.max(a.cong, b.cong);

  // Both members' careers for trajectory overlay
  const trajectories = useQuery<{
    member_id: number;
    cong: number;
    nominate: number | null;
    caucus_count: bigint;
    betweenness: number | null;
  }>(
    `SELECT m.member_id, m.cong, m.nominate,
            COUNT(mb.caucus_id) AS caucus_count,
            MAX(ms.betweenness) AS betweenness
     FROM members m
     LEFT JOIN memberships mb ON mb.member_id = m.member_id AND mb.cong = m.cong
     LEFT JOIN member_stats ms ON ms.member_id = m.member_id AND ms.cong = m.cong
     WHERE m.member_id IN (?, ?)
     GROUP BY m.member_id, m.cong, m.nominate
     ORDER BY m.cong`,
    [a.id, b.id]
  );

  const nameById = (id: number) => (id === a.id ? a.name : b.name);

  const ideologyOverlay = useMemo<Plot.PlotOptions | null>(() => {
    if (!trajectories.data || !trajectories.data.some((r) => r.nominate != null)) return null;
    const rows = trajectories.data
      .filter((r) => r.nominate != null)
      .map((r) => ({
        cong: r.cong,
        who: nameById(r.member_id),
        score: r.nominate as number,
      }));
    if (rows.length === 0) return null;
    return {
      height: 180,
      marginLeft: 44,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'DW-NOMINATE', domain: [-1, 1], grid: true },
      color: {
        domain: [a.name, b.name],
        range: [partyInfo(a.party).color, partyInfo(b.party).color],
        legend: true,
      },
      marks: [
        Plot.ruleY([0], { stroke: '#374151' }),
        Plot.lineY(rows, { x: 'cong', y: 'score', stroke: 'who', strokeWidth: 2 }),
        Plot.dot(rows, { x: 'cong', y: 'score', fill: 'who', r: 3 }),
      ],
    };
  }, [trajectories.data, a.id, a.name, a.party, b.id, b.name, b.party]);

  const diff = useQuery<{
    bucket: string;
    caucus_id: number;
    caucus_name: string;
  }>(
    `WITH
       a AS (SELECT caucus_id FROM memberships WHERE member_id = ? AND cong = ?),
       b AS (SELECT caucus_id FROM memberships WHERE member_id = ? AND cong = ?)
     SELECT 'both' AS bucket, c.caucus_id, c.caucus_name
       FROM a JOIN b USING (caucus_id)
       JOIN caucuses c ON c.caucus_id = a.caucus_id AND c.cong = ?
     UNION ALL
     SELECT 'only_a', c.caucus_id, c.caucus_name
       FROM a LEFT JOIN b USING (caucus_id)
       JOIN caucuses c ON c.caucus_id = a.caucus_id AND c.cong = ?
       WHERE b.caucus_id IS NULL
     UNION ALL
     SELECT 'only_b', c.caucus_id, c.caucus_name
       FROM b LEFT JOIN a USING (caucus_id)
       JOIN caucuses c ON c.caucus_id = b.caucus_id AND c.cong = ?
       WHERE a.caucus_id IS NULL
     ORDER BY bucket, caucus_name`,
    [a.id, cong, b.id, cong, cong, cong, cong]
  );

  const both = diff.data?.filter((r) => r.bucket === 'both') ?? [];
  const onlyA = diff.data?.filter((r) => r.bucket === 'only_a') ?? [];
  const onlyB = diff.data?.filter((r) => r.bucket === 'only_b') ?? [];

  return (
    <>
      <Panel title="Ideology trajectory">
        <div className="p-3">
          {ideologyOverlay ? (
            <PlotChart options={ideologyOverlay} />
          ) : (
            <div className="text-xs text-[var(--color-text-dim)] py-6 text-center">
              neither member has DW-NOMINATE coverage
            </div>
          )}
        </div>
      </Panel>

      <Panel title={`Caucus diff — ${formatCongress(cong)}`}>
        <div className="p-3 grid grid-cols-3 gap-4 text-xs">
          <DiffColumn
            title={`Only ${a.name}`}
            icon={<ArrowLeft size={12} />}
            items={onlyA.map((r) => r.caucus_name)}
          />
          <DiffColumn title={`Both (${both.length})`} items={both.map((r) => r.caucus_name)} />
          <DiffColumn
            title={`Only ${b.name}`}
            icon={<ArrowRight size={12} />}
            items={onlyB.map((r) => r.caucus_name)}
            alignRight
          />
        </div>
      </Panel>
    </>
  );
}

function CaucusDiff({ a, b }: { a: PickedCaucus; b: PickedCaucus }) {
  const cong = Math.max(a.cong, b.cong);

  // Both caucuses' histories for overlay
  const histories = useQuery<{
    caucus_id: number;
    cong: number;
    size: number;
    bipartisan_score: number;
    mean_nominate: number | null;
  }>(
    `SELECT caucus_id, cong, size, bipartisan_score, mean_nominate
     FROM caucus_stats
     WHERE caucus_id IN (?, ?)
     ORDER BY cong`,
    [a.id, b.id]
  );

  const nameById = (id: number) => (id === a.id ? a.name : b.name);

  const sizeOverlay = useMemo<Plot.PlotOptions | null>(() => {
    if (!histories.data || histories.data.length === 0) return null;
    const rows = histories.data.map((r) => ({
      cong: r.cong,
      who: nameById(r.caucus_id),
      size: r.size,
    }));
    return {
      height: 160,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'Members', grid: true },
      color: { domain: [a.name, b.name], range: ['#f59e0b', '#10b981'], legend: true },
      marks: [
        Plot.lineY(rows, { x: 'cong', y: 'size', stroke: 'who', strokeWidth: 2 }),
        Plot.dot(rows, { x: 'cong', y: 'size', fill: 'who', r: 3 }),
      ],
    };
  }, [histories.data, a.id, a.name, b.id, b.name]);

  const bipartisanOverlay = useMemo<Plot.PlotOptions | null>(() => {
    if (!histories.data || histories.data.length === 0) return null;
    const rows = histories.data.map((r) => ({
      cong: r.cong,
      who: nameById(r.caucus_id),
      score: r.bipartisan_score * 100,
    }));
    return {
      height: 160,
      marginLeft: 40,
      marginBottom: 30,
      x: { label: 'Congress', tickFormat: 'd' },
      y: { label: 'Bipartisan %', domain: [0, 100], grid: true },
      color: { domain: [a.name, b.name], range: ['#f59e0b', '#10b981'], legend: true },
      marks: [
        Plot.lineY(rows, { x: 'cong', y: 'score', stroke: 'who', strokeWidth: 2 }),
        Plot.dot(rows, { x: 'cong', y: 'score', fill: 'who', r: 3 }),
      ],
    };
  }, [histories.data, a.id, a.name, b.id, b.name]);

  const diff = useQuery<{
    bucket: string;
    member_id: number;
    mc_name: string;
    party: number;
  }>(
    `WITH
       a AS (SELECT member_id FROM memberships WHERE caucus_id = ? AND cong = ?),
       b AS (SELECT member_id FROM memberships WHERE caucus_id = ? AND cong = ?)
     SELECT 'both' AS bucket, m.member_id, m.mc_name, m.party
       FROM a JOIN b USING (member_id)
       JOIN members m ON m.member_id = a.member_id AND m.cong = ?
     UNION ALL
     SELECT 'only_a', m.member_id, m.mc_name, m.party
       FROM a LEFT JOIN b USING (member_id)
       JOIN members m ON m.member_id = a.member_id AND m.cong = ?
       WHERE b.member_id IS NULL
     UNION ALL
     SELECT 'only_b', m.member_id, m.mc_name, m.party
       FROM b LEFT JOIN a USING (member_id)
       JOIN members m ON m.member_id = b.member_id AND m.cong = ?
       WHERE a.member_id IS NULL
     ORDER BY bucket, mc_name`,
    [a.id, cong, b.id, cong, cong, cong, cong]
  );

  const both = diff.data?.filter((r) => r.bucket === 'both') ?? [];
  const onlyA = diff.data?.filter((r) => r.bucket === 'only_a') ?? [];
  const onlyB = diff.data?.filter((r) => r.bucket === 'only_b') ?? [];

  const renderMember = (m: { mc_name: string; party: number }) => (
    <span className="flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: partyInfo(m.party).color }}
      />
      {m.mc_name}
    </span>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Panel title="Size over time">
          <div className="p-3">
            {sizeOverlay ? <PlotChart options={sizeOverlay} /> : null}
          </div>
        </Panel>
        <Panel title="Bipartisanship over time">
          <div className="p-3">
            {bipartisanOverlay ? <PlotChart options={bipartisanOverlay} /> : null}
          </div>
        </Panel>
      </div>

      <Panel title={`Member diff — ${formatCongress(cong)}`}>
        <div className="p-3 grid grid-cols-3 gap-4 text-xs">
          <DiffColumn
            title={`Only ${a.name}`}
            icon={<ArrowLeft size={12} />}
            items={onlyA.map((r) => renderMember(r))}
          />
          <DiffColumn title={`Both (${both.length})`} items={both.map((r) => renderMember(r))} />
          <DiffColumn
            title={`Only ${b.name}`}
            icon={<ArrowRight size={12} />}
            items={onlyB.map((r) => renderMember(r))}
            alignRight
          />
        </div>
      </Panel>
    </>
  );
}

function DiffColumn({
  title,
  items,
  icon,
  alignRight,
}: {
  title: string;
  items: React.ReactNode[];
  icon?: React.ReactNode;
  alignRight?: boolean;
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-2 ${
          alignRight ? 'justify-end' : ''
        }`}
      >
        {icon}
        <span className="truncate">{title}</span>
      </div>
      <div className="space-y-0.5 max-h-80 overflow-y-auto text-[var(--color-text-muted)]">
        {items.length === 0 ? (
          <div className="text-[var(--color-text-dim)]">—</div>
        ) : (
          items.map((it, i) => (
            <div key={i} className="truncate">
              {it}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
