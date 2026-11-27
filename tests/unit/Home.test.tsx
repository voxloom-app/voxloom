import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { Home } from '../../src/features/home/Home';
import { wovenRecords } from '../../src/features/home/pickWords';
import { isTauriEnv } from '../../src/services/capture/captureService';
import type { UseDogfoodCaptureResult } from
  '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

function stubDogfood(
  overrides: Partial<UseDogfoodCaptureResult> = {},
): UseDogfoodCaptureResult {
  return {
    cancel: vi.fn(),
    captureState: { kind: 'idle' },
    hudResult: null,
    intendedTarget: null,
    message: null,
    origin: null,
    phase: 'idle',
    scopeReady: false,
    hudReady: false,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    transcript: null,
    ...overrides,
  };
}

describe('Home', () => {
  it('limits earlier rows and reports copy success', async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    renderWithApp(<Home dogfood={stubDogfood()} onToast={toast} />);
    // The newest dictation leads the stage; the cloth lists the ones before it.
    const earlier = screen.getByRole('region', { name: 'Earlier dictations' });
    expect(within(earlier).getAllByRole('button', { name: 'Copy dictation' }))
      .toHaveLength(4);
    expect(within(earlier).getAllByText(/AM|PM/)).toHaveLength(4);
    await user.click(screen.getAllByRole('button', {
      name: 'Copy dictation',
    })[0]);
    expect(toast).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('reports injected clipboard failure', async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderWithApp(<Home dogfood={stubDogfood()} onToast={toast} />);
    await user.click(screen.getAllByRole('button', {
      name: 'Copy dictation',
    })[0]);
    expect(toast).toHaveBeenCalledWith('Copy failed');
  });

  it('leaves starting to your keys: the stage lays them on its loom, with a quiet Copy and no Start (ui-iter-33)', async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    vi.mocked(isTauriEnv).mockReturnValue(true);
    onTestFinished(() => { vi.mocked(isTauriEnv).mockReturnValue(false); });
    renderWithApp(<Home dogfood={stubDogfood()} onToast={toast} />);
    expect(screen.queryByRole('heading', { name: 'Dictate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
    const loom = document.querySelector('.home-hero .loom-bar') as HTMLElement;
    expect(within(loom).getByRole('heading', { level: 1 })).toHaveTextContent(/^Hold .* to dictate$/);
    // Copy is the last word on the pick's line, by mouse or keyboard.
    const copy = within(document.querySelector('.pick__meta') as HTMLElement).getByRole('button', { name: 'Copy last dictation' });
    expect(copy).toHaveTextContent('Copy');
    copy.focus();
    await user.keyboard('{Enter}');
    expect(toast).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('keeps Stop and Cancel off the stage while you speak; the rail\'s foot holds them', () => {
    renderWithApp(<Home dogfood={stubDogfood({ phase: 'recording' })} onToast={vi.fn()} />);
    const stage = document.querySelector('.stage') as HTMLElement;
    expect(stage).toHaveAttribute('data-phase', 'listening');
    expect(within(stage).queryByRole('button', { name: /Start dictating|Stop|Cancel/ })).not.toBeInTheDocument();
    expect(within(stage).getByRole('button', { name: 'Copy last dictation' })).toBeInTheDocument();
  });

  it('offers the run\'s transcript for manual recovery when History did not keep it', async () => {
    const user = userEvent.setup();
    const toast = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const text = 'Synthetic recovery sentence that History did not keep.';
    renderWithApp(<Home dogfood={stubDogfood({ transcript: { text } as UseDogfoodCaptureResult['transcript'] })} onToast={toast} />);
    const recovery = screen.getByRole('region', { name: 'Last transcript' });
    expect(recovery).toHaveTextContent(text);
    expect(recovery).toHaveTextContent('Available for manual recovery even when History retention is Off.');
    await user.click(within(recovery).getByRole('button', { name: 'Copy last transcript' }));
    expect(toast).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('shows the transcript once when it is already the last dictation', () => {
    let newest = '';
    function Probe() { newest = wovenRecords(useApp().state.records)[0]!.text; return null; }
    const { unmount } = renderWithApp(<Probe />);
    unmount();
    renderWithApp(<Home dogfood={stubDogfood({ transcript: { text: newest } as UseDogfoodCaptureResult['transcript'] })} onToast={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Last transcript' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy last transcript' })).not.toBeInTheDocument();
  });
});
