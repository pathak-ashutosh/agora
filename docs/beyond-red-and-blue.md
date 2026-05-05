# Beyond Red and Blue: Caucus Networks in the US Congress

Most coverage of Congress runs on two colors. Bills pass or don't, the D's did
this, the R's did that, 435 members collapsed into two columns. It's legible,
it's cheap to produce, and it throws away most of the signal in the data.

Underneath party there's a second layer: Congressional Member Organizations,
a.k.a. caucuses. Voluntary clubs inside Congress, organized around a policy,
a region, an industry, or in some cases a vibe. Progressive Caucus, Freedom
Caucus, Congressional Black Caucus — those you've heard of. There are also a
Bourbon Caucus, a Chicken Caucus, a Missing and Murdered Indigenous Women
Caucus, a Baby Caucus, a Cement Caucus. Currently over 500 active ones.
Median member belongs to ~15.

This post is about what the data looks like, what you can do with it, what you
can't, and what a more serious version would include.

## 1. The data

Three tables, keyed on member, caucus, and session-of-Congress:

```
members(member_id, cong, name, party, state, district, nominate)
caucuses(caucus_id, cong, caucus_name)
memberships(member_id, caucus_id, cong)
```

Covers Congresses 103–116, minus 104 (source data gap). ~1,300 unique members,
~1,100 caucus entries, ~112k memberships. `nominate` is DW-NOMINATE — the
Poole/Rosenthal scaling of roll-call votes onto a 1–2 dimensional ideology
axis — and it's null in ~half the sessions because source coverage is partial.
Party codes are ICPSR (100 D, 200 R, 328/329 Ind/other).

Total footprint: a few hundred KB of Parquet, easy to keep in memory anywhere.

What the data does *not* include: who leads a caucus, whether members attend
anything, what the caucus actually does. An edge here is *declared affiliation*,
which is weaker than participation. Worth holding onto that caveat — it shows
up again later.

## 2. The representation

It's a bipartite graph. Members on one side, caucuses on the other,
memberships as edges. Rendering the bipartite form directly is rarely useful;
you usually want one of two projections:

- **Member↔member**, edge weight = shared caucuses (or Jaccard over caucus
  sets, if you care about small members)
- **Caucus↔caucus**, edge weight = shared members

Both are one SQL self-join:

```sql
SELECT m1.member_id, m2.member_id, COUNT(*) w
  FROM memberships m1
  JOIN memberships m2 USING (caucus_id, cong)
 WHERE m1.member_id < m2.member_id
   AND m1.cong = ?
 GROUP BY 1, 2
```

Layout: ForceAtlas2, which is O(n log n) per iteration and converges fast on a
few thousand nodes. Community detection: Louvain. Both run client-side without
complaint on any session's full graph.

DW-NOMINATE (where present) gets attached to member nodes and used for color
or as a small-multiples axis. Everything else — party mix over time, caucus
growth, ideology histograms — is `GROUP BY cong` with a chart on top.

## 3. Why this is worth doing

Party is one bit per member. State is 50-way categorical. Caucus membership is
~500 binary features per member per session. The dimensionality alone is
useful, before you get to semantics.

Concretely, on a contested vote, roll calls mostly align with party, so party
labels can't distinguish defectors from loyalists — the information is washed
out. Caucus portfolios can. Freedom Caucus members defect predictably from GOP
leadership on CRs. Problem Solvers cosign discharge petitions across the
aisle. Neither shows up in R/D totals. You can see it in caucus vectors before
the vote happens.

None of this is new — the political science literature has been using caucus
rosters as a feature for three decades (Hammond, Wilcox, etc.). What's
different now is that the rosters are queryable in a browser instead of
trapped in PDFs.

## 4. Other views from just these three tables

Things that fall out of a few more queries, no new data required:

**Caucus lifespans.** `GROUP BY caucus_id` for min/max cong. Gantt chart by
caucus name, sorted by lifespan. Proliferation is visible directly: ~60 active
caucuses in the 103rd, 400+ by the 116th. Most are ephemeral; a small core
persists. The persistent ones are almost always the ones that matter.

**Caucus similarity matrix.** Jaccard over member sets, ~500×500, dense.
Hierarchical clustering produces families: environment (Climate Solutions,
Sustainable Energy, Oceans), defense-industrial (Armed Forces Health, Missile
Defense, Shipbuilding), agriculture, etc. Most clusters are obvious but a few
are not.

**Member trajectories.** Each member-session is a binary vector over caucuses.
Project to 2D with UMAP on cosine distance. Each career becomes a path.
Most are short and stationary. A few aren't, and those are the ones worth
reading.

**Bridge scores.** Betweenness centrality on the member projection, per
session. Top decile members tend to be the ones the press was already calling
"coalition builders" in that congress — useful sanity check; the metric works.

**Caucus cohesion.** For each caucus, average pairwise Jaccard of its members'
*other* caucuses. High-cohesion caucuses have members who share the rest of
their portfolio too (Freedom, Progressive). Low-cohesion caucuses are
single-issue signaling (Bourbon, Cement). Plot cohesion over time and you can
watch Progressive Caucus consolidation since the 110th.

**State rollups.** `GROUP BY state, caucus_id`, fraction-of-delegation as a
heatmap. Coal Caucus by WV/KY, Shrimp Caucus by LA/MS/AL, and so on. Mostly
sanity checks, but catches data errors.

**Ideology vs. caucus similarity.** Pairwise DW-NOMINATE distance vs. pairwise
caucus-set distance. Most members sit on a diagonal. Off-diagonal pairs —
same votes, different caucus portfolios — are the interesting ones: same
behavior, different reasons.

## 5. What new data unlocks

Three tables is a skeleton. The things Congress actually does live in:

- **Cosponsorship.** ProPublica publishes clean, versioned data. Building a
  cosponsorship graph and overlaying on caucus co-membership separates
  symbolic caucuses (members don't actually cosign each other's bills) from
  operational ones. This is probably the most under-used public dataset in US
  politics.
- **Roll-call votes.** Voteview has them, member × bill. Join on caucus → per-
  caucus, per-bill cohesion. Whipped caucuses look different from loose ones;
  you can quantify it.
- **Committee assignments.** Formal power structure. Four-way join (member,
  caucus, committee, session) = formal × informal cross-product. Rarely
  visualized as a single object.
- **FEC filings.** Donor graph. Temporal ordering matters here: did the donor
  base change after joining the caucus, or did donors come first? Enough data
  to do Granger-style temporal tests at network level.
- **LDA lobbying disclosures.** Bills lobbied on, by firm, per quarter. Group
  bills by sponsor's caucus → industry pressure per caucus.
- **Congressional Record.** Full floor speech text, machine readable. Topic
  modeling (LDA, the Blei kind, confusingly) joined to caucus membership
  tells you whether caucus members actually talk about caucus topics or
  whether the label is decorative.
- **Twitter/X.** Follow/retweet/reply graph. Diverges meaningfully from
  cosponsorship — members are often *performatively* aligned with one faction
  and *operationally* aligned with another. The delta between the two graphs
  is where the more honest reads live.
- **News mentions.** Co-mention graphs from GDELT or LexisNexis. Captures
  which members the press treats as a bloc.

Each of these is its own graph over the same member-session keys. The
interesting object isn't any single graph, it's the diff between them:

```
F1 = caucus co-membership
F2 = cosponsorship
F3 = donor overlap
F4 = retweet

F2 \ F1   # cosponsor but not caucus-mates      → informal alliances
F1 \ F2   # caucus-mates who don't cosponsor    → signaling memberships
F4 ⊕ F2   # retweet but don't cosponsor         → performative vs legislative
```

Those diffs are where the stories are. Single-graph analysis rarely tells you
anything you couldn't already guess.

## 6. Caveats

A technical post without a "reasons this might be wrong" section is a pitch
deck. Here's the short list.

**Data quality.** Rosters are self-reported by congressional offices,
published on wildly variable schedules, and maintained inconsistently.
Edges encode intent-to-associate, not participation. Standard fix is
downweighting by cosponsorship cohesion, which requires the data from §5.

**Long tail of trivial caucuses.** ~70% of caucuses have <10 members and
effectively no public activity. Treating them as equal nodes overweights
noise. Weighting options: log(press mentions), member count, cohesion score,
or a curated operational flag.

**Party dominates.** Louvain the member projection and you get two
communities that are ~90% party-aligned. You already knew there was a
Democratic party. The analytical claim worth making is that caucus data
informs *the residual* — what's left after controlling for party and state —
not the raw clusters.

**Endogeneity.** Caucus joining is a choice, not random. You can't read
behavioral influence off the graph without either an exogenous shock
(timing-of-entry) or an IV, and this data doesn't obviously supply either.
Current views are descriptive. Treat them that way.

**DW-NOMINATE is a compression.** Poole-Rosenthal scaling projects roll calls
onto 1-2 dimensions. The things caucus data captures are mostly the
dimensions DW-NOMINATE throws away. Comparing them is useful precisely
because they disagree — but don't treat either as ground truth.

**Identifiability.** Three public datasets joined is fine. Ten joined
datasets in the §5 list starts approaching what private political-analytics
shops sell. Reasonable guardrails: public officials only, aggregate,
retrospective, source-linkable. Without those, at person granularity, it's
profiling.

## 7. Why it's still worth building

Because the data is cheap, the graphs are standard, the serving is a static
asset + WASM, and the result is a reference object that changes slowly enough
to stay useful between news cycles.

Most political analysis is episodic — a bill passed, a member spoke, a caucus
whipped. Caucus networks are structural. They're cached state. When something
acute happens you pull them up, find the faction blocking the bill, and see
which members they'll need to flip. That's less glamorous than a hot take,
and more often correct.

Red and blue is a starting move. Everything useful is further in.
