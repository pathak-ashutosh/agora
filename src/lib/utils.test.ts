import { describe, expect, it } from 'vitest';
import { cn, formatCongress, partyInfo } from './utils';

describe('cn', () => {
  it('merges conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('resolves tailwind conflicts (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

describe('partyInfo', () => {
  it('maps ICPSR party codes', () => {
    expect(partyInfo(100).short).toBe('D');
    expect(partyInfo(200).short).toBe('R');
    expect(partyInfo(328).short).toBe('I');
    expect(partyInfo(329).short).toBe('I');
  });
  it('colors stay in sync with the CSS palette', () => {
    expect(partyInfo(100).color).toBe('#4f8ef7');
    expect(partyInfo(200).color).toBe('#ef5350');
    expect(partyInfo(328).color).toBe('#2fb98a');
  });
  it('falls back gracefully for unknown codes', () => {
    const p = partyInfo(999);
    expect(p.short).toBe('?');
    expect(p.name).toContain('999');
  });
});

describe('formatCongress', () => {
  it('handles ordinal suffixes', () => {
    expect(formatCongress(103)).toBe('103rd');
    expect(formatCongress(105)).toBe('105th');
    expect(formatCongress(111)).toBe('111th'); // 11 → th, not st
    expect(formatCongress(112)).toBe('112th'); // 12 → th, not nd
    expect(formatCongress(113)).toBe('113th'); // 13 → th, not rd
    expect(formatCongress(116)).toBe('116th');
    expect(formatCongress(101)).toBe('101st');
    expect(formatCongress(102)).toBe('102nd');
  });
});
