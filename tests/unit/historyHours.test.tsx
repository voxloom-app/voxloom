import { readFileSync } from 'node:fs';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import type { DictationRecord } from '../../src/domain/types';
import { History } from '../../src/features/history/History';
import { hourRuns } from '../../src/features/history/hourRuns';
import { renderWithApp } from './testUtils';

// Local wall-clock times, so the hour maths holds in any time zone.
const at = (day: number, hour = 14, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const marks = () => [...document.querySelectorAll('.history-hour')].map((mark) => mark.textContent);

function setup() {
  let api: ReturnType<typeof useApp>;
  function Probe() { api = useApp(); return null; }
  renderWithApp(<><Probe /><History onToast={vi.fn()} /></>, () => at(26));
  return (day: number) => act(() => api.dispatch({ type: 'append-record', record: {
    createdAt: at(day), durationSeconds: 3, id: `entry-${day}`, model: null, recoveryExpiresAt: null,
    status: 'unverified', style: 'formal', text: `Extra dictation on November ${day}`,
  } }));
}

/** ui-iter-39 replaced the time cards above the list (ui-iter-28) with hour marks in its margin. */
describe('History hour marks', () => {
  it('marks where the hour turns, in the rows’ own order, and follows the filter and search', () => {
    setup();
    expect(screen.queryByRole('navigation', { name: 'Time index' })).toBeNull();
    expect(marks()).toEqual(['1 PM', '12 PM']);
    const list = document.querySelector('.history-list')!;
    const order = [...list.children].map((el) => el.classList.contains('history-hour') ? el.textContent : el.getAttribute('data-record'));
    expect(order).toEqual(['1 PM', 'record-1', 'record-2', 'record-3', '12 PM', 'record-4', 'record-5', 'record-6']);
    expect(list.querySelector('.history-hour')).toHaveAttribute('data-first', 'true');
    expect(list.querySelectorAll('.history-hour[data-first]')).toHaveLength(1);
    // Plain text between rows, not headings: the h1 > h2 > h3 outline is unchanged.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: '1 PM' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Copied \d+$/ }));
    expect(marks()).toEqual(['1 PM', '12 PM']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search history' }), { target: { value: 'pnpm' } });
    // One hour needs no mark.
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(marks()).toEqual([]);
  });

  it('marks each day on its own and leaves a one-hour day unmarked', () => {
    const add = setup();
    [25, 23].forEach(add);
    const days = [...document.querySelectorAll('.history-day')];
    expect(days).toHaveLength(3);
    expect(days.map((day) => day.querySelectorAll('.history-hour').length)).toEqual([2, 0, 0]);
  });

  it('splits on the local hour and the date, never merging the same hour on two days', () => {
    const record = (id: string, createdAt: number) => ({ createdAt, id }) as DictationRecord;
    const runs = hourRuns([
      record('a', at(26, 13, 50)), record('b', at(26, 13, 2)), record('c', at(26, 9, 59)),
      record('d', at(25, 9, 30)), record('e', at(25, 9, 1)),
    ]);
    expect(runs.map((run) => [run.label, run.records.map(({ id }) => id)])).toEqual([
      ['1 PM', ['a', 'b']], ['9 AM', ['c']], ['9 AM', ['d', 'e']],
    ]);
    expect(new Set(runs.map((run) => run.key)).size).toBe(3);
  });

  it('keeps the mark in the margin while its hour is read, without catching clicks', () => {
    const css = readFileSync('src/styles/history.css', 'utf8');
    const mark = /\.history-list > \.history-hour \{([^}]*)\}/.exec(css)![1];
    expect(mark).toContain('position: sticky; top: 0;');
    expect(mark).toContain('pointer-events: none;');
    expect(mark).toContain('grid-template-columns: var(--stamp-w) 1fr;');
    // Every pill spans the time column, so a later mark covers the one it replaces and any time under it.
    expect(css).toMatch(/\.history-hour > span \{[^}]*width: calc\(var\(--stamp-w\) - var\(--s-6\)\);/);
    // Rows leave room under the mark when Recall or a jump brings them into view.
    expect(css).toMatch(/\.history-row\.recent-row \{[^}]*scroll-margin-block: 3\.5rem 1rem;/);
    // With a clipped passage the tools row sticks too; the mark rides below it.
    expect(css).toContain('.history .page-body:has(> .history-tools[data-clipping]) .history-hour { top:');
  });
});
