import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { navigate, useRoute } from './router';

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

describe('router', () => {
  it('useRoute reflects the current path', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toBe('/');
  });

  it('navigate updates the URL and notifies subscribers', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate('/member'));
    expect(window.location.pathname).toBe('/member');
    expect(result.current).toBe('/member');
  });

  it('navigate to the current path is a no-op', () => {
    act(() => navigate('/caucus'));
    const len = window.history.length;
    act(() => navigate('/caucus'));
    expect(window.history.length).toBe(len);
  });

  it('responds to browser back/forward (popstate)', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate('/research'));
    expect(result.current).toBe('/research');
    act(() => {
      window.history.pushState({}, '', '/insights');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toBe('/insights');
  });
});
