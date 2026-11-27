import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunOutcome } from '../../src/features/home/RunOutcome';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';

vi.mock('../../src/app/AppContext', () => ({
  useApp: () => ({ state: { settings: { transcriptionModel: 'tiny', clipboardFallback: true } } }),
}));

function failure(message: string): UseDogfoodCaptureResult {
  return {
    phase: 'error', message, captureState: { kind: 'idle' },
    scopeReady: false, hudReady: false, intendedTarget: null, hudResult: null, origin: 'gesture',
    transcript: null, cancel: vi.fn(), start: vi.fn(), stop: vi.fn(),
  };
}

describe('cancellation diagnostics on the run\'s outcome tag', () => {
  it.each(['cancel-ax-untrusted', 'cancel-tap-create-failed'])(
    'lets the user explicitly copy the complete %s error, never automatically', (code) => {
      const message = `Escape cancellation unavailable [${code}]. (ax=true listen=false post=true; app=com.voxloom.prototype version=0.1.0)`;
      const onCopy = vi.fn();
      render(<RunOutcome dogfood={failure(message)} onCopy={onCopy} />);
      expect(screen.getByRole('status')).toHaveTextContent(message);
      expect(onCopy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }));
      expect(onCopy).toHaveBeenCalledExactlyOnceWith(message);
    },
  );

  it('does not offer diagnostic copying for unrelated status text', () => {
    render(<RunOutcome dogfood={failure('Model not downloaded')} onCopy={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Copy error details' })).not.toBeInTheDocument();
  });
});
