/**
 * Research — interactive essay on the caucus link-prediction study, with a
 * live demo: the temporal-GNN decoder runs in-browser (ONNX Runtime Web)
 * over candidates fetched with DuckDB-WASM.
 */
import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { PlotChart } from '@/components/ui/PlotChart';
import { useQuery } from '@/lib/use-query';
import { partyInfo, formatCongress, cn } from '@/lib/utils';
import { scoreMember, type ScoredCaucus } from '@/lib/tgnn';
import * as Plot from '@observablehq/plot';

const RESULTS = [
  { model: 'popularity (caucus size)', auc: 0.678, ap: 0.079, mrr: 0.357, r10: 0.119 },
  { model: 'LR, static features', auc: 0.693, ap: 0.069, mrr: 0.31, r10: 0.102 },
  { model: 'GraphSAGE (static)', auc: 0.691, ap: 0.068, mrr: null, r10: 0.096 },
  { model: 'LR, history only', auc: 0.6, ap: 0.142, mrr: 0.332, r10: 0.145 },
  { model: 'LR, static + history', auc: 0.735, ap: 0.167, mrr: 0.461, r10: 0.203 },
  { model: 'temporal GNN (3 seeds)', auc: 0.736, ap: 0.174, mrr: 0.433, r10: 0.191 },
];

const TRANSITIONS = [112, 113, 114, 115];

interface DensityRow { cong: number; avg_caucuses: number }
interface RejoinRow { rejoin_rate: number; n: number }
interface MemberRow { member_id: number; mc_name: string; party: number; state_abv: string }

export function Research() {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg)]">
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <header className="pt-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            research
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            Who joins what next? Predicting caucus membership
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-2 leading-relaxed">
            Given everything observable about the House at congress N — caucus
            rosters, roll-call votes, cosponsorships, ideology scores — can we
            predict which caucuses each member joins at N+1? A study in
            temporal link prediction on a dense affiliation network. Every
            number below is reproducible from{' '}
            <code className="text-[11px]">research/</code> in the repo; the
            model in the demo runs in your browser.
          </p>
        </header>

        <Prose title="1 · The task">
          Candidates are (member, caucus) pairs where the member serves in both
          congresses, the caucus exists in both, and the member is <em>not</em>{' '}
          yet a member. Train on transitions 105→106 … 111→112, test on
          112→113 … 115→116 — strictly temporal, no tuning on test. 1.19M
          candidate pairs, ~35k actual joins (base rate 0.6–4.8%, swinging
          with wave elections).
        </Prose>

        <DensitySection />
        <RejoinSection />

        <Prose title="4 · Results">
          Static models — including a GraphSAGE over the co-membership graph
          and DeepWalk/SVD embeddings — never beat caucus size. History cracks
          it: a logistic regression with six history features doubles PR-AUC;
          a temporal GNN (GraphSAGE per congress snapshot + GRU across time)
          is best on PR-AUC at .174±.003. The lesson: on this task,{' '}
          <em>temporal information beats model capacity</em>.
        </Prose>

        <Panel title="test-set results · 4 held-out transitions">
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
                  <th className="text-left py-1.5">model</th>
                  <th className="text-right">ROC-AUC</th>
                  <th className="text-right">PR-AUC</th>
                  <th className="text-right">MRR</th>
                  <th className="text-right">recall@10</th>
                </tr>
              </thead>
              <tbody>
                {RESULTS.map((r) => {
                  const best = r.model.startsWith('temporal') || r.model === 'LR, static + history';
                  return (
                    <tr
                      key={r.model}
                      className={cn(
                        'border-t border-[var(--color-border)]',
                        best && 'text-[var(--color-text)]',
                        !best && 'text-[var(--color-text-muted)]'
                      )}
                    >
                      <td className="py-1.5">{r.model}</td>
                      <td className="text-right font-mono">{r.auc.toFixed(3)}</td>
                      <td className={cn('text-right font-mono', best && 'text-[var(--color-accent)]')}>
                        {r.ap.toFixed(3)}
                      </td>
                      <td className="text-right font-mono">{r.mrr ? r.mrr.toFixed(3) : '—'}</td>
                      <td className="text-right font-mono">{r.r10.toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <DemoSection />

        <footer className="text-[11px] text-[var(--color-text-dim)] leading-relaxed border-t border-[var(--color-border)] pt-4">
          Data: Congressional Caucus Networks (Ringe et al.) · Voteview
          (roll-calls, DW-NOMINATE) · ProPublica bulk bill data (cosponsorships).
          Pipeline: <code>scripts/fetch_external.sh → prep_external.py →
          research/</code>. The demo scores candidates with the exact decoder
          weights from training, exported to ONNX; node embeddings are
          precomputed per congress (two-tower serving). Metrics macro-averaged;
          GNN reported over 3 seeds.
        </footer>
      </div>
    </div>
  );
}

function Prose({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
        {title}
      </h2>
      <p className="text-sm text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
        {children}
      </p>
    </section>
  );
}

function DensitySection() {
  const { data } = useQuery<DensityRow>(
    `SELECT cong, COUNT(*)::DOUBLE / COUNT(DISTINCT member_id) AS avg_caucuses
     FROM memberships GROUP BY cong ORDER BY cong`
  );
  const options = useMemo<Plot.PlotOptions | null>(() => {
    if (!data) return null;
    return {
      height: 180,
      marginLeft: 36,
      x: { label: 'congress', tickFormat: (d: number) => `${d}` },
      y: { label: 'avg caucuses per member', grid: true },
      marks: [
        Plot.barY(data, {
          x: 'cong',
          y: 'avg_caucuses',
          fill: 'var(--color-accent)',
          fillOpacity: 0.75,
        }),
      ],
    };
  }, [data]);

  return (
    <section className="space-y-2">
      <Prose title="2 · Why the classic playbook fails">
        Common-neighbors, Adamic-Adar and friends assume shared neighbors are
        informative. Here the affiliation network is so dense that the median
        candidate pair already shares a caucus with 98% of the target's
        members — the signal saturates, and plain common-neighbors scores at
        chance (AUC .48). Caucus size alone is a brutal baseline.
      </Prose>
      {options && (
        <Panel title="density, computed live from memberships.parquet">
          <div className="p-3">
            <PlotChart options={options} />
          </div>
        </Panel>
      )}
    </section>
  );
}

function RejoinSection() {
  const { data } = useQuery<RejoinRow>(
    `WITH t AS (SELECT UNNEST([112, 113, 114, 115]) AS n0),
     j AS (
       SELECT t.n0, ms1.member_id, ms1.caucus_id
       FROM t
       JOIN memberships ms1 ON ms1.cong = t.n0 + 1
       LEFT JOIN memberships ms0
         ON ms0.cong = t.n0 AND ms0.member_id = ms1.member_id
        AND ms0.caucus_id = ms1.caucus_id
       WHERE ms0.member_id IS NULL
         AND EXISTS (SELECT 1 FROM memberships x
                     WHERE x.cong = t.n0 AND x.member_id = ms1.member_id)
         AND EXISTS (SELECT 1 FROM memberships x
                     WHERE x.cong = t.n0 AND x.caucus_id = ms1.caucus_id)
     )
     SELECT AVG(CASE WHEN EXISTS (
              SELECT 1 FROM memberships p
              WHERE p.member_id = j.member_id AND p.caucus_id = j.caucus_id
                AND p.cong < j.n0) THEN 1.0 ELSE 0.0 END) AS rejoin_rate,
            COUNT(*) AS n
     FROM j`
  );
  const rate = data?.[0] ? Number(data[0].rejoin_rate) : null;
  const n = data?.[0] ? Number(data[0].n) : null;

  return (
    <section className="space-y-2">
      <Prose title="3 · The signal everyone misses: people come back">
        The single strongest predictor isn't in the congress-N snapshot at
        all. Members <em>rejoin</em> caucuses they previously left.
      </Prose>
      <Panel title="rejoin share among new joins · computed in your browser just now">
        <div className="p-4 flex items-baseline gap-6">
          <div>
            <div className="text-3xl font-semibold font-mono text-[var(--color-accent)]">
              {rate === null ? '…' : `${(rate * 100).toFixed(1)}%`}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mt-1">
              of {n ?? '…'} new joins (test transitions) are returns
            </div>
          </div>
          <div>
            <div className="text-3xl font-semibold font-mono text-[var(--color-text-muted)]">
              1.4%
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mt-1">
              prior-membership rate among non-joined candidates
            </div>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] leading-relaxed flex-1">
            In the modeling dataset (stricter candidate rules) it's 18.9% vs
            1.4% — a 13× enrichment no within-snapshot model can see: the
            member is <em>not</em> in the caucus at congress N in both cases.
          </div>
        </div>
      </Panel>
    </section>
  );
}

function DemoSection() {
  const [n0, setN0] = useState(115);
  const [search, setSearch] = useState('');
  const [memberId, setMemberId] = useState<number | null>(null);
  const [scored, setScored] = useState<ScoredCaucus[] | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: members } = useQuery<MemberRow>(
    `SELECT m0.member_id, m0.mc_name, m0.party, m0.state_abv
     FROM members m0 JOIN members m1 USING (member_id)
     WHERE m0.cong = ? AND m1.cong = ?
     ORDER BY m0.mc_name`,
    [n0, n0 + 1]
  );

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = search.toLowerCase();
    return members
      .filter((m) => !q || m.mc_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [members, search]);

  useEffect(() => {
    setMemberId(null);
    setScored(null);
  }, [n0]);

  useEffect(() => {
    if (memberId === null) return;
    let cancelled = false;
    setScoring(true);
    setError(null);
    scoreMember(n0, Number(memberId))
      .then((s) => {
        if (!cancelled) setScored(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setScoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId, n0]);

  const member = members?.find((m) => Number(m.member_id) === Number(memberId));
  const hits = scored?.filter((s) => s.joined).length ?? 0;
  const top10Hits = scored?.slice(0, 10).filter((s) => s.joined).length ?? 0;

  return (
    <section className="space-y-2">
      <Prose title="5 · Live demo — the model, running here">
        Pick a member. DuckDB fetches their candidate caucuses and precomputed
        GNN embeddings; the decoder MLP scores every candidate with ONNX
        Runtime Web. Green rows are caucuses they actually joined at{' '}
        {formatCongress(n0 + 1)} — the model never saw these labels.
      </Prose>
      <Panel
        title="temporal GNN · in-browser inference"
        right={
          <div className="flex gap-1">
            {TRANSITIONS.map((t) => (
              <button
                key={t}
                onClick={() => setN0(t)}
                className={cn(
                  'px-2 py-0.5 rounded border text-[10px] font-mono',
                  t === n0
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)]'
                )}
              >
                {t}→{t + 1}
              </button>
            ))}
          </div>
        }
      >
        <div className="p-3 space-y-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setMemberId(null);
              setScored(null);
            }}
            placeholder={`search a member serving in both ${formatCongress(n0)} and ${formatCongress(n0 + 1)}…`}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          {search && !member && (
            <div className="flex flex-wrap gap-1.5">
              {filtered.map((m) => (
                <button
                  key={String(m.member_id)}
                  onClick={() => {
                    setMemberId(Number(m.member_id));
                    setSearch(m.mc_name);
                  }}
                  className="px-2 py-1 rounded border border-[var(--color-border-strong)] text-[11px] hover:border-[var(--color-accent)]"
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                    style={{ background: partyInfo(Number(m.party)).color }}
                  />
                  {m.mc_name} · {m.state_abv}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400">inference failed: {error}</div>
          )}
          {scoring && (
            <div className="text-xs text-[var(--color-text-dim)] py-4 text-center">
              fetching candidates + running decoder…
            </div>
          )}

          {scored && member && !scoring && (
            <div className="space-y-2">
              <div className="text-[11px] text-[var(--color-text-muted)]">
                <span className="font-semibold text-[var(--color-text)]">
                  {member.mc_name}
                </span>{' '}
                · {scored.length} candidate caucuses · actually joined{' '}
                <span className="font-mono">{hits}</span> · model put{' '}
                <span className="font-mono text-[var(--color-accent)]">
                  {top10Hits}
                </span>{' '}
                of them in its top 10
              </div>
              <div className="grid grid-cols-1 gap-px">
                {scored.slice(0, 12).map((s) => (
                  <div
                    key={s.caucus_id}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded text-xs',
                      s.joined
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'text-[var(--color-text-muted)]'
                    )}
                  >
                    <span className="font-mono text-[10px] w-6 text-right text-[var(--color-text-dim)]">
                      {s.rank}
                    </span>
                    <span className="flex-1 truncate">{s.caucus_name}</span>
                    {s.wasBefore && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)]">
                        past member
                      </span>
                    )}
                    {s.joined && (
                      <span className="text-[9px] uppercase tracking-wider">
                        joined ✓
                      </span>
                    )}
                    <span className="font-mono text-[10px] w-12 text-right">
                      {(s.prob * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
}
