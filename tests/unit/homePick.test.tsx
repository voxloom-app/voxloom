import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import type { DictationRecord } from '../../src/domain/types';
import { Home } from '../../src/features/home/Home';
import { pickMeasure, wordCount, wovenRecords } from '../../src/features/home/pickWords';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

const NOW = 1_800_000_000_000;
const NEWEST = 'Make retry explicit, but only when retained audio exists.';
const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');

const dogfood = (over: Partial<UseDogfoodCaptureResult> = {}): UseDogfoodCaptureResult => ({
  cancel: vi.fn(), captureState: { kind: 'idle' }, hudResult: null, intendedTarget: null, message: null,
  origin: null, phase: 'idle', scopeReady: false, hudReady: false, start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined), transcript: null, ...over,
});

const record = (over: Partial<DictationRecord>): DictationRecord => ({
  createdAt: NOW + 60_000, durationSeconds: 4, id: 'synthetic-new', model: null, recoveryExpiresAt: null,
  status: 'copied', style: 'formal', text: 'Ship the synthetic sample today.', ...over,
});

function renderHome(toast = vi.fn()) {
  let api: ReturnType<typeof useApp> | null = null;
  function Probe() { api = useApp(); return null; }
  const view = renderWithApp(<><Probe /><Home dogfood={dogfood()} onToast={toast} /></>, () => NOW);
  return { ...view, dispatch: (action: Parameters<ReturnType<typeof useApp>['dispatch']>[0]) => act(() => api!.dispatch(action)) };
}

const pick = () => screen.getByRole('region', { name: 'Last dictation' });
const earlier = () => screen.getByRole('region', { name: 'Earlier dictations' });

describe('The last pick (ui-iter-09): your words take the stage', () => {
  it('leads the voice stage with the newest dictation, after the shortcut heading', () => {
    renderHome();
    const stage = document.querySelector('.home .stage')!;
    expect(stage).toContainElement(pick());
    expect(within(pick()).getByRole('blockquote')).toHaveTextContent(NEWEST);
    expect(pick().querySelector('.badge')).toHaveAttribute('data-status', 'inserted');
    expect(pick()).toHaveAttribute('data-status', 'inserted');
    expect(within(pick()).getByRole('button', { name: 'Read in full' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pick().querySelector('time')).toHaveAttribute('dateTime', new Date(NOW - 3 * 60_000).toISOString());
    // The heading still opens the page; the pick follows it, and the lede steps aside.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([expect.stringMatching(/^Hold .* to dictate$/), 'Last dictation']);
    expect(document.querySelector('.home-hero__lede')).toBeNull();
    expect(document.querySelector('.home-hero')).toHaveAttribute('data-words');
    // ui-iter-21: the weft runs under the words, from Start (in) through the knot to Copy (out);
    // the knot is decoration only and takes the pick's status.
    const weft = document.querySelector('.home-hero .loom-bar')!;
    expect(weft).toHaveAttribute('data-status', 'inserted');
    expect(weft.querySelector('.pick__weft')).toHaveAttribute('aria-hidden', 'true');
    expect(pick().compareDocumentPosition(weft)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(weft as HTMLElement).getByRole('button', { name: 'Start dictating' })).toBeInTheDocument();
    expect(within(weft as HTMLElement).getByRole('button', { name: 'Copy last dictation' })).toBeInTheDocument();
  });

  it('does not repeat the last pick on the cloth', () => {
    renderHome();
    expect(within(earlier()).queryByText(NEWEST)).toBeNull();
    expect(within(earlier()).getAllByRole('button', { name: 'Copy dictation' })).toHaveLength(4);
    expect(screen.getAllByText(NEWEST)).toHaveLength(1);
  });

  it('copies the last dictation from the stage', async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    renderHome(toast);
    await user.click(screen.getByRole('button', { name: 'Copy last dictation' }));
    expect(toast).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('skips failed runs: only a dictation with words becomes the last pick', () => {
    const { dispatch } = renderHome();
    dispatch({ record: record({ id: 'synthetic-failed', status: 'failed', text: 'Transcription failed.' }), type: 'append-record' });
    expect(within(pick()).getByRole('blockquote')).toHaveTextContent(NEWEST);
    dispatch({ record: record({ createdAt: NOW + 120_000, status: 'unverified' }), type: 'append-record' });
    expect(within(pick()).getByRole('blockquote')).toHaveTextContent('Ship the synthetic sample today.');
    expect(pick()).toHaveAttribute('data-status', 'unverified');
    expect(within(earlier()).getByText(NEWEST)).toBeInTheDocument();
  });

  it('weaves in only a dictation that lands while Home is open', () => {
    const { dispatch, unmount } = renderHome();
    expect(document.querySelector('.pick__words')).not.toHaveAttribute('data-fresh');
    expect(document.querySelector('.pick__weft')).not.toHaveAttribute('data-fresh');
    dispatch({ record: record({}), type: 'append-record' });
    expect(document.querySelector('.pick__words')).toHaveAttribute('data-fresh');
    expect(document.querySelector('.pick__weft')).toHaveAttribute('data-fresh');
    unmount();
    // Coming back to Home shows the same words at rest, without replaying the weave.
    renderHome();
    expect(document.querySelector('.pick__words')).not.toHaveAttribute('data-fresh');
  });

  it('before the first dictation, explains the gesture; the first one weaves in', () => {
    const { dispatch } = renderHome();
    dispatch({ type: 'scenario-empty' });
    expect(screen.queryByRole('region', { name: 'Last dictation' })).toBeNull();
    expect(document.querySelector('.home-hero__lede')).toHaveTextContent('Speak in any app.');
    expect(within(earlier()).getByText('No dictations yet.')).toBeInTheDocument();
    dispatch({ record: record({}), type: 'append-record' });
    expect(document.querySelector('.pick__words')).toHaveAttribute('data-fresh');
    expect(within(earlier()).getByText('Nothing earlier yet.')).toBeInTheDocument();
  });
});

describe('Reading recent dictations without leaving Home', () => {
  const reader = () => within(screen.getByRole('dialog', { name: 'Recent dictations' }));

  it('opens the full, unverified passage, keeps the selection by ID, and copies only on request', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderHome();
    const text = `${'A longer dictation. '.repeat(40)}\n\nKeep the paragraph break.`;
    dispatch({ record: record({ status: 'unverified', text }), type: 'append-record' });
    await navigator.clipboard.writeText('Unchanged');
    const opener = screen.getByRole('button', { name: 'Read in full' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(reader().getByRole('blockquote').textContent).toBe(text);
    expect(reader().getByText(/check the destination before copying/i)).toBeVisible();
    dispatch({ record: record({ createdAt: NOW + 120_000, id: 'next' }), type: 'append-record' });
    expect(reader().getByRole('blockquote').textContent).toBe(text);
    await user.click(reader().getByRole('button', { name: 'Older' }));
    expect(reader().getByRole('blockquote')).toHaveTextContent(NEWEST);
    expect(reader().getByText('9 words · 7s')).toBeVisible();
    expect(reader().queryByText(/check the destination/i)).toBeNull();
    await user.click(reader().getByRole('button', { name: 'Newer' }));
    expect(await navigator.clipboard.readText()).toBe('Unchanged');
    await user.click(reader().getByRole('button', { name: 'Copy text' }));
    expect(await navigator.clipboard.readText()).toBe(text);
    expect(reader().getByText('Copied to clipboard')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    expect(within(pick()).getByRole('blockquote')).not.toHaveTextContent(text);
  });

  it('opens directly at an earlier entry, skips failures, and drops text removed during reading', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderHome();
    await user.click(within(earlier()).getByRole('button', { name: /Open src\/auth/ }));
    expect(reader().getByRole('blockquote')).toHaveTextContent('Open src/auth/session.ts');
    expect(reader().getByRole('button', { name: 'Older' })).toBeDisabled();
    await user.click(reader().getByRole('button', { name: 'Newer' }));
    expect(reader().getByRole('blockquote')).toHaveTextContent('Do not remove');
    dispatch({ type: 'scenario-empty' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Do not remove/)).toBeNull();
  });
});

describe('pick words helpers', () => {
  it('orders dictations with words newest first and drops failures', () => {
    const list = wovenRecords([
      record({ createdAt: 1, id: 'a', status: 'inserted' }),
      record({ createdAt: 3, id: 'b', status: 'failed' }),
      record({ createdAt: 2, id: 'c', status: 'copied' }),
    ]);
    expect(list.map(({ id }) => id)).toEqual(['c', 'a']);
  });

  it('counts words and steps long transcripts down a size', () => {
    expect(wordCount('  one two\nthree  ')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(pickMeasure('a'.repeat(90))).toBe('short');
    expect(pickMeasure('a'.repeat(91))).toBe('medium');
    expect(pickMeasure('a'.repeat(200))).toBe('medium');
    expect(pickMeasure('a'.repeat(201))).toBe('long');
  });
});

describe('last pick and words-face styles', () => {
  const pickCss = css('home-pick.css');
  const reduced = pickCss.slice(pickCss.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('loads after the stage it sits on', () => {
    expect(css('index.css')).toMatch(/@import "\.\/stage\.css";\n@import "\.\/home-pick\.css";/);
  });

  it('drops the weave, the travelling light and the mask under reduced motion', () => {
    expect(reduced).toContain('.stage .pick__words[data-fresh] p { animation: none; -webkit-mask: none; mask: none; }');
    expect(reduced).toMatch(/\.pick__weft\[data-fresh\]::before,\s*\.pick__weft\[data-fresh\] i \{ animation: none; \}/);
    expect(reduced).toContain('.stage[data-phase] .pick__weft::after { animation: none; opacity: 0; }');
  });

  it('sets your words in a local system serif, with no bundled font files', () => {
    expect(css('tokens.css')).toContain('--font-words: "Iowan Old Style", "Palatino Linotype", Palatino, Charter, Georgia, ui-serif, serif;');
    expect(pickCss).toMatch(/\.stage \.pick__words p \{[^}]*font-family: var\(--font-words\);/);
    expect(css('home.css')).toMatch(/\.home \.recent-row > p \{[^}]*font-family: var\(--font-words\);/);
    expect(css('history.css')).toMatch(/\.history-row \.history-row__text \{[^}]*font-family: var\(--font-words\);/);
    expect(css('dictionary.css')).toMatch(/\.dictionary \.term-row strong \{[^}]*font-family: var\(--font-words\);/);
    expect(css('dictionary-stage.css')).toMatch(/\.word-check \.word-check__typed \{[^}]*font-family: var\(--font-words\);/);
    // What the engine heard stays in mono.
    expect(css('history.css')).toMatch(/\.history-row__original p \{[^}]*font-family: var\(--mono\);/);
  });

  it('keeps the outcome badge at AA on the stage, even under the brightest glow', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const stageCss = css('stage.css');
    const block = stageCss.slice(stageCss.indexOf('.stage {'), stageCss.indexOf('}', stageCss.indexOf('.stage {')));
    const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];
    const top = '#17171f';
    for (const surface of [top, mix('#b6ff3c', top, 0.18), mix('#3cf0ff', top, 0.16)]) {
      for (const name of ['ok', 'info', 'warn']) {
        const tint = mix(token(name), surface, 0.1);
        expect(ratio(token(name), tint), `${name} badge on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio('#f6f6f9', surface)).toBeGreaterThanOrEqual(7);
    }
  });
});
