import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';
import { useApp } from '@/lib/store';

vi.mock('@/lib/metadata', () => ({
  loadMetadata: vi.fn().mockResolvedValue({
    congresses: [103, 105, 106, 107, 108],
    has_nominate: [106, 107],
  }),
}));

const initial = useApp.getState();

beforeEach(() => {
  useApp.setState(initial, true);
  useApp.getState().setCong(108);
});

describe('Topbar', () => {
  it('shows the selected congress as an ordinal', async () => {
    render(<Topbar />);
    await waitFor(() => expect(screen.getByText('108th')).toBeTruthy());
  });

  it('slider drag updates the display without committing to the store', async () => {
    render(<Topbar />);
    const slider = await screen.findByLabelText('Congress');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText('103rd')).toBeTruthy();
    // not committed yet — store still on 108
    expect(useApp.getState().cong).toBe(108);
  });

  it('pointer-up commits the dragged congress to the store', async () => {
    render(<Topbar />);
    const slider = await screen.findByLabelText('Congress');
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.pointerUp(slider, { target: { value: '1' } });
    expect(useApp.getState().cong).toBe(105);
  });

  it('snaps to the latest congress when the stored one has no data', async () => {
    useApp.getState().setCong(999);
    render(<Topbar />);
    await waitFor(() => expect(useApp.getState().cong).toBe(108));
  });
});
