import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { AppProvider, useApp } from '../../src/app/AppContext';
import { dayFraction } from '../../src/app/shell/RailToday';
import { Sidebar } from '../../src/app/shell/Sidebar';
import { unverifiedDay } from '../../src/dev/ScenarioPanel';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
// Local early afternoon, so the fixture's last hours fall on one local day in any time zone.
const NOON = () => new Date(2026, 10, 26, 14).getTime();
const rail = () => document.querySelector('aside.sidebar')!;
const current = () => within(screen.getByRole('navigation', { name: 'Voxloom screens' }))
  .getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.getAttribute('aria-label');
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

describe('the calm rail (ui-iter-21)', () => {
  it('follows the voice phase on every screen, with a live status line (ui-iter-03)', async () => {
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

  it('keeps only the brand, the pages, the Today beam and a foot: no warp, cloth or shuttle', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, NOON);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    expect(rail().querySelector('.rail-warp, .rail-cloth, .rail-shuttle, .rail-capture')).toBeNull();
    // ui-iter-33: the foot holds one quiet Start, the window's only one, on Home too.
    expect(within(rail().querySelector('.rail-foot') as HTMLElement).getByRole('button', { name: 'Start dictating' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Start dictating' })).toHaveLength(1);
  });

  it('summarises today in the card name, ticks each dictation on the beam and opens History', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, NOON);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const card = screen.getByRole('button', { name: 'Today: 6 dictations, 41 words, 1 loose thread' });
    expect(card).toHaveTextContent('41 words · 1m 42s spoken');
    // The ticks are decoration only, one per dictation, placed by time of day.
    const day = card.querySelector('.rail-today__day')!;
    expect(day).toHaveAttribute('aria-hidden', 'true');
    const ticks = [...day.querySelectorAll('i')];
    expect(ticks).toHaveLength(6);
    expect(day.querySelectorAll('[data-newest]')).toHaveLength(1);
    for (const tick of ticks) expect(Number(tick.style.getPropertyValue('--at'))).toBeGreaterThan(0.45);
    await user.click(card);
    expect(current()).toBe('History');
  });

  it('stays quiet on a day where nothing could be confirmed: one dye, a muted count', () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    renderWithApp(<><Probe /><Sidebar onNavigate={() => {}} onReset={() => {}} screen="history" shortcut="Control+Shift+Space" status="Ready" /></>, NOON);
    act(() => unverifiedDay(NOON()).forEach((record) => api!.dispatch({ record, type: 'append-record' })));
    const card = screen.getByRole('button', { name: /^Today: 44 dictations, .* 39 loose threads$/ });
    const ticks = card.querySelectorAll('.rail-today__day i');
    expect(ticks).toHaveLength(44);
    // No tick says its outcome; the count alone points at History.
    for (const tick of ticks) expect([...tick.attributes].map((a) => a.name)).not.toContain('data-status');
    expect(card.querySelector('.rail-today__loose')).toHaveTextContent('39 loose threads');
    expect(card.querySelector('.rail-today__loose svg.rail-today__knot')).toHaveAttribute('aria-hidden', 'true');
    const loomCss = css('rail-loom.css');
    expect(loomCss).not.toMatch(/rail-today__day[^{]*data-status/);
    expect(loomCss).toMatch(/\.rail-today__loose \{[^}]*color: var\(--mut\);/);
  });

  it('places a moment through its local day', () => {
    const day = new Date(2026, 10, 26).getTime();
    expect(dayFraction(day)).toBe(0);
    expect(dayFraction(new Date(2026, 10, 26, 12).getTime())).toBeCloseTo(0.5, 1);
    expect(dayFraction(new Date(2026, 10, 26, 23, 59).getTime())).toBeLessThanOrEqual(1);
  });

  it('shows the shortcut as key caps off Home and a fresh day plainly', () => {
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
    expect(document.querySelector('.rail-today__day')).toBeNull();
  });
});

describe('the rail foot styles (ui-iter-33; the stage capsule until then)', () => {
  const footCss = css('rail-foot.css');
  const railTokens = css('rail.css');
  const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(railTokens)![1];

  it('loads the loom after the pick, and the foot after the run tag it wears', () => {
    const index = css('index.css');
    expect(index).toMatch(/@import "\.\/home-pick\.css";\n@import "\.\/loom-bar\.css";/);
    expect(index).toMatch(/@import "\.\/hud-meter\.css";\n@import "\.\/run-tag\.css";\n@import "\.\/rail-foot\.css";/);
    expect(index).not.toMatch(/rail-cloth|rail-tag/);
    expect(css('loom-bar.css')).not.toMatch(/\.dictate|rail-start/);
  });

  it('holds the caps still and stops fading under reduced motion', () => {
    const reduced = footCss.slice(footCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.sidebar[data-phase] .rail-key .kbd { transform: none; }');
    expect(reduced).toMatch(/\.rail-start__button,\s*\.rail-start__tip \{ transition: none; \}/);
    const loomCss = css('rail-loom.css');
    const railReduced = loomCss.slice(loomCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(railReduced).toContain('.sidebar[data-phase] .brand__dot { animation: none; }');
    expect(loomCss).not.toMatch(/\.rail-(key|run|foot|start)/);
  });

  it('gives each key cap room and centres its glyph beside "Hold"', () => {
    const cap = /\.rail-key \.kbd \{([^}]*)\}/.exec(footCss)![1];
    for (const rule of ['align-items: center;', 'display: inline-flex;', 'justify-content: center;', 'height: 22px;', 'min-width: 22px;', 'padding: 0 7px;', 'white-space: nowrap;', 'margin-bottom: 2px;']) {
      expect(cap, rule).toContain(rule);
    }
    expect(footCss).toMatch(/\.rail-key__hold \{ align-items: center; display: flex; flex-wrap: wrap; gap: var\(--s-3\) 7px;/);
  });

  it('keeps Start, its note and its tip at AA, with a visible focus ring', () => {
    for (const ground of ['#17171f', '#0a0a0e']) {
      expect(ratio(token('mut'), ground), `muted on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(footCss).toMatch(/\.rail-start__button \{[^}]*color: var\(--mut\);/);
    expect(footCss).toMatch(/\.rail-start__button:disabled \{[^}]*color: var\(--mut\);[^}]*opacity: 1;/);
    expect(footCss).toMatch(/\.rail-start__note \{ color: var\(--mut\);/);
    const tip = /\.rail-start__tip \{[^}]*background: (#[0-9a-f]{6});[^}]*color: (#[0-9a-f]{6});/.exec(footCss)!;
    expect(ratio(tip[2], tip[1]), 'tip').toBeGreaterThanOrEqual(4.5);
    expect(footCss).toContain('.rail-start__button:focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }');
  });
});

describe('rail styles', () => {
  const railCss = css('rail.css');
  const block = railCss.slice(railCss.indexOf('.guided-rail {'), railCss.indexOf('}', railCss.indexOf('.guided-rail {')));

  it('wears the dark instrument tokens, aliases included, and stays in view while pages scroll', () => {
    for (const alias of ['accent', 'accent-soft', 'border', 'danger', 'identity', 'muted', 'panel-2', 'text']) {
      expect(block, alias).toMatch(new RegExp(`--${alias}: var\\(--`));
    }
    expect(block).toContain('color-scheme: dark;');
    expect(railCss).toMatch(/\.sidebar \{[^}]*position: sticky;[^}]*top: 0;/);
    expect(css('index.css')).toMatch(/@import "\.\/shell\.css";\n@import "\.\/rail\.css";\n@import "\.\/rail-loom\.css";/);
  });

  it('keeps every rail colour pair at AA, over its glows and the open-page band', () => {
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
