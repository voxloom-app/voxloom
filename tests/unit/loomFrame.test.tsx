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

/** The page's direct children, by their first class: the stage (beam) first, then the open page. */
const layers = (page: Element) => [...page.children].map((child) => child.classList[0]);

describe('The loom frame (ui-iter-08): each page is a beam on the frame, and the page lies open under it (ui-iter-31)', () => {
  it('Home: the voice stage is the beam; earlier dictations hang under it on the open page (ui-iter-29)', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const home = document.querySelector('.home')!;
    // No sheet between your last words and the earlier ones.
    expect(layers(home)).toEqual(['stage', 'home-page']);
    expect(home.querySelector('.cloth')).toBeNull();
    expect(home.querySelector('.home-page #recent-title')).toHaveTextContent('Earlier dictations');
    expect(home.querySelector('.stage .recent-list')).toBeNull();
  });

  it('History: the masthead is the beam; search, filters and the timeline lie open under it', () => {
    renderWithApp(<History onToast={vi.fn()} />);
    const history = document.querySelector('.history')!;
    expect(layers(history)).toEqual(['stage', 'page-body']);
    expect(history.querySelector('.cloth')).toBeNull();
    const page = history.querySelector(':scope > .page-body')!;
    expect(within(page as HTMLElement).getByRole('searchbox', { name: 'Search history' })).toBeInTheDocument();
    expect(page.querySelector('.history-timeline')).not.toBeNull();
    expect(history.querySelector('.stage .history-timeline')).toBeNull();
  });

  it('Dictionary: index and specimen lie open as two leaves; the dialog stays outside the page', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    const dictionary = document.querySelector('.dictionary')!;
    expect(layers(dictionary)).toEqual(['stage', 'page-body']);
    expect(dictionary.querySelector('.cloth')).toBeNull();
    const page = dictionary.querySelector(':scope > .page-body') as HTMLElement;
    expect(page).toHaveClass('dictionary-book');
    expect(within(page).getByRole('list', { name: 'Dictionary words, alphabetical' })).toBeInTheDocument();
    expect(within(page).getByRole('region', { name: 'Saved spelling specimen' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add term' }));
    expect(page.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Settings: the voice path is the beam and the tab panel lies open under it, in-page and in its own window', () => {
    const { unmount } = renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(layers(document.querySelector('.settings-window')!)).toEqual(['settings-window__bar', 'settings-panel']);
    unmount();
    render(<AppProvider clock={() => 1_800_000_000_000}><SettingsWindowApp /></AppProvider>);
    expect(document.querySelector('.settings-window-root > .settings-window > .settings-panel')).not.toBeNull();
  });

  it('keeps the rail before main, carrying the dictation phase, with no toolbar across the pages', async () => {
    const user = userEvent.setup();
    renderWithApp(<App />);
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    const shell = document.getElementById('app-shell')!;
    // ui-iter-27: no toolbar crosses the pages; the rail carries Recall, Settings and Help.
    expect(layers(shell)).toEqual(['sidebar', 'main']);
    expect(shell.querySelector('.sidebar')).toHaveAttribute('data-phase', 'idle');
  });
});

describe('frame.css', () => {
  it('loads after the layout scale (it replaces the centred card column) and before the responsive overrides', () => {
    expect(css('index.css')).toMatch(/@import "\.\/scale-layout\.css";\n@import "\.\/frame\.css";\n@import "\.\/responsive\.css";/);
    expect(frame).toMatch(/\.main,\n\.settings-window-root \{[^}]*margin: 0;[^}]*max-width: none;/);
  });

  it('lays every page open: no raised sheet, reed or fell, and no motion of its own (ui-iter-31)', () => {
    const open = frame.slice(frame.indexOf('.main .page-body,'), frame.indexOf('\n}\n', frame.indexOf('.main .page-body,')));
    expect(open).toContain(':is(.main, .settings-window-root) .settings-window > .settings-panel,');
    expect(open).toContain(':is(.main, .settings-window-root) > section[aria-busy] > .boot-loading {');
    for (const sheet of ['background:', 'box-shadow:', 'border-radius:']) expect(open).not.toContain(sheet);
    // The reed's travelling light and the lit fell are gone everywhere, in both themes.
    for (const source of [frame, css('daylight.css'), css('daylight-pages.css')]) {
      expect(source).not.toMatch(/\.cloth\b/);
      expect(source).not.toMatch(/reed-pass|--reed-light/);
      expect(source).not.toMatch(/:is\(\.main \.page-body[^{]*::(before|after)/);
    }
    // Settings' dropped thread lands on the pane's top rule instead of the fell.
    expect(frame).toContain(':is(.main, .settings-window-root) .settings-window > .settings-panel { border-top: 1px solid var(--line); padding-top: var(--s-10); }');
  });

  it('gives History, Dictionary and Settings the same quiet running head (ui-iter-31)', () => {
    // The rail already names the page, so no page title shouts over its content.
    const heads = {
      history: css('history-stage.css').match(/\.history-stage h1 \{([^}]*)\}/)![1],
      dictionary: css('dictionary-stage.css').match(/\.dictionary-stage h1 \{([^}]*)\}/)![1],
      settings: css('settings-path.css').match(/\.settings-window__bar\.stage h1 \{([^}]*)\}/)![1],
    };
    for (const [page, rule] of Object.entries(heads)) {
      expect(rule, page).toContain('font-size: var(--fs-section);');
      expect(rule, page).toContain('font-weight: 700;');
    }
    expect(css('history-stage.css')).toMatch(/\.history-stage__title \{ align-items: baseline;/);
    expect(css('dictionary-stage.css')).toMatch(/\.dictionary-stage__title \{ align-items: baseline;/);
  });

  it('keeps every frame and open-page colour pair at AA', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const pick = (block: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];

    // Frame text (notices, boot title) over the frame's lightest and darkest stops and the notice tints.
    const frameStart = frame.indexOf('/* Frame surfaces outside a stage');
    const frameBlock = frame.slice(frameStart, frame.indexOf('\n}\n', frameStart));
    expect(frameBlock).toContain('color-scheme: dark;');
    expect(frameBlock).toContain('--focus: var(--brand-a);');
    const top = '#17171f';
    const bottom = '#0a0a0e';
    const frameSurfaces = [top, bottom, mix(pick(frameBlock, 'info'), top, 0.09), mix(pick(frameBlock, 'err'), top, 0.11)];
    for (const surface of frameSurfaces) {
      for (const name of ['fg', 'mut', 'info', 'err']) {
        expect(ratio(pick(frameBlock, name), surface), `frame ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio('#b6ff3c', surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // A bordered control on the frame keeps its ring (notice actions are borderless ghosts).
    for (const surface of [top, bottom]) {
      expect(ratio(pick(frameBlock, 'ctl-line'), surface), `help button ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }

    // The open page keeps the old sheet's surface pair for rows, panels and knots, and its text now
    // sits straight on the frame's stops, so the night tokens must hold on all four surfaces.
    const tokens = css('tokens.css');
    const dark = tokens.slice(0, tokens.indexOf('[data-appearance-resolved="light"]'));
    const open = frame.slice(frame.indexOf('.main .page-body,'));
    expect([pick(open, 'bg'), pick(open, 'panel')]).toEqual(['#121219', '#1a1a23']);
    for (const surface of [pick(open, 'bg'), pick(open, 'panel'), top, bottom]) {
      for (const name of ['fg', 'mut', 'accfg', 'ok', 'info', 'warn', 'err']) {
        expect(ratio(pick(dark, name), surface), `${name} on open page ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of ['ctl-line', 'sel-edge']) {
        expect(ratio(pick(dark, name), surface), `${name} on open page ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
    // By daylight the open pages take the linen tokens (checked in daylightLoom.test) and fill with linen.
    const daylight = css('daylight.css');
    expect(daylight).toMatch(/:is\(\.stage, \.sidebar, [^)]*\.main \.page-body, \.settings-window > \.settings-panel, section\[aria-busy\] > \.boot-loading, \.main \.home-page\) \{/);
    expect(daylight).toContain(':is(.main .page-body, .main .home-page, .settings-window > .settings-panel, section[aria-busy] > .boot-loading) { --bg: var(--linen); }');
  });
});
