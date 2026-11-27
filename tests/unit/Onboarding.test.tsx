import { dispatchPracticeGesture, subscribePracticeReset } from '../../src/features/onboarding/practiceBridge';
import { act } from '@testing-library/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../../src/features/onboarding/Onboarding';
import type { SetupBoundary } from '../../src/features/onboarding/guidedSetup';
import { renderWithApp } from './testUtils';

export function setupBoundary(): SetupBoundary {
  return {
    native: true, query: vi.fn().mockResolvedValue({ microphone: 'authorized', accessibility: 'authorized' }),
    readiness: vi.fn(async (modelId) => ({ modelId, ready: true, reason: null })),
    request: vi.fn(), openSettings: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), activeShortcut: () => 'Ctrl + Shift + Space',
  };
}
const storage = () => ({ read: () => null, write: vi.fn() });

describe('B guided setup', () => {
  it('explicit Close cancels a pending practice start and closes, unlike Escape cancellation', async () => {
    const io = setupBoundary();
    const close = vi.fn();
    const user = userEvent.setup();
    renderWithApp(<Onboarding boundary={io} onClose={close} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 3 }), write: vi.fn() }} />);
    await waitFor(() => expect(io.readiness).toHaveBeenCalled());
    io.readiness = () => new Promise(() => {});
    act(() => dispatchPracticeGesture('hold-start'));
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    expect(close).toHaveBeenCalledOnce();
  });
  it('a start refused by a failed recheck resets the gesture machine so no stray latch remains', async () => {
    const io = setupBoundary();
    renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 3 }), write: vi.fn() }} />);
    await waitFor(() => expect(io.readiness).toHaveBeenCalled());
    vi.mocked(io.query).mockResolvedValue({ microphone: 'authorized', accessibility: 'not-granted' });
    const reset = vi.fn();
    const unsubscribe = subscribePracticeReset(reset);
    try {
      act(() => dispatchPracticeGesture('hold-start'));
      await waitFor(() => expect(reset).toHaveBeenCalled());
      expect(screen.getByText(/Check permissions, voice pack and registered shortcut/)).toBeInTheDocument();
    } finally { unsubscribe(); }
  });
  it('discloses Base English before Start and Set up later leaves setup incomplete', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const io = setupBoundary();
    renderWithApp(<Onboarding boundary={io} onClose={close} progressStorage={storage()} />);
    expect(screen.getByRole('heading', { name: /Less typing/ })).toBeInTheDocument();
    expect(screen.getByText(/Starting setup downloads Whisper Base/)).toHaveTextContent('148 MB');
    expect(io.download).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    expect(close).toHaveBeenCalledOnce();
  });
  describe('BUS-224: expected voice-pack state on Welcome', () => {
    const missingReason = 'The selected voice pack is missing, downloading or not verified. Check or retry the download.';
    function missingBoundary(status: 'missing' | 'pending' | 'downloading' = 'missing') {
      const io = setupBoundary();
      io.readiness = vi.fn(async (modelId) => ({ modelId, ready: false, status, reason: missingReason }));
      return io;
    }
    it.each(['missing', 'pending', 'downloading'] as const)('step 0 shows no red reason for a %s voice pack, and no Skip setup', async (status) => {
      const io = missingBoundary(status);
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={storage()} />);
      await waitFor(() => expect(io.readiness).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(missingReason)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Set up later' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip setup' })).not.toBeInTheDocument();
    });
    it('step 1 names the missing pack and its explicit action rather than listing every possible readiness state', async () => {
      renderWithApp(<Onboarding boundary={missingBoundary()} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 1 }), write: vi.fn() }} />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Download needed');
      expect(screen.getByRole('heading', { name: 'Get your voice pack.' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download voice pack' })).toBeEnabled();
    });
    it('a resumed step starts no transfer; a requested download shows its real progress and remains cancellable', async () => {
      const io = missingBoundary();
      const user = userEvent.setup();
      let finishTransfer!: () => void;
      io.download = vi.fn((id, progress) => {
        progress({ modelId: id, bytesReceived: 20, bytesTotal: 80, ratio: 0.25 });
        return new Promise<void>(resolve => { finishTransfer = resolve; });
      });
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 1 }), write: vi.fn() }} />);
      const start = await screen.findByRole('button', { name: 'Download voice pack' });
      expect(io.download).not.toHaveBeenCalled();
      await user.click(start);
      const meter = await screen.findByRole('progressbar', { name: 'Voice pack download' });
      expect(meter).toHaveAttribute('max', '80');
      expect(meter).toHaveAttribute('value', '20');
      expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Cancel download' }));
      expect(io.cancelDownload).toHaveBeenCalledWith('whisper-base.en');
      await act(async () => finishTransfer());
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(io.download).toHaveBeenCalledTimes(1);
    });
    it('Start setup surfaces the reason once setup has started, and Back to Welcome hides it again', async () => {
      const user = userEvent.setup();
      const io = missingBoundary();
      vi.mocked(io.download).mockRejectedValue(new Error('disk full'));
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={storage()} />);
      await waitFor(() => expect(io.readiness).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: /Start setup/ }));
      // A failed download is a real failure and stays visible, on step 1 and back on Welcome.
      expect(await screen.findByRole('alert')).toHaveTextContent(/Download failed: Error: disk full/);
      expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('heading', { name: /Less typing/ })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/Download failed/);
    });
    it('Back to Welcome hides only the expected readiness reason', async () => {
      const user = userEvent.setup();
      renderWithApp(<Onboarding boundary={missingBoundary()} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 1 }), write: vi.fn() }} />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Download needed');
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('heading', { name: /Less typing/ })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    it('step 0 still shows an unavailable engine and a failed check', async () => {
      const io = setupBoundary();
      io.readiness = vi.fn(async (modelId) => ({ modelId, ready: false, status: 'unavailable' as const, reason: 'The selected speech engine is unavailable in this build or on this Mac.' }));
      const view = renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={storage()} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/speech engine is unavailable/);
      view.unmount();
      const failing = setupBoundary();
      failing.readiness = vi.fn().mockRejectedValue(new Error('readiness exploded'));
      renderWithApp(<Onboarding boundary={failing} onClose={vi.fn()} progressStorage={storage()} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/readiness exploded/);
    });
    it('step 0 still shows a progress save failure', async () => {
      const io = missingBoundary();
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ read: () => null, write: () => { throw new Error('quota'); } }} />);
      expect(await screen.findByRole('alert')).toHaveTextContent(/Setup progress could not be saved/);
    });
  });
  describe('BUS-225: finish step', () => {
    const finished = () => ({ read: () => JSON.stringify({ version: 1, step: 4, holdDone: true, tapDone: true, mode: 'tap', modelId: 'whisper-base.en', shortcut: 'Ctrl + Shift + Space' }), write: vi.fn() });
    it('ready: new intro and note, no summary list or attention line, and only Back and Open Voxloom in the footer', async () => {
      const io = setupBoundary();
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={finished()} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open Voxloom' })).toBeEnabled());
      expect(screen.getByText('You’ve tried both ways to dictate. Choose Open Voxloom to finish, then use your shortcut in any app.')).toBeInTheDocument();
      expect(screen.getByText('Your shortcut works in other apps once setup closes. If an app won’t take typed text, Voxloom may copy your words so you can paste them.')).toBeInTheDocument();
      expect(document.querySelector('.guided-list')).toBeNull();
      expect(screen.queryByText(/needs attention before you finish/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Review access and voice pack' })).not.toBeInTheDocument();
      const footer = document.querySelector('.guided-footer')!;
      expect([...footer.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Back', 'Open Voxloom']);
      expect(footer.querySelector('span')).not.toBeNull();
    });
    it('not ready: the attention line, then the Review button, before the shortcut card', async () => {
      const io = setupBoundary();
      vi.mocked(io.query).mockResolvedValue({ microphone: 'authorized', accessibility: 'not-granted' });
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={finished()} />);
      const line = await screen.findByText('Access or the voice pack needs attention before you finish.');
      expect(line).toHaveClass('form-error');
      const review = screen.getByRole('button', { name: 'Review access and voice pack' });
      expect(line.nextElementSibling).toBe(review);
      expect(review.nextElementSibling).toHaveClass('guided-shortcut');
      expect(screen.getByRole('button', { name: 'Open Voxloom' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Set up later' })).not.toBeInTheDocument();
    });
    it('not ready because the pack is missing: the specific reason replaces the attention line, with exactly one alert', async () => {
      const io = setupBoundary();
      io.readiness = vi.fn(async (modelId) => ({ modelId, ready: false, status: 'missing' as const, reason: 'Missing' }));
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={finished()} />);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Missing');
      expect(alert).toHaveClass('form-error');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.queryByText('Access or the voice pack needs attention before you finish.')).not.toBeInTheDocument();
      const review = screen.getByRole('button', { name: 'Review access and voice pack' });
      expect(alert.nextElementSibling).toBe(review);
      expect(review.nextElementSibling).toHaveClass('guided-shortcut');
    });
    it('not ready with no specific error shows the generic attention line as the one alert', async () => {
      const io = setupBoundary();
      vi.mocked(io.query).mockResolvedValue({ microphone: 'authorized', accessibility: 'not-granted' });
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={finished()} />);
      expect(await screen.findByText('Access or the voice pack needs attention before you finish.')).toBeVisible();
      const alerts = screen.getAllByRole('alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent('Access or the voice pack needs attention before you finish.');
    });
    it('ready with an error (save failure) keeps the shared bottom alert, once', async () => {
      const io = setupBoundary();
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ ...finished(), write: () => { throw new Error('quota'); } }} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open Voxloom' })).toBeEnabled());
      const alerts = screen.getAllByRole('alert');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(/Setup progress could not be saved/);
      expect(alerts[0].closest('.guided-content')!.lastElementChild).toBe(alerts[0]);
      expect(screen.queryByRole('button', { name: 'Review access and voice pack' })).not.toBeInTheDocument();
    });
    it.each([1, 2, 3])('step %i keeps the specific error once, beside its task on the connection step', async (step) => {
      const io = setupBoundary();
      io.readiness = vi.fn(async (modelId) => ({ modelId, ready: false, status: 'missing' as const, reason: 'Missing' }));
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step, holdDone: true, tapDone: false, mode: 'tap', modelId: 'whisper-base.en', shortcut: 'Ctrl + Shift + Space' }), write: vi.fn() }} />);
      const alert = await screen.findByRole('alert');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(alert).toHaveTextContent('Missing');
      if (step === 1) expect(alert.parentElement).toContainElement(screen.getByRole('button', { name: 'Download voice pack' }));
      else expect(alert.closest('.guided-content')!.lastElementChild).toBe(alert);
      expect(screen.queryByText('Access or the voice pack needs attention before you finish.')).not.toBeInTheDocument();
    });
    it('Escape on step 4 still closes the window', async () => {
      const user = userEvent.setup();
      const close = vi.fn();
      renderWithApp(<Onboarding boundary={setupBoundary()} onClose={close} progressStorage={finished()} />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open Voxloom' })).toBeEnabled());
      await user.keyboard('{Escape}');
      expect(close).toHaveBeenCalledOnce();
    });
    it.each([0, 1, 2, 3])('step %i keeps Set up later', (step) => {
      renderWithApp(<Onboarding boundary={setupBoundary()} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step, holdDone: true, tapDone: false, mode: 'tap', modelId: 'whisper-base.en', shortcut: 'Ctrl + Shift + Space' }), write: vi.fn() }} />);
      expect(screen.getByRole('button', { name: 'Set up later' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Skip setup' })).not.toBeInTheDocument();
    });
  });
  it('resuming with everything connected shows confirmations and the next step, not permission or download instructions', async () => {
    const io = setupBoundary();
    renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 1 }), write: vi.fn() }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'You’re connected.' })).toBeVisible();
    expect(screen.getByText(/Choose Continue to set your dictation shortcut/)).toBeVisible();
    expect(screen.getByRole('list', { name: 'Connection checks' })).toHaveTextContent('Verified');
    expect(screen.queryByText(/Enable Voxloom in System Settings|Interrupted downloads restart/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(io.request).not.toHaveBeenCalled();
    expect(io.download).not.toHaveBeenCalled();
  });
  it('requires only Microphone and Accessibility and a ready pack before the accepted shortcut and writable two-try note', async () => {
    const user = userEvent.setup();
    const io = setupBoundary();
    vi.mocked(io.query).mockResolvedValue({ microphone: 'authorized', accessibility: 'not-granted' });
    renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={storage()} />);
    await user.click(screen.getByRole('button', { name: /Start setup/ }));
    expect(screen.getByRole('heading', { name: 'Turn on Accessibility.' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Allow Microphone' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Input Monitoring/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    expect(screen.getByText(/Accessibility lets Voxloom insert words/)).toHaveTextContent(/Esc/);
    await user.click(screen.getByRole('button', { name: 'Open Accessibility Settings' }));
    expect(io.request).toHaveBeenCalledWith('accessibility');
    vi.mocked(io.query).mockResolvedValue({ microphone: 'authorized', accessibility: 'authorized' });
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'You’re connected.' })).toHaveFocus();
    expect(screen.queryByText(/If macOS asks you/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByRole('heading', { name: /Your shortcut/ })).toBeInTheDocument();
    expect(screen.getByText(/press just one key/)).toHaveTextContent('Accessibility access you allowed in step 1');
    expect(screen.queryByText(/Input Monitoring/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use this shortcut/ }));
    const note = screen.getByRole('textbox', { name: 'Practice dictation field' });
    expect(note).not.toHaveAttribute('readonly');
    expect(screen.getByRole('heading', { name: /First, hold/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try double-tap/ })).toBeDisabled();
    await user.type(note, 'Typing does not count.');
    expect(screen.getByRole('button', { name: /Try double-tap/ })).toBeDisabled();
    expect(screen.queryByText(/Simulate/)).not.toBeInTheDocument();
  });
  it('BUS-219: step 2 shows the shortcut once in a card, with no latch or raw-code wording', async () => {
    const user = userEvent.setup();
    renderWithApp(<Onboarding boundary={setupBoundary()} onClose={vi.fn()} progressStorage={{ read: () => JSON.stringify({ version: 1, step: 2 }), write: vi.fn() }} />);
    expect(screen.getByRole('heading', { name: /Your shortcut/ })).toBeInTheDocument();
    expect(screen.getByText('Hold these keys and talk, and Voxloom types your words where you’re writing. Keep them, or pick your own.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your shortcut Default' })).toBeInTheDocument();
    expect(screen.getAllByText('Control Shift Space')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Change shortcut' })).toHaveAccessibleDescription('Hold the keys while you talk. Let go when you’re done.');
    expect(screen.getByText('More ways to use it')).toBeInTheDocument();
    expect(screen.getByText('You can change this later in Settings.')).toBeInTheDocument();
    for (const gone of [/Global shortcut/, /Registered:/, /latch/i, /native binding/, /Reset to default/, /Prefer a single key/, /AltRight/]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    await waitFor(() => expect(screen.getByRole('button', { name: /Use this shortcut/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Change shortcut' }));
    expect(screen.getByRole('button', { name: 'Dictation shortcut, recording' })).toHaveFocus();
    await user.keyboard('{Escape}');
    // Esc ends recording; it must not close setup.
    expect(screen.getByRole('heading', { name: /Your shortcut/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change shortcut' })).toHaveFocus();
  });
  describe('BUS-251: Windows permission step', () => {
    const atPermissions = { read: () => JSON.stringify({ version: 1, step: 1 }), write: vi.fn() };
    it('shows Windows wording, offers no unverifiable buttons and lets setup continue', async () => {
      const io = setupBoundary();
      vi.mocked(io.query).mockResolvedValue({ microphone: 'unverified', accessibility: 'not-required' });
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={atPermissions} />);
      await waitFor(() => expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled());
      expect(screen.getByText('Not needed on Windows.')).toBeInTheDocument();
      expect(screen.getByText('Checked when you first dictate.')).toBeInTheDocument();
      expect(screen.queryByText('Allowed')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Ready to continue.' })).toBeVisible();
      await userEvent.click(screen.getByText('Microphone access on Windows'));
      expect(screen.getByText(/Windows has no typing permission to turn on/)).toBeInTheDocument();
      expect(screen.getByText(/open Windows Settings > Privacy & security > Microphone and turn on Microphone access and Let desktop apps access your microphone\./)).toBeInTheDocument();
      expect(screen.queryByText(/System Settings|macOS/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Allow Microphone|Open Accessibility Settings|Open Microphone Settings/ })).not.toBeInTheDocument();
      expect(io.request).not.toHaveBeenCalled();
      expect(io.openSettings).not.toHaveBeenCalled();
    });
    it('keeps the macOS wording and buttons when permissions are macOS states', async () => {
      const io = setupBoundary();
      vi.mocked(io.query).mockResolvedValue({ microphone: 'denied', accessibility: 'not-granted' });
      renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={atPermissions} />);
      expect(await screen.findByText('Not granted')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Allow microphone access.' })).toBeVisible();
      expect(screen.getByText(/In System Settings → Privacy & Security → Microphone/)).toBeVisible();
      expect(screen.queryByText(/Windows/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Allow Microphone' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open Microphone Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open Accessibility Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    });
  });
});
