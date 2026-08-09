import { create } from 'zustand';

export type NodeMode = 'members' | 'caucuses';
export type EdgeKind = 'co_membership' | 'ideology' | 'shared_caucuses';

export interface Selection {
  kind: 'member' | 'caucus';
  id: number;
}

interface AppState {
  /** Currently selected congress (default: most recent with data) */
  cong: number;
  setCong: (cong: number) => void;

  /** Graph node mode: draw members or caucuses as nodes */
  nodeMode: NodeMode;
  setNodeMode: (m: NodeMode) => void;

  /** How to define an edge */
  edgeKind: EdgeKind;
  setEdgeKind: (k: EdgeKind) => void;

  /** How many nodes to show (most-connected first; expand-on-click adds more) */
  topN: number;
  setTopN: (n: number) => void;

  /** Party filter — empty set means all */
  parties: Set<number>;
  toggleParty: (p: number) => void;
  clearParties: () => void;

  /** State filter — empty set means all */
  states: Set<string>;
  toggleState: (s: string) => void;
  clearStates: () => void;

  /** Min shared caucuses (or shared members in caucus mode) to draw an edge */
  minEdgeWeight: number;
  setMinEdgeWeight: (w: number) => void;

  /** Currently expanded nodes (beyond top-N) */
  expanded: Set<string>;
  expand: (nodeId: string) => void;
  collapse: (nodeId: string) => void;
  clearExpansion: () => void;

  /** Currently selected node (opens side panel) */
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
}

export const useApp = create<AppState>((set) => ({
  cong: 116,
  setCong: (cong) => set({ cong, expanded: new Set() }),

  nodeMode: 'members',
  setNodeMode: (nodeMode) => set({ nodeMode, expanded: new Set() }),

  edgeKind: 'co_membership',
  setEdgeKind: (edgeKind) => set({ edgeKind }),

  topN: 80,
  setTopN: (topN) => set({ topN }),

  parties: new Set(),
  toggleParty: (p) =>
    set((s) => {
      const next = new Set(s.parties);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { parties: next };
    }),
  clearParties: () => set({ parties: new Set() }),

  states: new Set(),
  toggleState: (st) =>
    set((s) => {
      const next = new Set(s.states);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return { states: next };
    }),
  clearStates: () => set({ states: new Set() }),

  minEdgeWeight: 18,
  setMinEdgeWeight: (minEdgeWeight) => set({ minEdgeWeight }),

  expanded: new Set(),
  expand: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      next.add(id);
      return { expanded: next };
    }),
  collapse: (id) =>
    set((s) => {
      const next = new Set(s.expanded);
      next.delete(id);
      return { expanded: next };
    }),
  clearExpansion: () => set({ expanded: new Set() }),

  selection: null,
  setSelection: (selection) => set({ selection }),
}));
