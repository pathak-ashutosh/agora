/**
 * Tiny hand-rolled router. Four static routes, no params in the path — all
 * entity selection happens through app state. This keeps the bundle small and
 * avoids the ceremony of a full routing library.
 */
import { useSyncExternalStore } from 'react';
import { createLogger } from './log';

const log = createLogger('router');

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(cb: Listener) {
  listeners.add(cb);
  const onPop = () => cb();
  window.addEventListener('popstate', onPop);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', onPop);
  };
}

function getPath() {
  return window.location.pathname || '/';
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, getPath, getPath);
}

export function navigate(to: string) {
  if (to === window.location.pathname) return;
  log.info(`navigate ${window.location.pathname} → ${to}`);
  window.history.pushState({}, '', to);
  listeners.forEach((l) => l());
}
