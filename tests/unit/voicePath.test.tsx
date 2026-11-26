import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spokenCombo } from '../../src/components/KeyCombo';
import { initialSettings } from '../../src/domain/fixtures';
import { Settings } from '../../src/features/settings/Settings';
import { speechModel, voicePathStops } from '../../src/features/settings/pathStops';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const path = () => screen.getByRole('navigation', { name: 'Voice path' });
const stops = () => within(path()).getAllByRole('button');
const tied = () => [...path().querySelectorAll('li[data-current]')].map((li) => li.getAttribute('data-stop'));

afterEach(() => { vi.useRealTimers(); });

describe('voice path stops (ui-iter-04)', () => {
  it('lists the six stops in the order a dictation passes them, from saved settings only', () => {
    const path = voicePathStops(initialSettings, true, true);
    expect(path.map((s) => s.id)).toEqual(['shortcut', 'microphone', 'speech', 'cleanup', 'output', 'transcripts']);
    expect(path.map((s) => s.tab)).toEqual(['capture', 'capture', 'models', 'capture', 'capture', 'privacy']);
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
});

describe('voice path in Settings', () => {
  it('draws one stop button per stop and ties the open tab’s stops', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(stops().map((b) => b.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['Shortcut', 'Microphone', 'Speech', 'Cleanup', 'Output', 'Transcripts']);
    expect(tied()).toEqual(['shortcut', 'microphone', 'cleanup', 'output']);
    expect(path().querySelectorAll('.voice-path__thread[aria-hidden="true"]')).toHaveLength(6);
    await user.click(screen.getByRole('tab', { name: 'Appearance' }));
    expect(tied()).toEqual([]);
    // The settings tabs keep their own names and roles.
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
  });

  it('lands on the control a stop names: row marked, control focused', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^Output:/ }));
    const fallback = screen.getByRole('switch', { name: 'Clipboard fallback' });
    expect(fallback).toHaveFocus();
    expect(fallback.closest('.frow')).toHaveAttribute('data-landed');
    // Changing the setting there updates the stop.
    await user.click(fallback);
    expect(screen.getByRole('button', { name: 'Output: insert, no clipboard fallback' })).toBeInTheDocument();
  });

  it('switches to the owning tab first: Transcripts opens Privacy on the checked option', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^Transcripts:/ }));
    expect(screen.getByRole('tab', { name: 'Privacy' })).toHaveAttribute('aria-selected', 'true');
    expect(tied()).toEqual(['transcripts']);
    const retention = screen.getByRole('radiogroup', { name: 'Transcript retention' });
    expect(within(retention).getByRole('radio', { name: '30 days' })).toHaveFocus();
    expect(retention.closest('.frow')).toHaveAttribute('data-landed');
  });

  it('waits for the model list before landing on the selected speech model', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^Speech:/ }));
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.querySelector('.stt-model-row[data-landed]')).not.toBeNull());
    const landed = document.querySelector<HTMLElement>('.stt-model-row[data-landed]')!;
    expect(landed.contains(document.activeElement)).toBe(true);
  });

  it('lets the landing mark fade, so only the selvedge of the focused row stays', () => {
    vi.useFakeTimers();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cleanup:/ }));
    const row = document.querySelector('[data-path-stop="cleanup"]')!;
    expect(row).toHaveAttribute('data-landed');
    act(() => { vi.advanceTimersByTime(2400); });
    expect(row).not.toHaveAttribute('data-landed');
  });
});

describe('voice path styles', () => {
  const pathCss = css('settings-path.css');

  it('puts the Settings header on the stage material in both themes', () => {
    expect(pathCss).toMatch(/\.settings-window__bar\.stage \{[^}]*linear-gradient\(180deg, #17171f, #0a0a0e\);/);
    expect(css('index.css')).toMatch(/@import "\.\/settings\.css";\n@import "\.\/settings-path\.css";/);
  });

  it('keeps the pulse dark at rest and stills it and the landing tint under reduced motion', () => {
    const pulse = pathCss.slice(pathCss.indexOf('.voice-path__thread::after {\n  animation'));
    expect(pulse.slice(0, pulse.indexOf('}'))).toContain('opacity: 0;');
    const reduced = pathCss.slice(pathCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.voice-path__thread::after { animation: none; display: none; }');
    expect(reduced).toContain('.settings-panel [data-landed] { animation: none; }');
    expect(reduced).toContain('.voice-path__thread i { transition: none; }');
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
    for (const surface of [top, '#0a0a0e', limeGlow, cyanGlow, hover]) {
      expect(ratio(token('fg'), surface), `value on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('mut'), surface), `label/detail on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(lime, surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    // A tied stop's label turns --fg, so it holds even inside the knot's halo.
    expect(pathCss).toContain('.voice-path li[data-current] .voice-path__label { color: var(--fg); }');
    expect(ratio(token('fg'), mix(lime, limeGlow, 0.2)), 'tied label').toBeGreaterThanOrEqual(4.5);
    // Key caps, live and inactive.
    expect(ratio('#f6f6f9', '#32323f'), 'key cap').toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('mut'), '#32323f'), 'inactive key cap').toBeGreaterThanOrEqual(4.5);
  });
});
