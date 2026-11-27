import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { AppProvider, useApp } from '../../src/app/AppContext';
import { RailWarp, warpPath } from '../../src/app/shell/RailWarp';
import { clothLayout, pickHeight } from '../../src/app/shell/railCloth';
import { Sidebar } from '../../src/app/shell/Sidebar';
import type { DictationRecord } from '../../src/domain/types';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
// Local early afternoon, so the fixture's last two hours fall on one local day in any time zone.
const NOON = () => new Date(2026, 10, 26, 14).getTime();
const rail = () => document.querySelector('aside.sidebar')!;
const current = () => within(screen.getByRole('navigation', { name: 'Voxloom screens' }))
  .getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.getAttribute('aria-label');

describe('warp rail (ui-iter-03)', () => {
  it('follows the voice phase on every screen, with a live status line', async () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    const user = userEvent.setup();
    renderWithApp(<><Probe /><App /></>);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    await user.click(screen.getByRole('button', { name: 'Dictionary' }));
    expect(rail()).toHaveAttribute('data-phase', 'idle');
    act(() => api!.dictation.start());
    expect(rail()).toHaveAttribute('data-phase', 'listening');
    expect(document.querySelector('.brand__status')).toHaveTextContent('Listening');
    act(() => api!.dictation.speech('speaking'));
    expect(rail()).toHaveAttribute('data-phase', 'speaking');
  });

  it('draws the warp as decoration only: hidden, unfocusable, seven threads with a pulse each', () => {
    renderWithApp(<RailWarp />);
    const warp = document.querySelector('.rail-warp')!;
    expect(warp).toHaveAttribute('aria-hidden', 'true');
    expect(warp.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(warp.querySelectorAll('.rail-warp__thread')).toHaveLength(7);
    expect(warp.querySelectorAll('.rail-warp__pulse')).toHaveLength(7);
    // Every thread starts across the top and closes in to carry the cloth down to the shuttle.
    expect(warpPath(-42, 0)).toMatch(/^M8 0 .* 23\.96 100$/);
    expect(warpPath(0, 3)).toMatch(/^M50 0 .* 50 100$/);
  });

  it('weaves today\'s cloth into the warp: a pick per dictation, newest at the fell', () => {
    renderWithApp(<RailWarp />, NOON);
    const cloth = document.querySelector('.rail-warp[aria-hidden="true"] svg.rail-cloth')!;
    expect(cloth).toHaveAttribute('focusable', 'false');
    const rows = [...cloth.querySelectorAll('.rail-cloth__row')];
    expect(rows).toHaveLength(6);
    expect(cloth.querySelectorAll('[data-newest]')).toHaveLength(1);
    expect(rows.at(-1)).toHaveAttribute('data-newest');
    // Plain weave: each pick passes over alternate warp threads.
    expect(rows.map((row) => row.querySelectorAll('.rail-cloth__over').length)).toEqual([3, 4, 3, 4, 3, 4]);
    const failed = cloth.querySelectorAll('.rail-cloth__row[data-status="failed"]');
    expect(failed).toHaveLength(1);
    expect(failed[0].querySelector('.rail-cloth__loose')).not.toBeNull();
    expect(cloth.querySelectorAll('.rail-cloth__loose')).toHaveLength(1);
    // Picks already woven when the rail opens don't replay their weave-in.
    expect(cloth.querySelector('[data-fresh]')).toBeNull();
  });

  it('beats a new pick in once, and lays no cloth on a fresh day', () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    renderWithApp(<><Probe /><RailWarp /></>, NOON);
    act(() => api!.dispatch({
      record: { createdAt: NOON(), durationSeconds: 4, id: 'synthetic-new', model: null, recoveryExpiresAt: null, status: 'copied', style: 'formal', text: 'Synthetic words.' },
      type: 'append-record',
    }));
    const fresh = document.querySelectorAll('.rail-cloth__row[data-fresh]');
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toHaveAttribute('data-newest');
    expect(fresh[0]).toHaveAttribute('data-status', 'copied');
  });

  it('summarises today in the card name and opens History from it', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, NOON);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const card = screen.getByRole('button', { name: 'Today: 6 dictations, 41 words, 1 loose thread' });
    // The card says the day in words; the rail's cloth below it is the picture.
    expect(rail().querySelectorAll('.rail-warp .rail-cloth__row')).toHaveLength(6);
    expect(rail().querySelector('.rail-cloth__row[data-status="failed"]')).not.toBeNull();
    expect(card).toHaveTextContent('41 words · 1m 42s spoken');
    await user.click(card);
    expect(current()).toBe('History');
  });

  it('shows the shortcut as key caps in the dock and a fresh day plainly', () => {
    let time = NOON();
    let page: 'home' | 'history' = 'history';
    const sidebar = () => (
      <AppProvider clock={() => time}>
        <Sidebar onNavigate={() => {}} onReset={() => {}} screen={page} shortcut="Control+Shift+Space" status="Ready" />
      </AppProvider>
    );
    const { rerender } = render(sidebar());
    expect(rail()).toHaveAttribute('data-phase', 'idle');
    // Two days on, yesterday's dictations are not today's.
    time += 2 * 24 * 60 * 60 * 1000;
    rerender(sidebar());
    expect(document.querySelectorAll('.rail-key .kbd').length).toBe(3);
    // ui-iter-17: Home's stage shows the keys already; the rail doesn't repeat them there.
    page = 'home';
    rerender(sidebar());
    expect(document.querySelector('.rail-key')).toBeNull();
    page = 'history';
    rerender(sidebar());
    const card = screen.getByRole('button', { name: 'Today: no dictations yet' });
    expect(card).toHaveTextContent('Nothing woven yet');
    expect(document.querySelector('.rail-cloth')).toBeNull();
  });
});

describe('reading the cloth (ui-iter-17)', () => {
  const todays = (api: ReturnType<typeof useApp>) => [...api.state.records]
    .filter((record) => new Date(record.createdAt).toDateString() === new Date(NOON()).toDateString())
    .sort((a, b) => a.createdAt - b.createdAt);

  it('hangs a pointed pick\'s words and time above it, inside the hidden warp', () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    renderWithApp(<><Probe /><RailWarp onShow={() => {}} /></>, NOON);
    const hits = [...document.querySelectorAll('.rail-cloth__hit')];
    expect(hits).toHaveLength(6);
    expect(document.querySelector('.rail-cloth__read')).toBeNull();
    const newest = todays(api!).at(-1)!;
    fireEvent.pointerEnter(hits.at(-1)!);
    const read = document.querySelector('.rail-warp[aria-hidden="true"] .rail-cloth__read')!;
    expect(read).toHaveTextContent(newest.text);
    expect(read.querySelector('time')).toHaveAttribute('dateTime', new Date(newest.createdAt).toISOString());
    expect(hits.at(-1)!.closest('.rail-cloth__row')).toHaveAttribute('data-lit');
    fireEvent.pointerLeave(document.querySelector('svg.rail-cloth')!);
    expect(document.querySelector('.rail-cloth__read')).toBeNull();
    expect(document.querySelector('[data-lit]')).toBeNull();
  });

  it('lays no hit lines without somewhere to open them', () => {
    renderWithApp(<RailWarp />, NOON);
    expect(document.querySelectorAll('.rail-cloth__row')).toHaveLength(6);
    expect(document.querySelector('.rail-cloth__hit')).toBeNull();
  });

  it('opens a pressed pick in History, focused on that dictation', async () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    const user = userEvent.setup();
    renderWithApp(<><Probe /><App /></>, NOON);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const oldest = todays(api!)[0];
    fireEvent.click(document.querySelectorAll('.rail-cloth__hit')[0]);
    expect(current()).toBe('History');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-record', oldest.id));
  });
});

describe('today\'s cloth layout (ui-iter-15)', () => {
  const record = (id: string, createdAt: number, durationSeconds = 6, status: DictationRecord['status'] = 'inserted'): DictationRecord =>
    ({ createdAt, durationSeconds, id, model: null, recoveryExpiresAt: null, status, style: 'formal', text: 'Synthetic.' });

  it('weaves oldest first, alternating picks, with the newest passing over the even threads', () => {
    expect(clothLayout([])).toEqual({ height: 0, picks: [] });
    const { picks } = clothLayout([record('c', 3), record('a', 1), record('b', 2)]);
    expect(picks.map((pick) => pick.id)).toEqual(['a', 'b', 'c']);
    expect(picks.map((pick) => pick.over)).toEqual([0, 1, 0]);
    expect(picks.map((pick) => pick.newest)).toEqual([false, false, true]);
    expect(picks[1].y).toBeGreaterThan(picks[0].y);
  });

  it('lays a heavier pick for a longer dictation, within bounds', () => {
    expect(pickHeight(1)).toBeLessThan(pickHeight(20));
    expect(pickHeight(0)).toBe(3);
    expect(pickHeight(600)).toBe(7.5);
  });

  it('beats a busy day tighter so the cloth keeps to its budget', () => {
    const busy = Array.from({ length: 60 }, (_, index) => record(`r${index}`, index, 30));
    const { height, picks } = clothLayout(busy);
    expect(picks).toHaveLength(60);
    expect(height).toBeLessThanOrEqual(180);
    for (const [index, pick] of picks.entries()) {
      if (index) expect(pick.y, pick.id).toBeGreaterThan(picks[index - 1].y);
    }
  });
});

describe('the docked shuttle styles (ui-iter-15)', () => {
  const clothCss = css('rail-cloth.css');

  it('loads after the HUD shuttle and stills its motion under reduced motion', () => {
    expect(css('index.css')).toMatch(/@import "\.\/hud-shuttle\.css";\n@import "\.\/rail-cloth\.css";/);
    const reduced = clothCss.slice(clothCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.rail-cloth__row[data-fresh] :is(.rail-cloth__pick, .rail-cloth__over) { animation: none; }');
    expect(reduced).toContain('.rail-shuttle__braid { animation: none !important; }');
  });

  it('loads the cloth read-out and the outcome tag after the cloth, still under reduced motion (ui-iter-17)', () => {
    expect(css('index.css')).toMatch(/@import "\.\/rail-cloth\.css";\n@import "\.\/rail-tag\.css";/);
    const tagCss = css('rail-tag.css');
    const reduced = tagCss.slice(tagCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.rail-cloth__read { animation: none; }');
    expect(reduced).toContain('.sidebar[data-phase] .rail-key .kbd { transform: none; }');
    // The read-out never takes the pointer from the pick beneath it.
    expect(tagCss).toMatch(/\.rail-cloth__read \{[^}]*pointer-events: none;/);
  });

  it('keeps the shuttle\'s words on solid glass at AA in both themes', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const face = /\.rail-shuttle__face \{[^}]*background: (#[0-9a-f]{6});/.exec(clothCss)![1];
    expect(clothCss).toMatch(/\.rail-shuttle \{[^}]*color: #f6f6f9;/);
    expect(ratio('#f6f6f9', face), 'shuttle label').toBeGreaterThanOrEqual(4.5);
    expect(ratio(/button\.rail-shuttle:disabled \.rail-shuttle__face \{ color: (#[0-9a-f]{6});/.exec(clothCss)![1], face), 'disabled label').toBeGreaterThanOrEqual(4.5);
    const tip = /\.rail-capture__tip \{[^}]*background: (#[0-9a-f]{6});[^}]*color: (#[0-9a-f]{6});/.exec(clothCss)!;
    expect(ratio(tip[2], tip[1]), 'tip').toBeGreaterThanOrEqual(4.5);
    expect(ratio('#b6ff3c', face), 'focus ring').toBeGreaterThanOrEqual(3);
  });
});

describe('warp rail styles', () => {
  const railCss = css('rail.css');
  const loomCss = css('rail-loom.css');
  const block = railCss.slice(railCss.indexOf('.guided-rail {'), railCss.indexOf('}', railCss.indexOf('.guided-rail {')));

  it('wears the dark instrument tokens, aliases included, and stays in view while pages scroll', () => {
    for (const alias of ['accent', 'accent-soft', 'border', 'danger', 'identity', 'muted', 'panel-2', 'text']) {
      expect(block, alias).toMatch(new RegExp(`--${alias}: var\\(--`));
    }
    expect(block).toContain('color-scheme: dark;');
    expect(railCss).toMatch(/\.sidebar \{[^}]*position: sticky;[^}]*top: 0;/);
    expect(css('index.css')).toMatch(/@import "\.\/shell\.css";\n@import "\.\/rail\.css";\n@import "\.\/rail-loom\.css";/);
  });

  it('stills the warp pulses and the status dot under reduced motion', () => {
    const reduced = loomCss.slice(loomCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.rail-warp__pulse { display: none; }');
    expect(reduced).toContain('.sidebar[data-phase] .brand__dot { animation: none; }');
    // At rest nothing moves.
    expect(loomCss).toMatch(/\.rail-warp__pulse \{ opacity: 0;[^}]*\}/);
    expect(loomCss.match(/\.rail-warp__pulse \{[^}]*\}/)![0]).not.toContain('animation');
  });

  it('keeps every rail colour pair at AA, over its glows and the open-page band', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];
    const top = '#17171f';
    const lime = '#b6ff3c';
    // Glows at full strength over the rail gradient's lightest stop.
    const topGlow = mix(lime, top, 0.08);
    const keyGlow = mix(lime, top, 0.16);
    const cyanGlow = mix('#3cf0ff', top, 0.18);
    const navBand = mix(lime, top, 0.14);
    const card = mix('#ffffff', top, 0.055);
    for (const surface of [top, '#0a0a0e', topGlow, keyGlow, cyanGlow, navBand, card]) {
      for (const name of ['fg', 'mut', 'ok', 'info', 'warn', 'err']) {
        expect(ratio(token(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(lime, surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(token('mut-on-nav'), navBand), 'open-page shortcut hint').toBeGreaterThanOrEqual(4.5);
    expect(ratio('#f6f6f9', navBand), 'open-page label').toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('sel-edge'), top), 'selection edge').toBeGreaterThanOrEqual(3);
  });
});
