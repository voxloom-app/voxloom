import { fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { History } from '../../src/features/history/History';
import {
  dayLabel, formatSpoken, groupByDay, looseThreads, tally, wordCount,
} from '../../src/features/history/historyLoom';
import type { DictationRecord } from '../../src/domain/types';
import { renderWithApp } from './testUtils';

// Local wall-clock times, so the day maths holds in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const NOW = at(26, 14);
const record = (id: string, createdAt: number, extra: Partial<DictationRecord> = {}): DictationRecord => ({
  createdAt, durationSeconds: 10, id, model: null, recoveryExpiresAt: null,
  status: 'inserted', style: 'formal', text: 'one two three', ...extra,
});

describe('history loom helpers (ui-iter-02)', () => {
  it('labels days relative to now and groups newest-first records by local day', () => {
    expect(dayLabel(at(26, 0, 5), NOW)).toBe('Today');
    expect(dayLabel(at(25, 23, 55), NOW)).toBe('Yesterday');
    expect(dayLabel(at(23, 9), NOW)).toBe('Monday, Nov 23');
    const groups = groupByDay([
      record('a', at(26, 9)), record('b', at(26, 8)), record('c', at(25, 22)), record('d', at(23, 9)),
    ], NOW);
    expect(groups.map((g) => [g.label, g.records.map((r) => r.id)])).toEqual([
      ['Today', ['a', 'b']], ['Yesterday', ['c']], ['Monday, Nov 23', ['d']],
    ]);
  });

  it('counts words, spoken time and loose threads', () => {
    expect(wordCount('  Run pnpm   test  ')).toBe(3);
    expect(wordCount('   ')).toBe(0);
    expect(['42s', '1m 42s', '1h 4m'])
      .toEqual([42, 102, 3_840].map(formatSpoken));
    expect(tally([record('a', 0), record('b', 0, { durationSeconds: 5, text: 'hi' })]))
      .toEqual({ dictations: 2, seconds: 15, words: 4 });
    expect(looseThreads([
      record('a', 0, { status: 'failed' }), record('b', 0, { status: 'unverified' }),
      record('c', 0, { status: 'unverified' }), record('d', 0, { status: 'copied' }),
    ])).toEqual({ failed: 1, unverified: 2 });
  });
});

describe('History masthead', () => {
  it('groups the timeline by day without repeating its tally in the masthead', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    const stage = screen.getByRole('heading', { level: 1, name: 'History' }).closest('header')!;
    expect(stage).toHaveClass('stage');
    expect(stage.querySelector('dl')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Today');
    expect(screen.getByText('6 dictations · 1m 42s spoken')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Show (failed|unverified)$/ })).toBeNull();
  });

  it('leaves the empty state to the timeline, without a time index or clipping sheet', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    for (const button of screen.getAllByRole('button', { name: 'Delete transcript' })) fireEvent.click(button);
    expect(screen.queryByRole('navigation', { name: 'Time index' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Open clipping sheet/ })).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByText('No dictations yet')).toBeInTheDocument();
  });

  it('keeps index text and ink legible on the graphite and linen materials', () => {
    const css = readFileSync('src/styles/history-stage.css', 'utf8');
    expect(css).toMatch(/\.time-index__period \{[^}]*background: var\(--field\)/);
    expect(css).toMatch(/\.time-index__imprint i\[data-ink\] \{ background: var\(--info\)/);
    expect(css).not.toContain('animation:'); // static data, even with motion enabled
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (hex: string) => [1, 3, 5].reduce((sum, i, n) => sum + [0.2126, 0.7152, 0.0722][n] * lin(parseInt(hex.slice(i, i + 2), 16)), 0);
    for (const sheet of ['stage.css', 'daylight.css']) {
      const source = readFileSync(`src/styles/${sheet}`, 'utf8');
      const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(source)![1];
      // Peak stage glows from the previous masthead test, plus resting and hover surfaces.
      const peak = sheet === 'stage.css' ? ['#344124', '#1d3a43'] : ['#e9e4da', '#daecab', '#bce7e4'];
      for (const surface of [token('panel'), token('field'), ...peak]) {
        for (const name of ['fg', 'mut', 'info']) {
          const [dark, light] = [lum(surface), lum(token(name))].sort((a, b) => a - b);
          expect((light + .05) / (dark + .05), `${sheet}: ${name} on ${surface}`).toBeGreaterThanOrEqual(name === 'info' ? 3 : 4.5);
        }
      }
    }
  });
});
