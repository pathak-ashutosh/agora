/**
 * URL state sync — encodes a subset of app state into the query string so that
 * any view (filters, selection) can be shared by copying the browser URL.
 *
 * Everything is optional. Unknown params are ignored. Empty filters round-trip
 * as an absent key rather than `parties=`.
 */
import type { EdgeKind, NodeMode, Selection } from './store';

export interface UrlState {
  cong?: number;
  nodeMode?: NodeMode;
  edgeKind?: EdgeKind;
  topN?: number;
  minEdgeWeight?: number;
  parties?: number[];
  states?: string[];
  expanded?: string[];
  selection?: Selection | null;
}

const VALID_NODE_MODE = new Set(['members', 'caucuses']);
const VALID_EDGE_KIND = new Set(['co_membership', 'ideology', 'shared_caucuses']);

function parseIntOrNull(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseNodeRef(v: string): Selection | null {
  const m = /^([mc]):(\d+)$/.exec(v);
  if (!m) return null;
  return { kind: m[1] === 'm' ? 'member' : 'caucus', id: Number(m[2]) };
}

export function readUrlState(search: string = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const out: UrlState = {};

  const cong = parseIntOrNull(p.get('cong'));
  if (cong !== undefined) out.cong = cong;

  const mode = p.get('mode');
  if (mode && VALID_NODE_MODE.has(mode)) out.nodeMode = mode as NodeMode;

  const edge = p.get('edge');
  if (edge && VALID_EDGE_KIND.has(edge)) out.edgeKind = edge as EdgeKind;

  const topN = parseIntOrNull(p.get('topN'));
  if (topN !== undefined) out.topN = topN;

  const minW = parseIntOrNull(p.get('minW'));
  if (minW !== undefined) out.minEdgeWeight = minW;

  const parties = p.get('parties');
  if (parties)
    out.parties = parties
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));

  const states = p.get('states');
  if (states) out.states = states.split(',').filter((s) => /^[A-Z]{2}$/.test(s));

  const expand = p.get('expand');
  if (expand)
    out.expanded = expand.split(',').filter((s) => /^[mc]:\d+$/.test(s));

  const sel = p.get('sel');
  if (sel) {
    const parsed = parseNodeRef(sel);
    if (parsed) out.selection = parsed;
  }

  return out;
}

export interface BuildUrlArgs extends UrlState {
  path?: string;
  /** Extra query params (for scene-specific keys like `id`, `a`, `b`). */
  extra?: Record<string, string | number | null | undefined>;
}

export function buildUrl(args: BuildUrlArgs): string {
  const p = new URLSearchParams();
  if (args.cong !== undefined) p.set('cong', String(args.cong));
  if (args.nodeMode) p.set('mode', args.nodeMode);
  if (args.edgeKind) p.set('edge', args.edgeKind);
  if (args.topN !== undefined) p.set('topN', String(args.topN));
  if (args.minEdgeWeight !== undefined) p.set('minW', String(args.minEdgeWeight));
  if (args.parties && args.parties.length > 0)
    p.set('parties', args.parties.slice().sort().join(','));
  if (args.states && args.states.length > 0)
    p.set('states', args.states.slice().sort().join(','));
  if (args.expanded && args.expanded.length > 0)
    p.set('expand', args.expanded.slice().sort().join(','));
  if (args.selection) {
    const tag = args.selection.kind === 'member' ? 'm' : 'c';
    p.set('sel', `${tag}:${args.selection.id}`);
  }
  if (args.extra) {
    for (const [k, v] of Object.entries(args.extra)) {
      if (v != null && v !== '') p.set(k, String(v));
    }
  }
  const q = p.toString();
  const base = args.path ?? window.location.pathname;
  return q ? `${base}?${q}` : base;
}

/** Push a URL to history without triggering navigation events (for filter tweaks). */
export function replaceUrl(url: string): void {
  if (url === window.location.pathname + window.location.search) return;
  window.history.replaceState({}, '', url);
}
