import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { AppProvider, useApp } from '../../src/app/AppContext';
import { RailWarp, warpPath } from '../../src/app/shell/RailWarp';
import { Sidebar } from '../../src/app/shell/Sidebar';
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
    // Every thread starts across the top and lands near the middle of the dock.
    expect(warpPath(-42, 0)).toMatch(/^M8 0 .* 43\.28 100$/);
    expect(warpPath(0, 3)).toMatch(/^M50 0 .* 50 100$/);
  });

  it('summarises today in the card name and opens History from it', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />, NOON);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const card = screen.getByRole('button', { name: 'Today: 6 dictations, 41 words, 1 loose thread' });
    expect(card.querySelectorAll('.rail-today__knot')).toHaveLength(6);
    expect(card.querySelectorAll('.rail-today__knot[data-newest]')).toHaveLength(1);
    expect(card.querySelector('.rail-today__knot[data-status="failed"]')).not.toBeNull();
    expect(card).toHaveTextContent('41 words · 1m 42s spoken');
    await user.click(card);
    expect(current()).toBe('History');
  });

  it('shows the shortcut as key caps in the dock and a fresh day plainly', () => {
    let time = NOON();
    const sidebar = () => (
      <AppProvider clock={() => time}>
        <Sidebar onNavigate={() => {}} onReset={() => {}} screen="home" shortcut="Control+Shift+Space" status="Ready" />
      </AppProvider>
    );
    const { rerender } = render(sidebar());
    expect(rail()).toHaveAttribute('data-phase', 'idle');
    // Two days on, yesterday's dictations are not today's.
    time += 2 * 24 * 60 * 60 * 1000;
    rerender(sidebar());
    expect(document.querySelectorAll('.rail-key .kbd').length).toBe(3);
    const card = screen.getByRole('button', { name: 'Today: no dictations yet' });
    expect(card).toHaveTextContent('Nothing woven yet');
    expect(card.querySelector('.rail-today__weave')).toHaveAttribute('data-empty', 'true');
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
