import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogBuffer,
  createLogger,
  getLogBuffer,
  getLogLevel,
  setLogLevel,
} from './log';

beforeEach(() => {
  clearLogBuffer();
  setLogLevel('debug');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('records entries in the ring buffer with namespace + level', () => {
    const log = createLogger('test');
    log.info('hello', { a: 1 });
    const buf = getLogBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]).toMatchObject({ ns: 'test', level: 'info', msg: 'hello' });
    expect(buf[0].data).toEqual([{ a: 1 }]);
  });

  it('suppresses console output below the min level but still buffers', () => {
    setLogLevel('error');
    const log = createLogger('t');
    log.debug('quiet');
    log.warn('also quiet');
    log.error('loud');
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    // the ring keeps everything for post-hoc debugging
    expect(getLogBuffer().map((e) => e.level)).toEqual(['debug', 'warn', 'error']);
  });

  it('span logs elapsed time and returns duration', () => {
    const log = createLogger('t');
    const end = log.span('work', 'info');
    const ms = end('42 things');
    expect(ms).toBeGreaterThanOrEqual(0);
    const last = getLogBuffer().at(-1)!;
    expect(last.msg).toMatch(/^work — 42 things \(\d+ms\)$/);
    expect(last.level).toBe('info');
  });

  it('setLogLevel persists to localStorage', () => {
    setLogLevel('warn');
    expect(getLogLevel()).toBe('warn');
    expect(localStorage.getItem('agora:log')).toBe('warn');
  });

  it('caps the ring buffer at 500 entries', () => {
    const log = createLogger('t');
    for (let i = 0; i < 520; i++) log.debug(`m${i}`);
    const buf = getLogBuffer();
    expect(buf).toHaveLength(500);
    expect(buf[0].msg).toBe('m20');
    expect(buf.at(-1)!.msg).toBe('m519');
  });
});
