import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from './store';

const initial = useApp.getState();

beforeEach(() => {
  useApp.setState(initial, true);
});

describe('app store', () => {
  it('setCong clears node expansions', () => {
    useApp.getState().expand('m:1');
    expect(useApp.getState().expanded.has('m:1')).toBe(true);
    useApp.getState().setCong(110);
    expect(useApp.getState().cong).toBe(110);
    expect(useApp.getState().expanded.size).toBe(0);
  });

  it('toggleParty adds then removes', () => {
    useApp.getState().toggleParty(100);
    expect(useApp.getState().parties.has(100)).toBe(true);
    useApp.getState().toggleParty(100);
    expect(useApp.getState().parties.has(100)).toBe(false);
  });

  it('party toggles do not mutate the previous set', () => {
    const before = useApp.getState().parties;
    useApp.getState().toggleParty(200);
    expect(before.has(200)).toBe(false);
    expect(useApp.getState().parties).not.toBe(before);
  });

  it('expand/collapse round-trips', () => {
    useApp.getState().expand('c:42');
    useApp.getState().expand('m:7');
    useApp.getState().collapse('c:42');
    expect([...useApp.getState().expanded]).toEqual(['m:7']);
    useApp.getState().clearExpansion();
    expect(useApp.getState().expanded.size).toBe(0);
  });

  it('setNodeMode resets expansions', () => {
    useApp.getState().expand('m:1');
    useApp.getState().setNodeMode('caucuses');
    expect(useApp.getState().expanded.size).toBe(0);
    expect(useApp.getState().nodeMode).toBe('caucuses');
  });

  it('selection is settable and clearable', () => {
    useApp.getState().setSelection({ kind: 'member', id: 12 });
    expect(useApp.getState().selection).toEqual({ kind: 'member', id: 12 });
    useApp.getState().setSelection(null);
    expect(useApp.getState().selection).toBeNull();
  });
});
