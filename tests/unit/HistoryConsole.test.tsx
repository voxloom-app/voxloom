import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { History } from '../../src/features/history/History';
import { createRecords } from '../../src/domain/fixtures';
import type { HistoryStatus } from '../../src/domain/types';
import { isTauriEnv } from '../../src/services/capture/captureService';
import { renderWithApp } from './testUtils';

const initialRecords = createRecords(0);

afterEach(() => vi.mocked(isTauriEnv).mockReturnValue(false));

const rows = () => screen.queryAllByRole('article');
const statuses: HistoryStatus[] = ['inserted', 'copied', 'failed', 'unverified'];

describe('History empty states (UI PR 4)', () => {
  it('shows "No dictations yet" when there is no history at all, not the no-match state', () => {
    renderWithApp(<History onToast={vi.fn()} />);
    for (const button of screen.getAllByRole('button', { name: 'Delete transcript' })) fireEvent.click(button);
    expect(screen.getByText('No dictations yet')).toBeInTheDocument();
    expect(screen.queryByText('No history matches these filters')).not.toBeInTheDocument();
  });

  it('names the real Settings section in the retention line', () => {
    renderWithApp(<History onToast={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Transcripts' }).parentElement).toHaveTextContent('(Settings › Transcripts)');
  });
});

describe('History segmented filter (UI PR 4)', () => {
  it('shows exactly the records the old select showed for each status', () => {
    renderWithApp(<History onToast={vi.fn()} />);
    expect(rows()).toHaveLength(initialRecords.length);
    for (const status of statuses) {
      fireEvent.click(screen.getByRole('radio', { name: status[0].toUpperCase() + status.slice(1) }));
      const expected = initialRecords.filter((r) => r.status === status).length;
      expect(rows(), status).toHaveLength(expected);
      rows().forEach((row) => expect(within(row).getByRole('button', { name: /^Recording details/ }))
        .toHaveAccessibleName(new RegExp(`${status}$`, 'i')));
    }
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(rows()).toHaveLength(initialRecords.length);
  });

  it('combines with search, shows the empty state and is keyboard-operable', async () => {
    const user = userEvent.setup();
    renderWithApp(<History onToast={vi.fn()} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search history' }), 'zzz-no-match');
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No history matches these filters')).toBeInTheDocument();
    expect(screen.getByText('Clear the search or choose All.')).toBeInTheDocument();
    expect(screen.queryByText('No dictations yet')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(rows()).toHaveLength(initialRecords.length);
    screen.getByRole('radio', { name: 'All' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Inserted' })).toHaveAttribute('aria-checked', 'true');
    expect(rows()).toHaveLength(initialRecords.filter((r) => r.status === 'inserted').length);
  });

  it('keeps the failure note on the page and its badge in the recording slip; Retry only in the browser', () => {
    vi.mocked(isTauriEnv).mockReturnValue(true);
    renderWithApp(<History onToast={vi.fn()} />);
    expect(screen.getByText(/Audio isn’t saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Failed' }));
    const row = rows()[0];
    fireEvent.click(within(row).getByRole('button', { name: /Recording details.*Failed/ }));
    expect(within(row).getByText('Failed')).toHaveClass('badge');
    expect(within(row).getByText(/No audio retry available/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Retry transcription' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Delete transcript' })).toBeInTheDocument();
  });
});

describe('History heading order', () => {
  it('nests row text (h3) under its day (h2) under the h1, never skipping a level (axe heading-order)', () => {
    renderWithApp(<History onToast={() => {}} />);
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((level, i) => expect(level - levels[i]).toBeLessThanOrEqual(1));
    // The fixed test clock can fall just after midnight in some time zones.
    for (const day of screen.getAllByRole('heading', { level: 2 })) expect(day).toHaveTextContent(/^(Today|Yesterday)$/);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(initialRecords.length);
    for (const row of rows()) expect(within(row).queryByRole('heading', { level: 2 })).toBeNull();
  });
});

describe('History row actions (designer: reachable by keyboard and VoiceOver)', () => {
  it('keeps actions in the tab order and names them with the row text', async () => {
    const user = userEvent.setup();
    renderWithApp(<History onToast={() => {}} />);
    const row = screen.getAllByRole('article')[0];
    const text = within(row).getByRole('heading', { level: 3 }).textContent ?? '';
    // No aria-labelledby on the row: VoiceOver would read the transcript twice.
    expect(row).not.toHaveAttribute('aria-labelledby');
    row.focus();
    await user.tab();
    expect(within(row).getByRole('button', { name: /^Recording details/ })).toHaveFocus();
    await user.tab();
    const first = within(row).getByRole('button', { name: 'Copy transcript' });
    expect(first).toHaveFocus();
    expect(first).toHaveAccessibleDescription(text);
    for (const other of within(row).getAllByRole('button').filter((b) => b !== first)) {
      expect(other).not.toHaveAttribute('aria-describedby');
    }
    expect(within(row).getByRole('group', { name: 'Transcript actions' })).toBeVisible();
  });

  it('never hides actions with visibility/display (opacity only, shown on focus-within)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/lists.css', 'utf8');
    expect(css).toMatch(/\.history-list \.action-group \{ opacity: 0; \}/);
    expect(css).toMatch(/\.recent-row:focus-within \.action-group/);
    expect(css).not.toMatch(/\.history-list \.action-group \{[^}]*visibility: hidden/);
  });

  it('keeps actions always visible on Failed and Unverified rows (designer)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/lists.css', 'utf8');
    expect(css).toMatch(/\.recent-row\[data-status="failed"\] \.action-group,\s*\.history-list \.recent-row\[data-status="unverified"\] \.action-group \{ opacity: 1; \}/);
    renderWithApp(<History onToast={() => {}} />);
    for (const row of screen.getAllByRole('article')) {
      expect(row).toHaveAttribute('data-status');
      expect(within(row).getAllByRole('heading')).toHaveLength(1);
    }
  });
});

describe('may-have-inserted History rows (Review #44)', () => {
  it.each([
    [false, 'May have been inserted. Check the field before copying or retrying.'],
    [true, 'May have been inserted (also copied). Check the field before copying or retrying.'],
  ])('shows Unverified with a check-the-field note (copied=%s), never Failed/Copied', async (copied, note) => {
    const { render } = await import('@testing-library/react');
    const { HistoryRow } = await import('../../src/features/history/HistoryRow');
    const record = {
      createdAt: 1_000, durationSeconds: 1, id: 'm', mayHaveInserted: { copied }, model: null,
      recoveryExpiresAt: null, status: 'unverified' as const, style: 'formal' as const, text: 'hi',
    };
    render(<HistoryRow canStart currentTime={2_000} isNative onCopy={() => {}} onDelete={() => {}} onRetry={() => {}} record={record} />);
    expect(screen.getByRole('button', { name: /Recording details.*Unverified/ })).toBeVisible();
    expect(screen.queryByText(/^(Failed|Copied)$/)).toBeNull();
    expect(screen.getByText(note, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/copy the text to recover it/)).toBeNull();
  });
});

