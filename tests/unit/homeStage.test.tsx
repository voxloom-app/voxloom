import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import type { DictationState } from '../../src/domain/types';
import { Home } from '../../src/features/home/Home';
import { stageLabel, stagePhase } from '../../src/features/home/stagePhase';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');

const dogfood = (over: Partial<UseDogfoodCaptureResult> = {}): UseDogfoodCaptureResult => ({
  cancel: vi.fn(), captureState: { kind: 'idle' }, hudResult: null, intendedTarget: null, message: null,
  origin: null, phase: 'idle', scopeReady: false, hudReady: false, start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined), transcript: null, ...over,
});

const stage = () => document.querySelector('.home .stage')!;
const ready: DictationState = { kind: 'ready' };

describe('stagePhase (ui-iter-01 voice stage)', () => {
  it('follows real capture first, then the dictation machine, and rests at idle', () => {
    expect(stagePhase('idle', false, ready)).toBe('idle');
    expect(stagePhase('starting', false, ready)).toBe('listening');
    expect(stagePhase('recording', false, ready)).toBe('listening');
    expect(stagePhase('idle', true, ready)).toBe('listening');
    expect(stagePhase('transcribing', false, ready)).toBe('processing');
    expect(stagePhase('cleaning', false, ready)).toBe('processing');
    expect(stagePhase('idle', false, { kind: 'listening', runId: 1, waveform: 'silent' })).toBe('listening');
    expect(stagePhase('idle', false, { kind: 'listening', runId: 1, waveform: 'speaking' })).toBe('speaking');
    expect(stagePhase('idle', false, { completion: 'held', kind: 'processing', runId: 1 })).toBe('processing');
    expect(stagePhase('recording', false, { completion: 'held', kind: 'processing', runId: 1 })).toBe('listening');
    for (const done of ['success', 'error', 'cancelled'] as const) {
      expect(stagePhase(done, false, ready), done).toBe('idle');
    }
    expect(stagePhase('idle', false, { kind: 'success', recordId: 'r', runId: 1 })).toBe('idle');
    expect(stagePhase('idle', false, { kind: 'error', recordId: 'r', runId: 1 })).toBe('idle');
  });

  it('labels the mic readout', () => {
    expect(stageLabel('idle', 'idle')).toBe('Mic off');
    expect(stageLabel('listening', 'recording')).toBe('Listening');
    expect(stageLabel('speaking', 'idle')).toBe('Listening');
    expect(stageLabel('processing', 'transcribing')).toBe('Transcribing');
    expect(stageLabel('processing', 'cleaning')).toBe('Cleaning up');
  });
});

describe('Home voice stage', () => {
  it('holds the hero and the Dictate deck, with model and output in the readout', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'idle');
    expect(stage().querySelector('#home-title')).not.toBeNull();
    expect(stage().querySelector('#capture-title')).toHaveTextContent('Dictate');
    expect(stage().querySelector('.stage__mic')).toHaveTextContent('Mic off');
    const readout = stage().querySelector('.stage__meta')!;
    expect([...readout.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Model', 'Output']);
    expect([...readout.querySelectorAll('dd')].map((detail) => detail.textContent))
      .toEqual(['whisper-base.en', 'Insert, fall back to Copy']);
    // The recent list stays outside the stage.
    expect(stage().querySelector('.recent-list')).toBeNull();
  });

  it('draws the loom as decoration only: hidden, unfocusable, seven threads in and out', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const loom = stage().querySelector('svg.loom')!;
    expect(loom).toHaveAttribute('aria-hidden', 'true');
    expect(loom).toHaveAttribute('focusable', 'false');
    expect(loom.querySelectorAll('.loom__side--in .loom__pulse')).toHaveLength(7);
    expect(loom.querySelectorAll('.loom__side--out .loom__pulse')).toHaveLength(7);
    expect(loom.querySelectorAll('.loom__warp')).toHaveLength(14);
    expect(screen.getByRole('heading', { level: 1, name: 'Hold to dictate' })).toBeInTheDocument();
    expect(screen.getByText('Control Shift Space')).toBeInTheDocument();
  });

  it('lights up while capturing and transcribing', () => {
    const { unmount } = renderWithApp(<Home dogfood={dogfood({ phase: 'recording' })} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'listening');
    expect(stage().querySelector('.stage__mic')).toHaveTextContent('Listening');
    unmount();
    renderWithApp(<Home dogfood={dogfood({ phase: 'cleaning' })} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'processing');
    expect(stage().querySelector('.stage__mic')).toHaveTextContent('Cleaning up');
  });

  it('follows the dictation machine (gesture and mock scenarios)', () => {
    let api: ReturnType<typeof useApp> | null = null;
    function Probe() { api = useApp(); return null; }
    renderWithApp(<><Probe /><Home dogfood={dogfood()} onToast={vi.fn()} /></>);
    act(() => api!.dictation.start());
    expect(stage()).toHaveAttribute('data-phase', 'listening');
    act(() => api!.dictation.speech('speaking'));
    expect(stage()).toHaveAttribute('data-phase', 'speaking');
  });

  it('marks each earlier row with its delivery status for the spool knot', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    // The spool holds the four before the latest dictation.
    const rows = [...document.querySelectorAll('.home .recent-row')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.getAttribute('data-status')).toBe(row.querySelector('.badge')!.getAttribute('data-status'));
    }
  });
});

describe('voice stage styles', () => {
  const stageCss = css('stage.css');
  const block = stageCss.slice(stageCss.indexOf('.stage {'), stageCss.indexOf('}', stageCss.indexOf('.stage {')));

  it('re-declares the legacy aliases so children never inherit light-theme values', () => {
    for (const alias of ['accent', 'accent-soft', 'border', 'danger', 'identity', 'muted', 'panel-2', 'text']) {
      expect(block, alias).toMatch(new RegExp(`--${alias}: var\\(--`));
    }
    expect(block).toContain('color-scheme: dark;');
    expect(block).toContain('--seg-on-fg: #ececf1;');
  });

  it('stills the loom, the swell and the mic pulse under reduced motion', () => {
    const reduced = stageCss.slice(stageCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.loom__pulse { display: none; }');
    expect(reduced).toContain('.stage[data-phase] .loom__side { animation: none; }');
    expect(reduced).toContain('.stage[data-phase] .stage__mic i { animation: none; }');
  });

  it('keeps every stage colour pair at AA', () => {
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
    // Brightest glows (opacity 1 while listening/processing), over the gradient's lightest stop.
    const limeGlow = mix('#b6ff3c', top, 0.18);
    const cyanGlow = mix('#3cf0ff', top, 0.16);
    const surfaces = [top, '#0a0a0e', limeGlow, cyanGlow, token('panel')];
    for (const surface of surfaces) {
      for (const name of ['fg', 'mut', 'ok', 'info', 'warn', 'err']) {
        expect(ratio(token(name), surface), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio('#b6ff3c', surface), `focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(token('mut'), token('seg')), 'disabled Start label').toBeGreaterThanOrEqual(4.5);
    expect(ratio(token('fg'), token('segon')), 'selected style chip').toBeGreaterThanOrEqual(4.5);
  });
});
