/// ui-iter-37: setup's first words. The note wears the HUD's signals, three beats follow the
/// real capture with the user's own keys, actions appear when they mean something, and a
/// waiting primary says what it is waiting for.
import { createRef } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { comboKeys, spokenCombo } from '../../src/components/KeyCombo';
import { Onboarding } from '../../src/features/onboarding/Onboarding';
import { PracticeStep, practiceLook, type PracticeLook } from '../../src/features/onboarding/PracticeStep';
import type { SetupBoundary } from '../../src/features/onboarding/guidedSetup';
import type { DogfoodPhase } from '../../src/services/stt/dogfoodPhase';
import { renderWithApp } from './testUtils';

const SHORTCUT = 'Ctrl + Shift + Space';

describe('practiceLook', () => {
  it.each<[DogfoodPhase, boolean, boolean, PracticeLook]>([
    ['idle', false, false, 'idle'],
    ['starting', false, false, 'listening'],
    ['recording', true, true, 'listening'],
    ['transcribing', false, false, 'writing'],
    ['cleaning', false, false, 'writing'],
    ['success', true, false, 'done'],
    // After Try double-tap the hold's success is history: the note waits again.
    ['success', false, false, 'idle'],
    ['error', false, false, 'trouble'],
    ['cancelled', false, false, 'idle'],
    ['idle', false, true, 'trouble'],
  ])('%s (counted %s, hinted %s) looks %s', (phase, counted, hinted, look) => {
    expect(practiceLook(phase, counted, hinted)).toBe(look);
  });
});

function renderStep(patch: Partial<Parameters<typeof PracticeStep>[0]> = {}) {
  const props = {
    heading: createRef<HTMLHeadingElement>(), field: createRef<HTMLTextAreaElement>(),
    mode: 'hold' as const, holdDone: false, tapDone: false, ready: true, look: 'idle' as const,
    status: 'Ready when you are', busy: false, attempted: false, shortcut: SHORTCUT,
    onRetry: vi.fn(), onCheck: vi.fn(), ...patch,
  };
  render(<PracticeStep {...props} />);
  return props;
}
const beats = () => within(screen.getByRole('list')).getAllByRole('listitem');
/** What a screen reader hears: the caps are aria-hidden, their spoken names are not. */
function spoken(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  return copy.textContent ?? '';
}
const caps = (node: Element) => [...node.querySelectorAll('.kbd')].map((cap) => cap.textContent);

describe('PracticeStep', () => {
  it('spells out each beat with the user’s own keys', () => {
    renderStep({ shortcut: 'AltRight' });
    expect(beats().map(spoken)).toEqual([
      'Click in the note.',
      `Hold ${spokenCombo('AltRight')} and say a short sentence.`,
      'Let go. Your words land in the note.',
    ]);
    expect(caps(beats()[1])).toEqual(comboKeys('AltRight'));
    expect(beats()[0]).toHaveAttribute('data-state', 'current');
  });
  it('hands-free beats ask for a press to finish', () => {
    renderStep({ mode: 'tap', holdDone: true });
    expect(screen.getByRole('heading', { name: 'Now, go hands-free.' })).toBeInTheDocument();
    expect(spoken(beats()[1])).toBe(`Double-tap ${spokenCombo(SHORTCUT)}, let go, and speak.`);
    expect(caps(beats()[1])).toEqual(comboKeys(SHORTCUT));
    expect(beats()[2]).toHaveTextContent('Press it once more.');
  });
  it('moves the current beat with the capture and ties off the ones behind it', async () => {
    renderStep({ look: 'writing', status: 'Transcribing…' });
    expect(beats().map((beat) => beat.getAttribute('data-state'))).toEqual(['done', 'done', 'current']);
    expect(beats()[0]).toHaveTextContent('Done.');
    expect(screen.getByRole('status')).toHaveTextContent('Transcribing…');
  });
  it('focusing the note ties off the first beat', async () => {
    renderStep();
    await userEvent.click(screen.getByRole('textbox', { name: 'Practice dictation field' }));
    expect(beats().map((beat) => beat.getAttribute('data-state'))).toEqual(['done', 'current', null]);
  });
  it('shows one status, and no retry until a try has happened', () => {
    renderStep();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('offers Try again after a try, and Cancel dictation during one', async () => {
    const props = renderStep({ attempted: true, look: 'trouble', status: 'Nothing was heard.' });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
  it('labels the retry Cancel dictation while busy', () => {
    renderStep({ busy: true, look: 'listening' });
    expect(screen.getByRole('button', { name: 'Cancel dictation' })).toBeInTheDocument();
  });
  it('offers Check again only when setup is not ready', async () => {
    const props = renderStep({ ready: false });
    expect(screen.getByText(/Check permissions, voice pack/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(props.onCheck).toHaveBeenCalledOnce();
  });
  it('celebrates both ways once both are tied off', () => {
    renderStep({ mode: 'tap', holdDone: true, tapDone: true, look: 'done' });
    expect(screen.getByRole('heading', { name: 'Both ways. All yours.' })).toBeInTheDocument();
    expect(beats().every((beat) => beat.getAttribute('data-state') === 'done')).toBe(true);
  });
});

const boundary = (): SetupBoundary => ({
  native: true, query: vi.fn().mockResolvedValue({ microphone: 'authorized', accessibility: 'authorized' }),
  readiness: vi.fn(async (modelId) => ({ modelId, ready: true, reason: null })),
  request: vi.fn(), openSettings: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), activeShortcut: () => SHORTCUT,
});
const resume = (progress: object) => ({ read: () => JSON.stringify({ version: 1, modelId: 'whisper-base.en', shortcut: SHORTCUT, ...progress }), write: vi.fn() });

describe('a waiting primary says what it waits for', () => {
  it('step 3 waits for one hold-to-talk try', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 3 })} />);
    const next = await screen.findByRole('button', { name: /Try double-tap/ });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription('Opens after one hold-to-talk try');
  });
  it('the hands-free try has its own reason', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 3, holdDone: true, mode: 'tap' })} />);
    const next = await screen.findByRole('button', { name: /Finish setup/ });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription('Opens after one hands-free try');
  });
  it('drops the reason once the primary opens', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 3, holdDone: true })} />);
    const next = await screen.findByRole('button', { name: /Try double-tap/ });
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('heading', { name: 'That’s hold to talk.' })).toBeInTheDocument();
  });
  it('step 2 waits for the shortcut, then opens', async () => {
    renderWithApp(<Onboarding boundary={boundary()} onClose={vi.fn()} progressStorage={resume({ step: 2 })} />);
    const next = await screen.findByRole('button', { name: /Use this shortcut/ });
    await waitFor(() => expect(next).toBeEnabled());
    expect(next).not.toHaveAttribute('aria-describedby');
  });
});
