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

  it('puts Start dictating back on the stage, beside the last pick\'s Copy (ui-iter-21)', async () => {
    const user = userEvent.setup();
    const dogfood = stubDogfood();
    vi.mocked(isTauriEnv).mockReturnValue(true);
    onTestFinished(() => { vi.mocked(isTauriEnv).mockReturnValue(false); });
    renderWithApp(<Home dogfood={dogfood} onToast={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Dictate' })).not.toBeInTheDocument();
    const weft = document.querySelector('.home-hero .loom-bar') as HTMLElement;
    const start = within(weft).getByRole('button', { name: 'Start dictating' });
    expect(within(weft).getByRole('button', { name: 'Copy last dictation' })).toBeInTheDocument();
    expect(start.compareDocumentPosition(within(weft).getByRole('button', { name: 'Copy last dictation' })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(start);
    expect(dogfood.start).toHaveBeenCalledOnce();
  });

  it('swaps Start for Stop and Cancel on the stage while you speak', () => {
    renderWithApp(<Home dogfood={stubDogfood({ phase: 'recording' })} onToast={vi.fn()} />);
    const weft = document.querySelector('.home-hero .loom-bar') as HTMLElement;
    expect(within(weft).queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
    expect(within(weft).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(within(weft).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
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
