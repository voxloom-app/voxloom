import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { Dictionary } from '../../src/features/dictionary/Dictionary';
import { History } from '../../src/features/history/History';
import { Home } from '../../src/features/home/Home';
import { Settings } from '../../src/features/settings/Settings';
import { SettingsWindowApp } from '../../src/settings/SettingsWindowApp';
import { AppProvider } from '../../src/app/AppContext';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const frame = css('frame.css');

const dogfood = (): UseDogfoodCaptureResult => ({
  cancel: vi.fn(), captureState: { kind: 'idle' }, hudResult: null, intendedTarget: null, message: null,
  origin: null, phase: 'idle', scopeReady: false, hudReady: false, start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined), transcript: null,
});

/** The page's direct children, by their first class: the stage (beam) first, then the cloth. */
const layers = (page: Element) => [...page.children].map((child) => child.classList[0]);

describe('The loom frame (ui-iter-08): each page is a beam on the frame and a sheet of cloth', () => {
  it('Home: the voice stage is the beam; recent dictations lie on the cloth', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const home = document.querySelector('.home')!;
    expect(layers(home)).toEqual(['stage', 'cloth']);
    expect(home.querySelector('.cloth #recent-title')).toHaveTextContent('Recent dictations');
    expect(home.querySelector('.stage .recent-list')).toBeNull();
  });

  it('History: the masthead is the beam; search, filters and the timeline lie on the cloth', () => {
    renderWithApp(<History onToast={vi.fn()} />);
    const history = document.querySelector('.history')!;
    expect(layers(history)).toEqual(['stage', 'cloth']);
    const cloth = history.querySelector(':scope > .cloth')!;
    expect(within(cloth as HTMLElement).getByRole('searchbox', { name: 'Search history' })).toBeInTheDocument();
    expect(cloth.querySelector('.history-timeline')).not.toBeNull();
    expect(history.querySelector('.stage .history-timeline')).toBeNull();
  });

  it('Dictionary: the proof is the beam; the word list lies on the cloth and the dialog stays outside it', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    const dictionary = document.querySelector('.dictionary')!;
    expect(layers(dictionary)).toEqual(['stage', 'cloth']);
    const cloth = dictionary.querySelector(':scope > .cloth') as HTMLElement;
    expect(within(cloth).getByRole('list', { name: 'Dictionary words, alphabetical' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add term' }));
    expect(cloth.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Settings: the voice path is the beam and the tab panel is the cloth, in-page and in its own window', () => {
    const { unmount } = renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(layers(document.querySelector('.settings-window')!)).toEqual(['settings-window__bar', 'settings-panel']);
    unmount();
    render(<AppProvider clock={() => 1_800_000_000_000}><SettingsWindowApp /></AppProvider>);
    expect(document.querySelector('.settings-window-root > .settings-window > .settings-panel')).not.toBeNull();
  });

  it('keeps the rail before main, so the reed can follow the dictation phase on every page', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const shell = document.getElementById('app-shell')!;
    expect(layers(shell)).toEqual(['titlebar', 'sidebar', 'main']);
    expect(shell.querySelector('.sidebar')).toHaveAttribute('data-phase', 'idle');
    expect(frame).toContain('.sidebar:is([data-phase="listening"], [data-phase="speaking"]) ~ .main :is(.cloth, .settings-panel)::before');
    expect(frame).toContain('.sidebar[data-phase="processing"] ~ .main :is(.cloth, .settings-panel)::before');
  });
});

describe('frame.css', () => {
  it('loads after the layout scale (it replaces the centred card column) and before the responsive overrides', () => {
    expect(css('index.css')).toMatch(/@import "\.\/scale-layout\.css";\n@import "\.\/frame\.css";\n@import "\.\/responsive\.css";/);
    expect(frame).toMatch(/\.main,\n\.settings-window-root \{[^}]*margin: 0;[^}]*max-width: none;/);
  });

  it('stills the reed’s travelling light under reduced motion', () => {
    const reduced = frame.slice(frame.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain(':is(.main .cloth, .settings-window > .settings-panel)::before { animation: none !important; }');
    // The light is parked off the reed until a phase runs it.
    expect(frame).toContain('animation: reed-pass 1.6s linear infinite paused;');
  });

  it('keeps every frame and cloth colour pair at AA', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const pick = (block: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];

    // Frame text (toolbar, notices, boot title) over the frame's lightest and darkest stops and the notice tints.
    const frameBlock = frame.slice(frame.indexOf('.titlebar,'), frame.indexOf('.titlebar {'));
    expect(frameBlock).toContain('color-scheme: dark;');
    expect(frameBlock).toContain('--focus: var(--brand-a);');
    const top = '#17171f';
    const frameSurfaces = [top, '#0a0a0e', mix(pick(frameBlock, 'info'), top, 0.09), mix(pick(frameBlock, 'err'), top, 0.11)];
    for (const surface of frameSurfaces) {
      for (const name of ['fg', 'mut', 'info', 'err']) {
        expect(ratio(pick(frameBlock, name), surface), `frame ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio('#b6ff3c', surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // The toolbar's bordered Help button sits on the frame itself (notice actions are borderless ghosts).
    for (const surface of [top, '#0a0a0e']) {
      expect(ratio(pick(frameBlock, 'ctl-line'), surface), `help button ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }

    // The cloth swaps the page and panel surfaces: both stay surfaces the theme tokens were tuned for.
    const tokens = css('tokens.css');
    const dark = tokens.slice(0, tokens.indexOf('[data-appearance-resolved="light"]'));
    const light = tokens.slice(tokens.indexOf('[data-appearance-resolved="light"]'));
    const darkCloth = frame.slice(frame.indexOf('.main .cloth,'));
    const lightCloth = frame.slice(frame.indexOf('[data-appearance-resolved="light"] :is(.main .cloth'));
    const cloths = [
      { theme: dark, surfaces: [pick(darkCloth, 'bg'), pick(darkCloth, 'panel')], expected: ['#121219', '#1a1a23'] },
      { theme: light, surfaces: [pick(lightCloth, 'bg'), pick(lightCloth, 'panel')], expected: ['#ffffff', '#f7f9fb'] },
    ];
    for (const { theme, surfaces, expected } of cloths) {
      expect(surfaces).toEqual(expected);
      for (const surface of surfaces) {
        for (const name of ['fg', 'mut', 'accfg', 'ok', 'info', 'warn', 'err']) {
          expect(ratio(pick(theme, name), surface), `${name} on cloth ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const name of ['ctl-line', 'sel-edge']) {
          expect(ratio(pick(theme, name), surface), `${name} on cloth ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // The light cloth reads as a sheet against the frame.
    expect(ratio('#ffffff', '#0a0a0e')).toBeGreaterThan(15);
  });
});
