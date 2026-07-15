import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneBoundary } from './SceneBoundary';

function Bomb(): never {
  throw new Error('kaboom');
}

beforeEach(() => {
  // React logs boundary-caught errors; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SceneBoundary', () => {
  it('catches a crashing scene and shows recovery UI instead of blanking', () => {
    render(
      <SceneBoundary resetKey="network">
        <Bomb />
      </SceneBoundary>
    );
    expect(screen.getByText('This view hit an error')).toBeTruthy();
    expect(screen.getByText('kaboom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'try again' })).toBeTruthy();
  });

  it('resets when resetKey changes (route navigation recovers)', () => {
    const { rerender } = render(
      <SceneBoundary resetKey="network">
        <Bomb />
      </SceneBoundary>
    );
    expect(screen.getByText('This view hit an error')).toBeTruthy();
    rerender(
      <SceneBoundary resetKey="insights">
        <div>healthy scene</div>
      </SceneBoundary>
    );
    expect(screen.getByText('healthy scene')).toBeTruthy();
    expect(screen.queryByText('This view hit an error')).toBeNull();
  });

  it('renders children when nothing throws', () => {
    render(
      <SceneBoundary resetKey="x">
        <div>fine</div>
      </SceneBoundary>
    );
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
