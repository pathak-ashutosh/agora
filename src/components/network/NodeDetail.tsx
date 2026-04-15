import { Panel } from '@/components/ui/Panel';
import { useApp } from '@/lib/store';
import { useQuery } from '@/lib/use-query';
import { partyInfo } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { ExternalLink, X } from 'lucide-react';

interface MemberRow {
  member_id: number;
  mc_name: string;
  party: number;
  state_abv: string;
  cd: number | null;
  nominate: number | null;
  caucus_count: bigint;
}

interface CaucusRow {
  caucus_id: number;
  caucus_name: string;
  member_count: bigint;
  dem_count: bigint;
  rep_count: bigint;
  other_count: bigint;
}

export function NodeDetail() {
  const { selection, cong, setSelection } = useApp();

  if (!selection) {
    return (
      <Panel title="Selection" className="text-xs">
        <div className="p-4 text-[var(--color-text-dim)] text-xs">
          Click a node to see details. Double-click to expand its neighbors.
        </div>
      </Panel>
    );
  }

  if (selection.kind === 'member') {
    return <MemberDetail memberId={selection.id} cong={cong} onClose={() => setSelection(null)} />;
  }
  return <CaucusDetail caucusId={selection.id} cong={cong} onClose={() => setSelection(null)} />;
}

function MemberDetail({ memberId, cong, onClose }: { memberId: number; cong: number; onClose: () => void }) {
  const { data, loading } = useQuery<MemberRow>(
    `SELECT m.member_id, m.mc_name, m.party, m.state_abv, m.cd, m.nominate,
            COUNT(mb.caucus_id) AS caucus_count
     FROM members m
     LEFT JOIN memberships mb ON mb.member_id = m.member_id AND mb.cong = m.cong
     WHERE m.member_id = ? AND m.cong = ?
     GROUP BY m.member_id, m.mc_name, m.party, m.state_abv, m.cd, m.nominate`,
    [memberId, cong]
  );
  const caucuses = useQuery<{ caucus_id: number; caucus_name: string }>(
    `SELECT c.caucus_id, c.caucus_name
     FROM memberships mb
     JOIN caucuses c ON c.caucus_id = mb.caucus_id AND c.cong = mb.cong
     WHERE mb.member_id = ? AND mb.cong = ?
     ORDER BY c.caucus_name`,
    [memberId, cong]
  );

  const row = data?.[0];

  return (
    <Panel
      title="Member"
      right={
        <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
          <X size={14} />
        </button>
      }
      className="text-xs"
    >
      {loading || !row ? (
        <div className="p-3 text-[var(--color-text-dim)]">Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)] leading-tight">
              {row.mc_name}
            </div>
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] mt-0.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: partyInfo(row.party).color }}
              />
              <span>{partyInfo(row.party).name}</span>
              <span>·</span>
              <span className="font-mono">
                {row.state_abv}
                {row.cd != null ? `-${row.cd}` : ''}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
            <Stat label="Caucuses" value={String(row.caucus_count)} />
            <Stat
              label="DW-NOMINATE"
              value={row.nominate != null ? row.nominate.toFixed(3) : '—'}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1.5">
              Caucuses ({caucuses.data?.length ?? 0})
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
              {caucuses.data?.map((c) => (
                <div
                  key={c.caucus_id}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] truncate"
                  title={c.caucus_name}
                >
                  · {c.caucus_name}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => navigate(`/member?id=${row.member_id}`)}
            className="flex items-center gap-1.5 text-[var(--color-accent)] hover:underline"
          >
            Full profile <ExternalLink size={12} />
          </button>
        </div>
      )}
    </Panel>
  );
}

function CaucusDetail({ caucusId, cong, onClose }: { caucusId: number; cong: number; onClose: () => void }) {
  const { data, loading } = useQuery<CaucusRow>(
    `SELECT c.caucus_id, c.caucus_name,
            COUNT(DISTINCT mb.member_id) AS member_count,
            SUM(CASE WHEN m.party = 100 THEN 1 ELSE 0 END) AS dem_count,
            SUM(CASE WHEN m.party = 200 THEN 1 ELSE 0 END) AS rep_count,
            SUM(CASE WHEN m.party NOT IN (100, 200) THEN 1 ELSE 0 END) AS other_count
     FROM caucuses c
     LEFT JOIN memberships mb ON mb.caucus_id = c.caucus_id AND mb.cong = c.cong
     LEFT JOIN members m ON m.member_id = mb.member_id AND m.cong = mb.cong
     WHERE c.caucus_id = ? AND c.cong = ?
     GROUP BY c.caucus_id, c.caucus_name`,
    [caucusId, cong]
  );
  const members = useQuery<{ member_id: number; mc_name: string; party: number; state_abv: string }>(
    `SELECT m.member_id, m.mc_name, m.party, m.state_abv
     FROM memberships mb
     JOIN members m ON m.member_id = mb.member_id AND m.cong = mb.cong
     WHERE mb.caucus_id = ? AND mb.cong = ?
     ORDER BY m.mc_name`,
    [caucusId, cong]
  );

  const row = data?.[0];

  return (
    <Panel
      title="Caucus"
      right={
        <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text)]">
          <X size={14} />
        </button>
      }
      className="text-xs"
    >
      {loading || !row ? (
        <div className="p-3 text-[var(--color-text-dim)]">Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="text-sm font-semibold text-[var(--color-text)] leading-tight">
            {row.caucus_name}
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
            <Stat label="Total" value={String(row.member_count)} />
            <Stat label="Dem" value={String(row.dem_count)} color="var(--color-dem)" />
            <Stat label="Rep" value={String(row.rep_count)} color="var(--color-rep)" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-1.5">
              Members ({members.data?.length ?? 0})
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
              {members.data?.map((m) => (
                <div key={m.member_id} className="flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: partyInfo(m.party).color }}
                  />
                  <span className="text-[var(--color-text-muted)] truncate">
                    {m.mc_name} <span className="text-[var(--color-text-dim)]">{m.state_abv}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => navigate(`/caucus?id=${row.caucus_id}`)}
            className="flex items-center gap-1.5 text-[var(--color-accent)] hover:underline"
          >
            Full profile <ExternalLink size={12} />
          </button>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-[var(--color-text-dim)]">
        {label}
      </div>
      <div className="text-[var(--color-text)] text-sm" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
