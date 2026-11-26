import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Home } from '../../src/features/home/Home';
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

  it('shows the Dictate capture panel on Home', () => {
    renderWithApp(<Home dogfood={stubDogfood()} onToast={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start capture' })).toBeDisabled();
    expect(screen.getByText(/Native capture requires the Tauri shell/i))
      .toBeInTheDocument();
  });
});
