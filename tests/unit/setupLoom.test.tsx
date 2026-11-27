/// ui-iter-07: setup threads the loom. The rail is one thread with a knot per step and live
/// ties; the welcome and finish steps carry a decorative loom line; the column is the stage.
import { readFileSync } from 'node:fs';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { comboKeys, comboLabel } from '../../src/components/KeyCombo';
import { Onboarding } from '../../src/features/onboarding/Onboarding';
import { SetupThread, setupTies } from '../../src/features/onboarding/SetupThread';
import type { GuidedState, SetupBoundary } from '../../src/features/onboarding/guidedSetup';
import { renderWithApp } from './testUtils';

const SHORTCUT = 'Ctrl + Shift + Space';
const guided = (patch: Partial<GuidedState> = {}): GuidedState => ({
  step: 1, permissions: { microphone: 'not-determined', accessibility: 'not-determined' }, ready: false,
  modelReady: false, modelState: 'missing', checking: false, error: null, downloading: null, progress: null,
  holdDone: false, tapDone: false, mode: 'hold', ...patch,
});
const states = (ties: { state: string }[][]) => ties.map((step) => step.map((tie) => tie.state));

const boundary = (): SetupBoundary => ({
  native: true, query: vi.fn().mockResolvedValue({ microphone: 'authorized', accessibility: 'authorized' }),
  readiness: vi.fn(async (modelId) => ({ modelId, ready: true, reason: null })),
  request: vi.fn(), openSettings: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), activeShortcut: () => SHORTCUT,
});
const resume = (progress: object | null) => ({ read: () => progress && JSON.stringify({ version: 1, modelId: 'whisper-base.en', shortcut: SHORTCUT, ...progress }), write: vi.fn() });
const css = (name: string) => readFileSync(`src/styles/${name}`, 'utf8');
function keyframes(source: string, name: string): string {
  const start = source.indexOf(`@keyframes ${name} {`);
  if (start < 0) return '';
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && (depth -= 1) === 0) return source.slice(start, index + 1);
  }
  return '';
}

describe('setup ties follow live setup state', () => {
  it('starts with every tie open', () => {
    expect(states(setupTies(guided(), SHORTCUT))).toEqual([['open', 'open', 'open'], ['open'], ['open', 'open']]);
  });

  it('ties permissions the way setup clears them, and the voice pack while and after it downloads', () => {
    const ties = setupTies(guided({ permissions: { microphone: 'authorized', accessibility: 'not-required' }, downloading: 'whisper-base.en' }), SHORTCUT);
    expect(ties[0].map((tie) => [tie.label, tie.state])).toEqual([['Microphone', 'tied'], ['Accessibility', 'tied'], ['Voice pack', 'working']]);
    expect(setupTies(guided({ permissions: { microphone: 'denied', accessibility: 'not-granted' } }), SHORTCUT)[0].map((tie) => tie.state)).toEqual(['open', 'open', 'open']);
    expect(setupTies(guided({ modelReady: true }), SHORTCUT)[0][2].state).toBe('tied');
  });

  it('ties the shortcut once it is chosen, and each way to dictate once its try succeeds', () => {
    const [shortcut] = setupTies(guided({ step: 2 }), SHORTCUT)[1];
    expect(shortcut).toEqual({ label: 'Shortcut', shows: comboLabel(SHORTCUT), state: 'open' });
    expect(setupTies(guided({ step: 3 }), SHORTCUT)[1][0].state).toBe('tied');
    expect(setupTies(guided({ step: 3, holdDone: true }), SHORTCUT)[2].map((tie) => [tie.label, tie.state])).toEqual([['Hold', 'tied'], ['Double-tap', 'open']]);
  });
});

describe('the rail thread', () => {
  it('ties off finished steps, marks the current one and keeps three list items', () => {
    const { container } = render(<SetupThread guided={guided({ step: 2, permissions: { microphone: 'authorized', accessibility: 'authorized' }, modelReady: true })} shortcut={SHORTCUT} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.querySelector('span')?.textContent)).toEqual(['Get connected', 'Your shortcut', 'First words']);
    expect(items.map((item) => item.dataset.state)).toEqual(['done', 'current', 'todo']);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(items[0]).toHaveClass('done');
    expect(items[0]).toHaveTextContent(/Get connected, done/);
    for (const knot of container.querySelectorAll('li > b')) expect(knot).toHaveAttribute('aria-hidden', 'true');
    expect(items[0].querySelector('b')).toHaveTextContent('✓');
    expect(items[1].querySelector('b')).toHaveTextContent('2');
  });

  it('says each tie and its state; the shortcut tie draws the keys and is read as "Shortcut"', () => {
    render(<SetupThread guided={guided({ step: 1, permissions: { microphone: 'authorized', accessibility: 'not-granted' }, downloading: 'whisper-base.en' })} shortcut={SHORTCUT} />);
    const [connect, shortcut, practice] = screen.getAllByRole('listitem');
    const ties = (item: HTMLElement) => [...item.querySelectorAll('em')].map((tie) => tie.textContent);
    expect(ties(connect)).toEqual(['Microphone: ready', 'Accessibility: not yet', 'Voice pack: in progress']);
    expect(ties(practice)).toEqual(['Hold: not yet', 'Double-tap: not yet']);
    const combo = shortcut.querySelector('em')!;
    expect(combo.querySelector('[aria-hidden="true"]')).toHaveTextContent(comboLabel(SHORTCUT));
    expect(within(combo).getByText('Shortcut')).toHaveClass('sr-only');
    expect(combo).toHaveTextContent(`${comboLabel(SHORTCUT)}Shortcut: not yet`);
    expect([...document.querySelectorAll('em')].map((tie) => tie.dataset.state)).toEqual(['tied', 'open', 'working', 'open', 'open', 'open']);
  });
});

describe('the setup stage and loom line', () => {
  it('opens the welcome on a decorative loom line through the shortcut caps, on the stage', () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume(null)} />);
    expect(document.querySelector('.guided-main')).toHaveClass('stage');
    expect(document.querySelector('.guided-setup')).toHaveAttribute('data-step', '0');
    const line = document.querySelector('.guided-hero > .loom-line')!;
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect([...line.querySelectorAll('.kbd')].map((cap) => cap.textContent)).toEqual(comboKeys(SHORTCUT));
    expect(line.querySelector('.hud-preview')).not.toBeNull();
    expect(line.querySelector('button, a, input, textarea, [tabindex]')).toBeNull();
    // The heading keeps its focus target and name; the line adds nothing to read.
    expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'guided-heading');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Less typing.More you.');
  });

  it.each([1, 2, 3])('leaves step %i to its task, without the loom line', async (step) => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step })} />);
    await waitFor(() => expect(document.querySelector('.guided-setup')).toHaveAttribute('data-step', String(step)));
    expect(document.querySelector('.loom-line')).toBeNull();
    expect(document.querySelector('.guided-hero > h2#guided-heading')).not.toBeNull();
  });

  it('closes the finish step on the loom line, without key caps', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 4, holdDone: true, tapDone: true, mode: 'tap' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Voxloom' })).toBeEnabled());
    const line = document.querySelector('.guided-hero > .loom-line')!;
    expect(line).toHaveAttribute('aria-hidden', 'true');
    expect(line.querySelector('.kbd')).toBeNull();
    expect(line.querySelector('.hud-preview')).not.toBeNull();
    const rail = within(screen.getByRole('complementary', { name: 'Setup progress' }));
    expect(rail.getAllByRole('listitem').map((item) => item.dataset.state)).toEqual(['done', 'done', 'done']);
  });

  it('marks finished ways to dictate as tied knots without changing their text', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 3, holdDone: true, mode: 'tap' })} />);
    const modes = await screen.findByLabelText('Two ways to use the same shortcut');
    const [hold, tap] = modes.querySelectorAll('span');
    expect(hold).toHaveTextContent('✓ Hold to talk');
    expect(hold).toHaveAttribute('data-done', 'true');
    expect(tap).toHaveTextContent('2 Double-tap');
    expect(tap).not.toHaveAttribute('data-done');
    expect(tap).toHaveAttribute('aria-current', 'step');
  });
});

describe('setup loom styles', () => {
  const stage = css('onboarding-stage.css');

  it('loads after the onboarding layout and stays within the file size cap', () => {
    const index = css('index.css');
    expect(index.indexOf('@import "./onboarding-stage.css";')).toBeGreaterThan(index.indexOf('@import "./onboarding.css";'));
    expect(stage.split('\n').length).toBeLessThan(200);
  });

  it('keeps every setup animation under the reduced-motion switch', () => {
    expect(css('onboarding.css')).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.guided-setup \*, \.guided-setup \*::before, \.guided-setup \*::after \{ animation: none !important; transition: none !important;/);
    // Everything that moves is drawn inside the setup window.
    for (const selector of ['.setup-thread', '.guided-hero', '.loom-line']) expect(stage).toContain(selector);
    expect(stage).not.toMatch(/(^|\n)(body|:root|html|\.app)\b/);
  });

  it('plays the intro once and rests on the finished line', () => {
    const intro = [...stage.matchAll(/animation: (loom-[a-z]+) [^;]*;/g)].map((match) => [match[1], match[0]]);
    expect(intro.map(([name]) => name).sort()).toEqual(['loom-halo', 'loom-line', 'loom-line', 'loom-press', 'loom-swell']);
    for (const [, rule] of intro) {
      expect(rule).not.toMatch(/infinite/);
      expect(rule).toMatch(/ both;$/);
    }
    // Each keyframe set leaves its end state to the base rule, so the resting frame is the finished design.
    for (const name of ['loom-line', 'loom-press', 'loom-halo']) {
      const frames = keyframes(stage, name);
      expect(frames).not.toBe('');
      expect(frames).not.toMatch(/\b(to|100%)\s*[,{]/);
    }
    // The swell runs an even number of alternating passes, so it ends where it started.
    expect(stage).toMatch(/animation: loom-swell [^;]* 4 alternate both;/);
  });
});
