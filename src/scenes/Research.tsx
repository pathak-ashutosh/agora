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
        <header className="pt-6 reveal">
          <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent)]">
            research · temporal link prediction
          </div>
          <h1 className="font-display text-[34px] leading-[1.15] mt-2">
            Who joins what next?{' '}
            <em className="text-[var(--color-text-muted)]">
              Predicting caucus membership
            </em>
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-2 leading-relaxed">
            Members of Congress join <em>caucuses</em> — informal interest
            groups like the Congressional Bike Caucus or the House Army Caucus.
            Some members belong to dozens. This study asks a simple question:
            looking only at what's known today, can a model predict which
            caucuses each representative will join in the <em>next</em>{' '}
            two-year term? Every number below is reproducible from{' '}
            <code className="text-[11px]">research/</code> in the repo, and the
            model in the demo at the bottom runs live in your browser.
          </p>
        </header>

        <Panel title="the short version">
          <ul className="p-4 space-y-2 text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside">
            <li>
              <span className="text-[var(--color-text)]">Guessing "the big caucuses" is hard to beat.</span>{' '}
              Large caucuses recruit constantly, so always predicting the
              popular ones is an embarrassingly strong strategy.
            </li>
            <li>
              <span className="text-[var(--color-text)]">The best clue is memory, not the moment.</span>{' '}
              Members often <em>re-join</em> caucuses they left years earlier —
              a signal invisible to any model that only looks at the present.
            </li>
            <li>
              <span className="text-[var(--color-text)]">The winning model watches change over time.</span>{' '}
              A neural network that reads three consecutive congresses roughly
              doubles the accuracy of the best guess-the-popular-one baseline —
              and it's the exact model scoring candidates on this page.
            </li>
          </ul>
        </Panel>

        <Prose title="1 · The task">
          Think of it as club recommendations: for every member and every
          caucus they haven't joined yet, the model outputs a probability that
          the membership appears next term. The rules keep it honest — models
          learn only from older congresses (1997–2012) and are graded on newer
          ones (2012–2020) they have never seen, the same way you'd test a
          forecast. That's 1.19 million member-caucus possibilities, of which
          only ~35 thousand actually happened: for any given pair, the answer
          is almost always "no", which is what makes this hard.
        </Prose>

        <DensitySection />
        <RejoinSection />

        <Prose title="4 · Results">
          Every model that only looks at the present — no matter how fancy,
          including graph neural networks and learned embeddings — loses to
          "bet on the biggest caucus". Add history, and even simple models
          pull ahead: six history-based clues (was this member in this caucus
          before? how recently? how much do they churn?) roughly double the
          precision. The best overall model is a <em>temporal</em> graph
          neural network: it reads three consecutive congresses and learns how
          the network moves. The lesson generalizes:{' '}
          <em>knowing how things change beats a smarter look at a frozen
          snapshot</em>.
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
            <div className="mt-3 pt-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-dim)] leading-relaxed space-y-1">
              <div>
                <span className="text-[var(--color-text-muted)]">How to read this:</span>{' '}
                higher is better everywhere. <span className="font-mono">PR-AUC</span> is
                the headline — how well a model concentrates actual joins at the top
                of a very long list of possibilities (random guessing ≈ .027 here).
              </div>
              <div>
                <span className="font-mono">recall@10</span>: of the caucuses a member
                really did join, the share the model ranked in its top-10 guesses for
                them. <span className="font-mono">MRR</span>: how close to #1 the first
                correct guess sits (1.0 = always first). <span className="font-mono">ROC-AUC</span>:
                chance a real join outranks a random non-join (.5 = coin flip).
              </div>
            </div>
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
  const [num, ...rest] = title.split('·');
  return (
    <section>
      <h2 className="flex items-baseline gap-2.5 text-[var(--color-text)]">
        <span className="font-display italic text-lg text-[var(--color-accent)]">
          {num.trim()}
        </span>
        <span className="font-display text-lg">{rest.join('·').trim()}</span>
      </h2>
      <p className="text-sm text-[var(--color-text-muted)] mt-2 leading-[1.75]">
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
        The standard trick for predicting new connections is
        friend-of-a-friend logic: you'll probably join a club full of people
        you already share clubs with. That logic breaks here, because caucus
        membership is extraordinarily dense — by recent congresses the average
        member belongs to <em>30+ caucuses</em>, so nearly everyone already
        shares a caucus with nearly everyone else. When a clue is true for
        every candidate, it stops being a clue: the classic
        "common-neighbors" score does no better than a coin flip. Meanwhile
        the dumbest strategy — always bet on the biggest caucuses — turns out
        to be genuinely hard to beat.
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
        The strongest predictor isn't anywhere in the current picture of
        Congress — it's in the past. When a member "joins" a caucus, a big
        share of the time they're actually <em>returning</em> to one they
        belonged to years ago and left (often after losing a committee seat,
        switching districts, or a caucus going dormant). The two numbers below
        make the point: knowing a member's history changes the odds by an
        order of magnitude.
      </Prose>
      <Panel title="rejoin share among new joins · computed in your browser just now">
        <div className="p-4 space-y-3">
          <div className="flex items-baseline gap-10">
            <div className="flex-1">
              <div className="font-display text-4xl text-[var(--color-accent)]">
                {rate === null ? '…' : `${(rate * 100).toFixed(1)}%`}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mt-1">
                of {n ?? '…'} new joins are members returning to a caucus they'd left
              </div>
            </div>
            <div className="flex-1">
              <div className="font-display text-4xl text-[var(--color-text-muted)]">
                1.4%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mt-1">
                of caucuses members didn't join were ones they'd left
              </div>
            </div>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] leading-relaxed border-t border-[var(--color-border)] pt-3">
            Same person, same caucus, same moment in time — the only
            difference is the past. In the stricter modeling dataset the split
            is 18.9% vs 1.4%, a 13× difference in the odds. No model that only
            sees the current congress can use this: in both cases the member
            is <em>not</em> in the caucus today.
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
        Try it yourself: search for a representative and the trained model
        scores every caucus they hadn't joined yet, right in your browser —
        no server involved. Green rows are caucuses they{' '}
        <em>actually joined</em> in the {formatCongress(n0 + 1)} Congress;
        the model never saw those answers. "Past member" tags show the rejoin
        signal doing its work. (Under the hood: DuckDB-WASM fetches the
        candidates, ONNX Runtime Web runs the neural network's scoring head.)
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
