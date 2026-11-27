import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { spokenCombo } from '../../src/components/KeyCombo';
import { initialSettings } from '../../src/domain/fixtures';
import { Settings } from '../../src/features/settings/Settings';
import { appearanceStop, speechModel, voicePathStops } from '../../src/features/settings/pathStops';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const path = () => screen.getByRole('tablist', { name: 'Settings sections' });
const stops = () => within(path()).getAllByRole('tab');
const tied = () => [...path().querySelectorAll('li[data-current]')].map((li) => li.getAttribute('data-stop'));

describe('voice path stops (ui-iter-04)', () => {
  it('lists the six stops in the order a dictation passes them, from saved settings only', () => {
    const path = voicePathStops(initialSettings, true, true);
    expect(path.map((s) => s.id)).toEqual(['shortcut', 'microphone', 'speech', 'cleanup', 'output', 'transcripts']);
    expect(path.map((s) => [s.value, s.detail])).toEqual([
      ['Ctrl + Shift + Space', 'Hold to dictate'],
      ['System default', 'Input device'],
      ['Whisper Base', 'English · local'],
      ['Off', 'Formal when on'],
      ['Insert', 'Falls back to Copy'],
      ['Kept 30 days', 'On this Mac'],
    ]);
    // Every accessible name starts with the visible label.
    expect(path.map((s) => s.name)).toEqual([
      `Shortcut: ${spokenCombo('Ctrl + Shift + Space', true)}. Hold to dictate`,
      'Microphone: System default',
      'Speech: Whisper Base, English · local',
      'Cleanup: off, Formal when on',
      'Output: insert, falls back to copy',
      'Transcripts: kept 30 days, on this mac',
    ]);
  });

  it('follows each setting a stop summarises', () => {
    const path = voicePathStops({
      ...initialSettings,
      cleanupOptIn: true,
      clipboardFallback: false,
      microphone: 'usb-input',
      shortcut: '',
      style: 'very-casual',
      transcriptRetention: 'off',
    }, false, true);
    const byId = Object.fromEntries(path.map((s) => [s.id, s]));
    expect(byId.shortcut).toMatchObject({ detail: 'Not active', name: 'Shortcut: none. Not active', value: 'None' });
    expect(byId.microphone.value).toBe('Chosen microphone');
    expect(byId.cleanup).toMatchObject({ detail: 'Very Casual style', value: 'On' });
    expect(byId.output.detail).toBe('No clipboard fallback');
    expect(byId.transcripts).toMatchObject({ detail: 'Last one stays on Home', value: 'Not kept' });
    expect(speechModel('whisper-base.en')).toEqual({ language: 'English', name: 'Whisper Base' });
  });

  it('adds Appearance off the path, summarising the look and the text size', () => {
    expect(appearanceStop(initialSettings)).toEqual({
      detail: 'Default text', id: 'appearance', label: 'Appearance', name: 'Appearance: follow system, default text', value: 'System',
    });
    expect(appearanceStop({ ...initialSettings, appearance: 'dark', textSize: 'large' }))
      .toMatchObject({ detail: 'Large text', name: 'Appearance: dark, large text', value: 'Dark' });
  });
});

describe('voice path in Settings: the stops are the tabs (ui-iter-13)', () => {
  it('draws one tab per stop plus Appearance, and ties only the open stop', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(stops().map((b) => b.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['Shortcut', 'Microphone', 'Speech', 'Cleanup', 'Output', 'Transcripts', 'Appearance']);
    expect(tied()).toEqual(['shortcut']);
    expect(path().querySelectorAll('.voice-path__thread[aria-hidden="true"]')).toHaveLength(7);
    expect(path().querySelector('li[data-off-path]')).toHaveAttribute('data-stop', 'appearance');
    expect(screen.queryByRole('navigation', { name: 'Voice path' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^Appearance:/ }));
    expect(tied()).toEqual(['appearance']);
  });

  it('opens a stop’s pane, and changing the setting there updates the stop', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /^Output:/ }));
    expect(tied()).toEqual(['output']);
    const panel = screen.getByRole('tabpanel', { name: /^Output:/ });
    expect(panel).toHaveAttribute('data-pane', 'output');
    expect(panel).toHaveTextContent('Stop 5 of 6');
    expect(panel).toHaveTextContent('never presses Return or Send');
    await user.click(within(panel).getByRole('switch', { name: 'Clipboard fallback' }));
    expect(screen.getByRole('tab', { name: 'Output: insert, no clipboard fallback' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Transcripts opens retention and recovery; Speech opens the model list', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /^Transcripts:/ }));
    expect(tied()).toEqual(['transcripts']);
    expect(screen.getByRole('radiogroup', { name: 'Transcript retention' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Speech:/ }));
    expect(await screen.findByText('whisper-base.en')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });

  it('names the native window after the open pane', async () => {
    const onTabTitle = vi.fn();
    renderWithApp(<Settings onSetup={vi.fn()} onTabTitle={onTabTitle} />);
    expect(onTabTitle).toHaveBeenLastCalledWith('Shortcut');
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Transcripts:/ }));
    expect(onTabTitle).toHaveBeenLastCalledWith('Transcripts & privacy');
  });
});

describe('voice path styles', () => {
  const pathCss = css('settings-path.css');

  it('puts the Settings header on the stage material in both themes', () => {
    expect(pathCss).toMatch(/\.settings-window__bar\.stage \{[^}]*linear-gradient\(180deg, #17171f, #0a0a0e\);/);
    expect(css('index.css')).toMatch(/@import "\.\/settings\.css";\n@import "\.\/settings-path\.css";/);
  });

  it('keeps the pulse dark at rest and stills it under reduced motion', () => {
    const pulse = pathCss.slice(pathCss.indexOf('.voice-path__thread::after {\n  animation'));
    expect(pulse.slice(0, pulse.indexOf('}'))).toContain('opacity: 0;');
    const reduced = pathCss.slice(pathCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.voice-path__thread::after { animation: none; display: none; }');
    expect(reduced).toContain('.voice-path__thread i { transition: none; }');
    // The landing mark went with ui-iter-13: a stop opens its pane instead.
    expect(pathCss).not.toContain('data-landed');
  });

  it('drops the open stop’s thread into its pane, and holds it still under reduced motion', () => {
    const panes = css('settings-panes.css');
    expect(css('index.css')).toMatch(/@import "\.\/settings-path\.css";\n@import "\.\/settings-panes\.css";/);
    // The bar has to let the thread hang past it, over the cloth's fell.
    expect(panes).toMatch(/\.settings-window__bar\.stage \{ overflow: visible; z-index: 1; \}/);
    expect(panes).toMatch(/\.voice-path li\[data-current\] > \.voice-path__stop::after \{[^}]*animation: pane-drop/);
    expect(panes).toMatch(/\.voice-path li\[data-current\] > \.voice-path__stop \{[^}]*inset 0 -2px 0 var\(--knot\)/);
    const reduced = panes.slice(panes.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.voice-path li[data-current] > .voice-path__stop::after { animation: none; }');
    expect(reduced).toContain('.settings-pane__head { animation: none; }');
    expect(panes.split('\n').length).toBeLessThan(200);
  });

  it('keeps path text at AA over the stage, its glows, a hovered stop and a tied knot', () => {
    const stage = css('stage.css');
    const block = stage.slice(stage.indexOf('.stage {'), stage.indexOf('}', stage.indexOf('.stage {')));
    const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const top = '#17171f';
    const lime = '#b6ff3c';
    // The stage's side glows at full strength (18% × .5 lime, 16% × .55 cyan).
    const limeGlow = mix(lime, top, 0.09);
    const cyanGlow = mix('#3cf0ff', top, 0.088);
    const hover = mix('#ffffff', limeGlow, 0.04);
    // The open stop's plate at its brightest (hovered: 10% white).
    const plate = mix('#ffffff', limeGlow, 0.1);
    for (const surface of [top, '#0a0a0e', limeGlow, cyanGlow, hover, plate]) {
      expect(ratio(token('fg'), surface), `value on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('mut'), surface), `label/detail on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(lime, surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // A tied stop's label turns --fg, so it holds even inside the knot's halo.
    expect(pathCss).toContain('.voice-path li[data-current] .voice-path__label { color: var(--fg); }');
    expect(ratio(token('fg'), mix(lime, limeGlow, 0.2)), 'tied label').toBeGreaterThanOrEqual(4.5);
    // The plate's edge (the stop's thread colour, lime to cyan; --fg off the path) marks the open stop at 3:1.
    for (const edge of [lime, mix(lime, '#3cf0ff', 0.5), '#3cf0ff', token('fg')]) {
      expect(ratio(edge, plate), `open stop edge ${edge}`).toBeGreaterThanOrEqual(3);
    }
    // Key caps, live and inactive.
    expect(ratio('#f6f6f9', '#32323f'), 'key cap').toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('mut'), '#32323f'), 'inactive key cap').toBeGreaterThanOrEqual(4.5);
  });
});
