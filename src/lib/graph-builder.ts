/**
 * Graph builder — runs SQL against DuckDB to shape nodes + edges, then
 * assembles a Graphology graph ready for Sigma rendering.
 *
 * Two node modes:
 *   - members:   one node per MC, edges by co-caucus-membership
 *   - caucuses:  one node per caucus, edges by shared members
 *
 * Three edge kinds (member mode only; caucus mode always uses shared_members):
 *   - co_membership:   weight = # caucuses shared
 *   - ideology:        weight = 1 / (|dw1 - dw2| + epsilon), top edges only
 *   - shared_caucuses: alias for co_membership
 */
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { circular } from 'graphology-layout';
import louvain from 'graphology-communities-louvain';
import { query } from './duckdb';
import { partyInfo } from './utils';
import type { EdgeKind, NodeMode } from './store';

export interface BuildOpts {
  cong: number;
  mode: NodeMode;
  edgeKind: EdgeKind;
  topN: number;
  parties?: number[];
  states?: string[];
  minEdgeWeight: number;
  /** Node IDs to force-include beyond top-N (expand-on-click) */
  expanded?: string[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  totalMembers: number;
  totalCaucuses: number;
}

// ============================================================================
// Member mode
// ============================================================================

async function buildMemberGraph(opts: BuildOpts): Promise<{ graph: Graph; stats: GraphStats }> {
  const { cong, topN, parties, states, minEdgeWeight, edgeKind } = opts;
  const expanded = opts.expanded ?? [];

  // 1. Total counts (pre-filter)
  const [countsRow] = await query<{ total_members: bigint; total_caucuses: bigint }>(
    `SELECT
        (SELECT COUNT(DISTINCT member_id) FROM memberships WHERE cong = ?) AS total_members,
        (SELECT COUNT(DISTINCT caucus_id) FROM caucuses WHERE cong = ?) AS total_caucuses`,
    [cong, cong]
  );

  // 2. Build candidate member pool with filters
  const filters: string[] = ['m.cong = ?'];
  const params: unknown[] = [cong];
  if (parties && parties.length > 0) {
    filters.push(`m.party IN (${parties.map(() => '?').join(',')})`);
    params.push(...parties);
  }
  if (states && states.length > 0) {
    filters.push(`m.state_abv IN (${states.map(() => '?').join(',')})`);
    params.push(...states);
  }
  const whereClause = filters.join(' AND ');

  // 3. Get all members matching filter (with degree = # caucuses they belong to)
  const memberRows = await query<{
    member_id: number;
    mc_name: string;
    party: number;
    state_abv: string;
    cd: number | null;
    nominate: number | null;
    degree: bigint;
  }>(
    `SELECT m.member_id, m.mc_name, m.party, m.state_abv, m.cd, m.nominate,
            COUNT(mb.caucus_id) AS degree
     FROM members m
     LEFT JOIN memberships mb ON mb.member_id = m.member_id AND mb.cong = m.cong
     WHERE ${whereClause}
     GROUP BY m.member_id, m.mc_name, m.party, m.state_abv, m.cd, m.nominate
     ORDER BY degree DESC`,
    params
  );

  // 4. Pick top-N + expansion set
  const expandedIds = new Set(
    expanded
      .filter((id) => id.startsWith('m:'))
      .map((id) => Number(id.slice(2)))
  );
  const topIds = new Set<number>();
  for (const row of memberRows) {
    if (topIds.size >= topN && !expandedIds.has(row.member_id)) break;
    topIds.add(row.member_id);
  }
  for (const id of expandedIds) topIds.add(id);

  const keptMembers = memberRows.filter((r) => topIds.has(r.member_id));
  const idList = [...topIds];
  if (idList.length === 0) {
    return {
      graph: new Graph(),
      stats: {
        nodeCount: 0,
        edgeCount: 0,
        communityCount: 0,
        totalMembers: Number(countsRow?.total_members ?? 0),
        totalCaucuses: Number(countsRow?.total_caucuses ?? 0),
      },
    };
  }

  // 5. Edges
  let edgeRows: { a: number; b: number; weight: number }[] = [];
  if (edgeKind === 'co_membership' || edgeKind === 'shared_caucuses') {
    // Count shared caucuses via self-join on memberships
    const placeholders = idList.map(() => '?').join(',');
    edgeRows = await query<{ a: number; b: number; weight: bigint }>(
      `SELECT m1.member_id AS a, m2.member_id AS b,
              COUNT(*) AS weight
       FROM memberships m1
       JOIN memberships m2
         ON m1.caucus_id = m2.caucus_id
        AND m1.cong = m2.cong
        AND m1.member_id < m2.member_id
       WHERE m1.cong = ?
         AND m1.member_id IN (${placeholders})
         AND m2.member_id IN (${placeholders})
       GROUP BY m1.member_id, m2.member_id
       HAVING COUNT(*) >= ?`,
      [cong, ...idList, ...idList, minEdgeWeight]
    ).then((rows) =>
      rows.map((r) => ({ a: r.a, b: r.b, weight: Number(r.weight) }))
    );
  } else if (edgeKind === 'ideology') {
    // Ideology similarity: 1 / (|dw1 - dw2| + 0.05)
    // Only available for members with non-null nominate; keep top 6*N edges.
    const withNominate = keptMembers.filter((m) => m.nominate != null);
    const keep = Math.min(topN * 6, 2000);
    const edges: { a: number; b: number; weight: number }[] = [];
    for (let i = 0; i < withNominate.length; i++) {
      for (let j = i + 1; j < withNominate.length; j++) {
        const d = Math.abs(withNominate[i].nominate! - withNominate[j].nominate!);
        edges.push({
          a: withNominate[i].member_id,
          b: withNominate[j].member_id,
          weight: 1 / (d + 0.05),
        });
      }
    }
    edges.sort((x, y) => y.weight - x.weight);
    edgeRows = edges.slice(0, keep);
  }

  // 6. Assemble Graphology graph
  const graph = new Graph({ type: 'undirected' });
  for (const row of keptMembers) {
    const info = partyInfo(row.party);
    graph.addNode(`m:${row.member_id}`, {
      kind: 'member',
      memberId: row.member_id,
      label: row.mc_name,
      party: row.party,
      partyName: info.name,
      state: row.state_abv,
      district: row.cd,
      nominate: row.nominate,
      size: 4 + Math.sqrt(Number(row.degree)),
      color: info.color,
      degree: Number(row.degree),
    });
  }
  for (const e of edgeRows) {
    const src = `m:${e.a}`;
    const dst = `m:${e.b}`;
    if (graph.hasNode(src) && graph.hasNode(dst) && !graph.hasEdge(src, dst)) {
      graph.addEdge(src, dst, { weight: e.weight, size: Math.min(4, 0.5 + e.weight * 0.3) });
    }
  }

  layoutAndCommunity(graph);

  return {
    graph,
    stats: {
      nodeCount: graph.order,
      edgeCount: graph.size,
      communityCount: countCommunities(graph),
      totalMembers: Number(countsRow?.total_members ?? 0),
      totalCaucuses: Number(countsRow?.total_caucuses ?? 0),
    },
  };
}

// ============================================================================
// Caucus mode
// ============================================================================

async function buildCaucusGraph(opts: BuildOpts): Promise<{ graph: Graph; stats: GraphStats }> {
  const { cong, topN, parties, minEdgeWeight } = opts;
  const expanded = opts.expanded ?? [];

  const [countsRow] = await query<{ total_members: bigint; total_caucuses: bigint }>(
    `SELECT
        (SELECT COUNT(DISTINCT member_id) FROM memberships WHERE cong = ?) AS total_members,
        (SELECT COUNT(DISTINCT caucus_id) FROM caucuses WHERE cong = ?) AS total_caucuses`,
    [cong, cong]
  );

  // Optional party filter — restrict to caucuses containing at least one member of the given parties
  const partyFilter = parties && parties.length > 0
    ? `AND mb.member_id IN (
         SELECT member_id FROM members WHERE cong = ? AND party IN (${parties.map(() => '?').join(',')})
       )`
    : '';
  const caucusParams: unknown[] = [cong];
  if (parties && parties.length > 0) caucusParams.push(cong, ...parties);

  const caucusRows = await query<{
    caucus_id: number;
    caucus_name: string;
    member_count: bigint;
  }>(
    `SELECT c.caucus_id, c.caucus_name, COUNT(DISTINCT mb.member_id) AS member_count
     FROM caucuses c
     LEFT JOIN memberships mb ON mb.caucus_id = c.caucus_id AND mb.cong = c.cong
     WHERE c.cong = ? ${partyFilter}
     GROUP BY c.caucus_id, c.caucus_name
     ORDER BY member_count DESC`,
    caucusParams
  );

  const expandedIds = new Set(
    expanded
      .filter((id) => id.startsWith('c:'))
      .map((id) => Number(id.slice(2)))
  );
  const topIds = new Set<number>();
  for (const row of caucusRows) {
    if (topIds.size >= topN && !expandedIds.has(row.caucus_id)) break;
    topIds.add(row.caucus_id);
  }
  for (const id of expandedIds) topIds.add(id);

  const keptCaucuses = caucusRows.filter((r) => topIds.has(r.caucus_id));
  const idList = [...topIds];
  if (idList.length === 0) {
    return {
      graph: new Graph(),
      stats: {
        nodeCount: 0,
        edgeCount: 0,
        communityCount: 0,
        totalMembers: Number(countsRow?.total_members ?? 0),
        totalCaucuses: Number(countsRow?.total_caucuses ?? 0),
      },
    };
  }

  // Edges: caucus-caucus by shared members
  const placeholders = idList.map(() => '?').join(',');
  const edgeRows = await query<{ a: number; b: number; weight: bigint }>(
    `SELECT m1.caucus_id AS a, m2.caucus_id AS b, COUNT(*) AS weight
     FROM memberships m1
     JOIN memberships m2
       ON m1.member_id = m2.member_id
      AND m1.cong = m2.cong
      AND m1.caucus_id < m2.caucus_id
     WHERE m1.cong = ?
       AND m1.caucus_id IN (${placeholders})
       AND m2.caucus_id IN (${placeholders})
     GROUP BY m1.caucus_id, m2.caucus_id
     HAVING COUNT(*) >= ?`,
    [cong, ...idList, ...idList, minEdgeWeight]
  );

  const graph = new Graph({ type: 'undirected' });
  for (const row of keptCaucuses) {
    graph.addNode(`c:${row.caucus_id}`, {
      kind: 'caucus',
      caucusId: row.caucus_id,
      label: row.caucus_name,
      memberCount: Number(row.member_count),
      size: 4 + Math.sqrt(Number(row.member_count)),
      color: '#f59e0b',
    });
  }
  for (const e of edgeRows) {
    const src = `c:${e.a}`;
    const dst = `c:${e.b}`;
    if (graph.hasNode(src) && graph.hasNode(dst) && !graph.hasEdge(src, dst)) {
      graph.addEdge(src, dst, {
        weight: Number(e.weight),
        size: Math.min(4, 0.5 + Number(e.weight) * 0.05),
      });
    }
  }

  layoutAndCommunity(graph);

  return {
    graph,
    stats: {
      nodeCount: graph.order,
      edgeCount: graph.size,
      communityCount: countCommunities(graph),
      totalMembers: Number(countsRow?.total_members ?? 0),
      totalCaucuses: Number(countsRow?.total_caucuses ?? 0),
    },
  };
}

// ============================================================================
// Shared helpers
// ============================================================================

function layoutAndCommunity(graph: Graph): void {
  if (graph.order === 0) return;

  // Initial circular layout then force-atlas for stable positions
  circular.assign(graph);

  if (graph.size > 0) {
    const iterations = Math.min(200, Math.max(50, Math.floor(3000 / Math.max(graph.order, 1))));
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        gravity: 1,
        scalingRatio: 10,
        strongGravityMode: false,
        barnesHutOptimize: graph.order > 100,
        slowDown: 1 + Math.log(graph.order),
      },
    });
  }

  // Community detection for color modulation / highlighting
  if (graph.size > 0) {
    try {
      louvain.assign(graph, { nodeCommunityAttribute: 'community' });
    } catch {
      // Louvain can fail on disconnected graphs — fine to skip
    }
  }
}

function countCommunities(graph: Graph): number {
  const set = new Set<number>();
  graph.forEachNode((_, attrs) => {
    if (typeof attrs.community === 'number') set.add(attrs.community);
  });
  return set.size;
}

// ============================================================================
// Public API
// ============================================================================

export async function buildGraph(opts: BuildOpts): Promise<{ graph: Graph; stats: GraphStats }> {
  if (opts.mode === 'members') {
    return buildMemberGraph(opts);
  }
  return buildCaucusGraph(opts);
}
