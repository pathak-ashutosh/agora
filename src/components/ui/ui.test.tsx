import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';
import { SceneHeader } from './SceneHeader';
import { Skeleton, SkeletonRows } from './Skeleton';

describe('Panel', () => {
  it('renders title, right slot, and children', () => {
    render(
      <Panel title="my panel" right={<span>extra</span>}>
        <div>body</div>
      </Panel>
    );
    expect(screen.getByText('my panel')).toBeTruthy();
    expect(screen.getByText('extra')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('omits the header row when title and right are absent', () => {
    const { container } = render(
      <Panel>
        <div>only body</div>
      </Panel>
    );
    expect(container.querySelector('header')).toBeNull();
  });
});

describe('SceneHeader', () => {
  it('renders kicker, title, and lede', () => {
    render(<SceneHeader kicker="section" title="The Title" lede="A short lede." />);
    expect(screen.getByText('section')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The Title' })).toBeTruthy();
    expect(screen.getByText('A short lede.')).toBeTruthy();
  });
});

describe('Skeleton', () => {
  it('is aria-hidden decoration', () => {
    const { container } = render(<Skeleton className="h-4" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.classList.contains('skeleton')).toBe(true);
  });

  it('SkeletonRows renders n placeholder rows', () => {
    const { container } = render(<SkeletonRows n={4} />);
    expect(container.firstElementChild!.children).toHaveLength(4);
  });
});
