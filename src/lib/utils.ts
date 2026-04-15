import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** ICPSR party codes */
export const PARTY = {
  100: { name: 'Democrat', short: 'D', color: '#3b82f6' },
  200: { name: 'Republican', short: 'R', color: '#ef4444' },
  328: { name: 'Independent', short: 'I', color: '#10b981' },
  329: { name: 'Independent', short: 'I', color: '#10b981' },
} as const;

export function partyInfo(code: number) {
  return PARTY[code as keyof typeof PARTY] ?? {
    name: `Other (${code})`,
    short: '?',
    color: '#9ca3af',
  };
}

export function formatCongress(cong: number): string {
  const suffix = cong % 100 >= 11 && cong % 100 <= 13
    ? 'th'
    : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][cong % 10];
  return `${cong}${suffix}`;
}
