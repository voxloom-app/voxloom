import { fireEvent, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { History } from '../../src/features/history/History';
import {
  dayLabel, formatSpoken, groupByDay, loomLayout, looseThreads, tally, weftPath, wordCount,
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
const knots = () => [...document.querySelectorAll<HTMLElement>('.day-loom__knot')];

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

  it('spans whole hours, at least three, and runs today on to now', () => {
    const layout = loomLayout([record('old', at(26, 12, 8)), record('new', at(26, 13, 57), { durationSeconds: 60 })], NOW, true);
    expect(layout.ticks.map((t) => t.label)).toEqual(['12 PM', '1 PM', '2 PM', '3 PM']);
    expect(layout.ticks.map((t) => Math.round(t.x))).toEqual([0, 33, 67, 100]);
    expect(layout.now).toBeCloseTo(66.67, 1);
    expect(layout.knots.map((k) => [k.id, k.newest, k.size])).toEqual([['old', false, 12], ['new', true, 18]]);
    expect(layout.knots[0].x).toBeCloseTo((8 / 180) * 100, 5);

    const earlier = loomLayout([record('a', at(25, 7, 30)), record('b', at(25, 18, 10))], NOW, false);
    expect(earlier.now).toBeNull();
    expect(earlier.ticks[0].label).toBe('7 AM');
    expect(earlier.ticks.at(-1)!.x).toBeLessThanOrEqual(100);
    expect(earlier.ticks.length).toBeLessThanOrEqual(7);
    expect(loomLayout([], NOW, true)).toEqual({ knots: [], now: null, ticks: [] });
  });

  it('weaves both threads through every knot and on to the end', () => {
    for (const side of [1, -1] as const) {
      const d = weftPath([100, 400, 410], side, 700);
      expect(d.startsWith('M0 ')).toBe(true);
      for (const x of ['100', '400.0', '410.0', '700.0']) expect(d).toContain(` ${x} 24`);
    }
    // The threads swap sides between knots, so they cross at each one.
    const lift = (d: string) => Number(d.split(' C ')[2].split(' ')[1]);
    expect(lift(weftPath([100, 400], 1, 400))).toBeGreaterThan(24);
    expect(lift(weftPath([100, 400], -1, 400))).toBeLessThan(24);
    expect(weftPath([], 1, 0)).toBe('');
  });
});

describe('History woven day (ui-iter-02)', () => {
  it('tallies the latest day in the masthead and groups the timeline under it', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    const stage = document.querySelector('.history-stage')!;
    expect(stage).toHaveClass('stage');
    expect(within(stage as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent('History');
    expect(stage.querySelector('.history-stage__day')).toHaveTextContent('Today');
    const tallies = [...stage.querySelectorAll('dl > div')].map((d) => d.textContent);
    expect(tallies).toEqual(['Dictations6', 'Words41', 'Spoken1m 42s']);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Today');
    expect(screen.getByText('6 dictations · 1m 42s spoken')).toBeInTheDocument();
    expect(knots()).toHaveLength(6);
    expect(document.querySelector('.day-loom')).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls out loose threads and toggles the timeline to them', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    const deck = document.querySelector<HTMLElement>('.history-stage__deck')!;
    expect(deck).toHaveTextContent('1 loose thread · 1 failed. Check it before you copy or retry.');
    const show = within(deck).getByRole('button', { name: 'Show failed' });
    expect(within(deck).queryByRole('button', { name: 'Show unverified' })).toBeNull();
    fireEvent.click(show);
    expect(show).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('radio', { name: 'Failed' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    // Knots stay on the loom; the ones the filter hides fade.
    expect(knots().filter((k) => k.dataset.match === 'false')).toHaveLength(5);
    fireEvent.click(show);
    expect(show).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('lights the knot of the row under the pointer or focus', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    const [newest, second] = screen.getAllByRole('article');
    const activeKnots = () => knots().filter((k) => k.dataset.active).map((k) => k.dataset.record);
    fireEvent.mouseOver(within(second).getByRole('heading', { level: 3 }));
    expect(activeKnots()).toEqual(['record-2']);
    fireEvent.mouseLeave(document.querySelector('.history-timeline')!);
    expect(activeKnots()).toEqual([]);
    fireEvent.focus(within(newest).getByRole('button', { name: 'Copy transcript' }));
    expect(activeKnots()).toEqual(['record-1']);
    fireEvent.blur(within(newest).getByRole('button', { name: 'Copy transcript' }));
    expect(activeKnots()).toEqual([]);
  });

  it('keeps an empty loom, and no tally or deck, when there is no history', () => {
    renderWithApp(<History onToast={vi.fn()} />, () => NOW);
    for (const button of screen.getAllByRole('button', { name: 'Delete transcript' })) fireEvent.click(button);
    expect(document.querySelector('.day-loom')).toHaveAttribute('data-empty', 'true');
    expect(document.querySelector('.history-stage__tally')).toBeNull();
    expect(document.querySelector('.history-stage__deck')).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByText('No dictations yet')).toBeInTheDocument();
  });

  it('keeps masthead text at AA on the surfaces it adds to the stage', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const stage = readFileSync('src/styles/stage.css', 'utf8');
    const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(stage)![1];
    const css = readFileSync('src/styles/history-stage.css', 'utf8');
    // Pin the surfaces this test measures, so a restyle has to revisit it.
    expect(css).toContain('.day-loom__waiting { background: #15151c;');
    expect(css).toContain('background: rgba(255, 255, 255, .025);');
    expect(css).toContain('.history-stage__jump .btn:hover { background: rgba(255, 255, 255, .09); }');
    const top = '#17171f';
    const surfaces = [
      '#15151c', // waiting chip
      mix('#ffffff', top, 0.025), // loose-threads deck
      mix('#ffffff', top, 0.09), // hovered deck button
      mix('#b6ff3c', top, 0.18), // brightest lime glow
      mix('#3cf0ff', top, 0.16), // brightest cyan glow
    ];
    for (const surface of surfaces) {
      expect(ratio(token('mut'), surface), `mut on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('fg'), surface), `fg on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio('#b6ff3c', surface), `TODAY / NOW on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio('#f6f6f9', surface), `title and tally on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stills the loom under reduced motion', () => {
    const css = readFileSync('src/styles/history-stage.css', 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.day-loom__pulse { display: none; }');
    expect(reduced).toContain('.day-loom__now::after { animation: none; }');
  });
});
