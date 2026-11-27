import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import type { DictationState } from '../../src/domain/types';
import { Home } from '../../src/features/home/Home';
import { stagePhase } from '../../src/features/home/stagePhase';
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
});

describe('Home voice stage', () => {
  it('holds the hero; model and output close the page, not the stage; no mic readout above it', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'idle');
    expect(stage().querySelector('#home-title')).not.toBeNull();
    expect(stage().querySelector('#capture-title')).toBeNull();
    // ui-iter-25: the readout row is gone; the keys and the rail say what the mic is doing.
    expect(stage().querySelector('.stage__readout')).toBeNull();
    expect(screen.queryByText('Mic off')).toBeNull();
    // Model and output are named for screen readers and shown as values, on the page's colophon.
    expect(document.querySelector('.home-page .home-colophon__setup')).toHaveTextContent('Model Whisper BaseOutput Insert, fall back to Copy');
    expect(stage().querySelector('.home-colophon')).toBeNull();
    // The recent list stays outside the stage.
    expect(stage().querySelector('.recent-list')).toBeNull();
  });

  it('draws one loom around your keys: hidden, unfocusable, seven threads in and seven out (ui-iter-33)', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const looms = [...stage().querySelectorAll('svg.loom')];
    expect(looms).toHaveLength(2);
    const bar = stage().querySelector('.home-hero__title.loom-bar')!;
    for (const loom of looms) {
      expect(loom).toHaveAttribute('aria-hidden', 'true');
      expect(loom).toHaveAttribute('focusable', 'false');
      expect(loom.parentElement).toBe(bar);
    }
    expect(bar.querySelectorAll('.loom--in .loom__side--in .loom__pulse')).toHaveLength(7);
    expect(bar.querySelectorAll('.loom--out .loom__side--out .loom__pulse')).toHaveLength(7);
    expect(bar.querySelectorAll('.loom__warp')).toHaveLength(14);
    // The threads run into "Hold <keys>" and out of "to dictate"; the heading itself holds none.
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent(/^Hold .* to dictate$/);
    expect(title.querySelector('svg')).toBeNull();
    expect(looms[0].compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title.compareDocumentPosition(looms[1])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(stage().querySelector('.dictate, .pick__weft')).toBeNull();
  });

  it('lights up while capturing and transcribing; the rail\'s foot says Stop and Cleaning up… (ui-iter-33)', () => {
    const { unmount } = renderWithApp(<Home dogfood={dogfood({ phase: 'recording' })} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'listening');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    unmount();
    renderWithApp(<Home dogfood={dogfood({ phase: 'cleaning' })} onToast={vi.fn()} />);
    expect(stage()).toHaveAttribute('data-phase', 'processing');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says how your words are made once, as the colophon after the earlier dictations (ui-iter-29)', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const page = document.querySelector('.home > .home-page')!;
    const colophon = page.querySelector('.home-colophon')!;
    // Nothing stands between the stage and the earlier words: the colophon is the page's last part.
    expect(page.lastElementChild).toBe(colophon);
    expect(screen.getByRole('region', { name: 'Earlier dictations' }).compareDocumentPosition(colophon))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(colophon.querySelector('.home-colophon__setup')).not.toBeNull();
    expect(within(colophon as HTMLElement).getByRole('radiogroup', { name: 'Current writing style' })).toBeInTheDocument();
    expect(within(stage() as HTMLElement).queryByRole('radiogroup')).toBeNull();
    // The last pick keeps its heading for screen readers; the stage shows no label above the words.
    expect(screen.getByRole('heading', { level: 2, name: 'Last dictation' })).toHaveClass('sr-only');
    expect(document.querySelector('.home-hero')).toHaveAttribute('data-words');
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

  it('marks each earlier row with its delivery status for the spool knot, named for screen readers', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    // The newest dictation is the stage's last pick; the spool holds the four before it.
    const rows = [...document.querySelectorAll('.home .recent-row')];
    expect(rows).toHaveLength(4);
    const names = { copied: 'Copied', inserted: 'Inserted', unverified: 'Unverified' } as Record<string, string>;
    for (const row of rows) {
      // ui-iter-29: no pill; the knot's shape shows the status and the row still names it.
      expect(row.querySelector('.badge')).toBeNull();
      expect(row.querySelector('.sr-only')).toHaveTextContent(names[row.getAttribute('data-status')!]);
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

  it('stills the loom and the swell under reduced motion', () => {
    const reduced = stageCss.slice(stageCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.loom__pulse { display: none; }');
    expect(reduced).toContain('.stage[data-phase] .loom__side { animation: none; }');
  });

  it('holds the threads still at rest: a light travels them only while you speak or Voxloom writes', () => {
    expect(stageCss).toMatch(/\n\.loom__pulse \{[^}]*opacity: 0;/);
    expect(stageCss).toMatch(/\.stage\[data-phase="listening"\] \.loom__side--in \.loom__pulse,\s*\.stage\[data-phase="processing"\] \.loom__side--out \.loom__pulse \{[^}]*opacity: 1;/);
    // Light used to lift the resting pulses back up; it must not.
    expect(css('daylight-pages.css')).not.toMatch(/\.loom__pulse \{[^}]*opacity/);
  });

  it('lays the threads beside the keys without changing the heading\'s height (ui-iter-33)', () => {
    const bar = css('loom-bar.css');
    expect(bar).toMatch(/\.loom-bar \.loom \{[^}]*margin-block: calc\(var\(--loom-h\) \/ -2\);[^}]*z-index: -1;/);
    expect(bar).toMatch(/\.loom-bar h1 \{ grid-area: 1 \/ 2;/);
    expect(bar).toMatch(/\.loom-bar \.loom--in \{ grid-column: 1;/);
    expect(bar).toMatch(/\.loom-bar \.loom--out \{ grid-column: 3;/);
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
