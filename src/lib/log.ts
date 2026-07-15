/**
 * Structured, leveled logging for the whole app.
 *
 * - Namespaced loggers: `const log = createLogger('duckdb')`
 * - Levels: debug < info < warn < error. Default: debug in dev, info in prod.
 *   Override at runtime from the console: `localStorage['agora:log'] = 'debug'`
 *   (takes effect on reload) or `setLogLevel('debug')` (immediate).
 * - Ring buffer of the last 500 entries regardless of level, retrievable via
 *   `window.agoraLogs()` — so a bug report can include history that wasn't
 *   printed to the console.
 * - `span(label)` returns an end() function that logs the elapsed time:
 *     const end = log.span('build graph');
 *     … work …
 *     end(`${nodes} nodes`);
 */

export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  t: number;
  ns: string;
  level: Level;
  msg: string;
  data?: unknown[];
}

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RING_MAX = 500;
const ring: LogEntry[] = [];

function initialLevel(): Level {
  try {
    const s = localStorage.getItem('agora:log');
    if (s && s in ORDER) return s as Level;
  } catch {
    /* no localStorage (tests, SSR) */
  }
  return import.meta.env?.DEV ? 'debug' : 'info';
}

let minLevel: Level = initialLevel();

export function setLogLevel(level: Level): void {
  minLevel = level;
  try {
    localStorage.setItem('agora:log', level);
  } catch {
    /* ignore */
  }
}

export function getLogLevel(): Level {
  return minLevel;
}

/** Snapshot of the ring buffer (most recent last). */
export function getLogBuffer(): readonly LogEntry[] {
  return [...ring];
}

/** Clear the ring buffer (mainly for tests). */
export function clearLogBuffer(): void {
  ring.length = 0;
}

const NS_STYLE = 'color:#d9a545;font-weight:600';

export interface Logger {
  debug: (msg: string, ...data: unknown[]) => void;
  info: (msg: string, ...data: unknown[]) => void;
  warn: (msg: string, ...data: unknown[]) => void;
  error: (msg: string, ...data: unknown[]) => void;
  /** Start a timed span; call the returned fn to log completion + duration. */
  span: (label: string, level?: Level) => (extra?: string) => number;
}

export function createLogger(ns: string): Logger {
  const emit = (level: Level, msg: string, ...data: unknown[]) => {
    const entry: LogEntry = {
      t: Date.now(),
      ns,
      level,
      msg,
      data: data.length ? data : undefined,
    };
    ring.push(entry);
    if (ring.length > RING_MAX) ring.shift();
    if (ORDER[level] < ORDER[minLevel]) return;
    const method = level === 'debug' ? 'debug' : level;
    console[method](`%c[${ns}]%c ${msg}`, NS_STYLE, '', ...data);
  };

  return {
    debug: (msg, ...data) => emit('debug', msg, ...data),
    info: (msg, ...data) => emit('info', msg, ...data),
    warn: (msg, ...data) => emit('warn', msg, ...data),
    error: (msg, ...data) => emit('error', msg, ...data),
    span(label, level = 'debug') {
      const t0 = performance.now();
      return (extra?: string) => {
        const ms = performance.now() - t0;
        emit(level, `${label}${extra ? ` — ${extra}` : ''} (${ms.toFixed(0)}ms)`);
        return ms;
      };
    },
  };
}

declare global {
  interface Window {
    agoraLogs?: () => readonly LogEntry[];
    agoraLogLevel?: (l: Level) => void;
  }
}

if (typeof window !== 'undefined') {
  window.agoraLogs = getLogBuffer;
  window.agoraLogLevel = setLogLevel;
}
