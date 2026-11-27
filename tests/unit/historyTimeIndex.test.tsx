import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { History } from '../../src/features/history/History';
import { renderWithApp } from './testUtils';

const at = (day: number, hour = 14) => new Date(2026, 10, day, hour).getTime();
const index = () => screen.getByRole('navigation', { name: 'Time index' });

function setup() {
  let api: ReturnType<typeof useApp>;
  function Probe() { api = useApp(); return null; }
  renderWithApp(<><Probe /><History onToast={vi.fn()} /></>, () => at(26));
  return (day: number) => act(() => api.dispatch({ type: 'append-record', record: {
    createdAt: at(day), durationSeconds: 3, id: `entry-${day}`, model: null, recoveryExpiresAt: null,
    status: 'unverified', style: 'formal', text: `Extra dictation on November ${day}`,
  } }));
}

describe('History time index', () => {
  it('jumps to the newest visible row in an hour without changing the matches', () => {
    setup();
    expect(index()).toHaveTextContent(/Jump by hour/);
    const jumps = within(index()).getAllByRole('button');
    expect(jumps.map((jump) => jump.getAttribute('aria-label'))).toEqual([
      'Jump to 1 PM, 3 dictations', 'Jump to 12 PM, 3 dictations',
    ]);
    // The 12 PM card has one punch per occupied five-minute interval.
    const slots = [...jumps[1].querySelectorAll('.time-index__imprint i')];
    expect(slots).toHaveLength(12);
    expect(slots.flatMap((slot, i) => slot.hasAttribute('data-ink') ? [i] : [])).toEqual([1, 5, 10]);
    fireEvent.click(jumps[1]);
    expect(document.activeElement).toHaveAttribute('data-record', 'record-4');
    expect(screen.getAllByRole('article')).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: 'Copied' }));
    fireEvent.click(within(index()).getByRole('button', { name: 'Jump to 12 PM, 1 dictation' }));
    expect(document.activeElement).toHaveAttribute('data-record', 'record-6');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), { target: { value: 'absent' } });
    expect(screen.queryByRole('navigation', { name: 'Time index' })).toBeNull();
  });

  it('indexes dates across days, pages through occupied dates, and rebuilds for search', () => {
    const add = setup();
    [25, 23, 22, 21, 19].forEach(add);
    expect(index()).toHaveTextContent('Jump by date');
    const dates = () => within(index()).getAllByRole('button', { name: /^Jump to/ });
    expect(dates()).toHaveLength(4);
    expect(dates()[0]).toHaveAccessibleName(/November 26, 2026, 6 dictations/);
    // Six runs spread over two hours, not six duplicate punches.
    expect(dates()[0].querySelectorAll('.time-index__imprint i')).toHaveLength(24);
    expect(dates()[0].querySelectorAll('[data-ink]')).toHaveLength(2);
    fireEvent.click(within(index()).getByRole('button', { name: 'Earlier dates' }));
    expect(dates()).toHaveLength(2);
    fireEvent.click(dates()[1]);
    expect(document.activeElement).toHaveAttribute('data-record', 'entry-19');
    fireEvent.click(within(index()).getByRole('button', { name: 'Later dates' }));
    expect(dates()).toHaveLength(4);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), { target: { value: 'November 19' } });
    expect(index()).toHaveTextContent('Jump by hour');
    fireEvent.click(within(index()).getByRole('button', { name: 'Jump to 2 PM, 1 dictation' }));
    expect(document.activeElement).toHaveAttribute('data-record', 'entry-19');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});
