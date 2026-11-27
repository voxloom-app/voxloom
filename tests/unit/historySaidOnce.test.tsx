import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { unverifiedDay } from '../../src/dev/ScenarioPanel';
import { History } from '../../src/features/history/History';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
// Local early afternoon, so the fixture's runs fall on one local day in any time zone.
const NOON = () => new Date(2026, 10, 26, 14).getTime();
const NOT_VERIFIED = 'Input not verified. Inspect before copying or retrying.';

/** History on a day when every delivery came back Unverified (the current main-branch bug). */
function renderUnverifiedDay(count = 38) {
  let api: ReturnType<typeof useApp> | null = null;
  function Probe() { api = useApp(); return null; }
  renderWithApp(<><Probe /><History onToast={vi.fn()} /></>, NOON);
  act(() => {
    api!.dispatch({ type: 'scenario-empty' });
    unverifiedDay(NOON(), count).forEach((record) => api!.dispatch({ record, type: 'append-record' }));
  });
}

describe('History says it once (ui-iter-23)', () => {
  it('states the unverified caution once per day, not on every row', () => {
    renderUnverifiedDay();
    const rows = screen.getAllByRole('article');
    expect(rows).toHaveLength(38);
    const notes = document.querySelectorAll('.history-day__unsure');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(
      '38 unverified · Couldn’t confirm they were typed. Check the field before copying or retrying.',
    );
    // Each row still carries its note for screen readers, just not as a visible warning.
    for (const row of rows) {
      expect(within(row).getByText(NOT_VERIFIED)).toHaveClass('sr-only');
      expect(row.querySelector('.recovery-state')).toBeNull();
      expect(within(row).getByRole('button', { name: /Recording details.*Unverified/ })).toHaveAttribute('aria-expanded', 'false');
      expect(row.querySelector('.ledger-knot')).toHaveAttribute('data-status', 'unverified');
      expect(row.querySelector('.badge')).toBeNull();
    }
  });

  it('keys the outcomes once, on the status filter, with the same shapes as its time margin (ui-iter-39)', async () => {
    const user = userEvent.setup();
    renderWithApp(<History onToast={vi.fn()} />, NOON);
    const filter = screen.getByRole('radiogroup', { name: 'History status' });
    expect(within(filter).getByRole('radio', { name: 'All 6' })).toHaveAttribute('aria-checked', 'true');
    for (const [status, count] of [['inserted', 3], ['copied', 2], ['failed', 1], ['unverified', 0]] as const) {
      const label = `${status[0].toUpperCase()}${status.slice(1)}`;
      const radio = within(filter).getByRole('radio', { name: `${label} ${count}` });
      expect(radio.querySelector(`.ledger-knot[data-status="${status}"]`)).toHaveAttribute('aria-hidden', 'true');
      expect(document.querySelectorAll(`.ledger-stamp .ledger-knot[data-status="${status}"]`)).toHaveLength(count);
    }
    // No per-day key or "Run details" line repeats them.
    expect(document.querySelector('.ledger-key')).toBeNull();
    expect(screen.queryByText(/Run details/i)).toBeNull();
    // Counts follow the search, not the status you picked, so every chip says what it would show.
    await user.click(within(filter).getByRole('radio', { name: 'Copied 2' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(within(filter).getByRole('radio', { name: 'Inserted 3' })).toHaveAttribute('aria-checked', 'false');
    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'pnpm');
    expect(within(filter).getByRole('radio', { name: 'All 1' })).toBeInTheDocument();
    expect(within(filter).getByRole('radio', { name: 'Copied 1' })).toHaveAttribute('aria-checked', 'true');
    expect(within(filter).getByRole('radio', { name: 'Inserted 0' })).toBeInTheDocument();
  });

  it('uses the singular for a lone unverified dictation', () => {
    renderUnverifiedDay(1);
    expect(document.querySelector('.history-day__unsure'))
      .toHaveTextContent('1 unverified · Couldn’t confirm it was typed.');
  });

  it('keeps failed rows on their own panel with a visible note', () => {
    renderWithApp(<History onToast={vi.fn()} />, NOON);
    const failed = screen.getAllByRole('article').find((row) => row.dataset.status === 'failed')!;
    expect(failed.querySelector('.recovery-state')).toHaveTextContent(/recovery buffer/);
    // The fixture day has no unverified rows, so no day caution.
    expect(document.querySelector('.history-day__unsure')).toBeNull();
    const rows = css('history.css');
    expect(rows).toMatch(/\.history-row\.recent-row\[data-status="failed"\] \{ background: var\(--panel\);/);
    expect(rows).not.toMatch(/\[data-status="unverified"\][^{]*\{[^}]*background: var\(--panel\)/);
  });

  it('offers the clipping sheet only once something can be clipped', () => {
    renderUnverifiedDay();
    expect(screen.queryByRole('button', { name: /^Open clipping sheet/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Clip passage/ })).toBeNull();
  });

  it('puts the clipping sheet in the search row, which sticks once it holds a passage', () => {
    renderWithApp(<History onToast={vi.fn()} />, NOON);
    const tools = document.querySelector<HTMLElement>('.history-tools')!;
    const sheet = within(tools).getByRole('button', { name: 'Open clipping sheet, 0 passages' });
    expect(tools).not.toHaveAttribute('data-clipping');
    act(() => within(screen.getAllByRole('article')[0]).getByRole('button', { name: /^Clip passage/ }).click());
    expect(sheet).toHaveAccessibleName('Open clipping sheet, 1 passage');
    expect(sheet).toHaveAttribute('data-filled', 'true');
    expect(tools).toHaveAttribute('data-clipping', 'true');
    expect(css('history-clips.css')).toMatch(/\.history-tools\[data-clipping\] \{[^}]*position: sticky; top: 0;/);
  });

  it('reads Unverified as unknown rather than a warning in every list', () => {
    const badge = /\.badge--unverified \{([^}]*)\}/.exec(css('ui-display.css'))![1];
    expect(badge).toContain('color: var(--mut);');
    expect(badge).not.toMatch(/background: color-mix\(in srgb, var\(--warn\)/);
    const quiet = 'color-mix(in srgb, var(--warn) 45%, var(--mut))';
    expect(css('history.css')).toContain(`.ledger-knot[data-status="unverified"] { background: var(--bg); border: 2px dotted ${quiet};`);
    // Hour marks measure time, never delivery outcomes.
    expect(css('history.css')).not.toMatch(/\.history-hour[^{]*\[data-status/);
    expect(css('home.css')).toContain(`.home .recent-row[data-status="unverified"]::before { border: 2px dotted ${quiet};`);
    expect(css('home-pick.css')).toContain(`[data-status="unverified"] { --pick-tone: ${quiet}; }`);
    expect(css('recall.css')).toContain(`.recall__opt[data-status="unverified"] .recall__knot { --tone: ${quiet}; background: none; border: 1.5px dotted var(--tone); }`);
  });
});
