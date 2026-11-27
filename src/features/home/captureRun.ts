import { toastTone, type ToastTone } from '../../components/Toast';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';

/** Dictating from the window: the shared run, whether you can start one here, and Copy for diagnostics. */
export type CaptureProps = {
  dogfood: UseDogfoodCaptureResult;
  isNative: boolean;
  onCopy: (text: string) => void;
};

/** Where a run is: resting, taking your voice (Start or the shortcut, held or latched), or writing. */
export type RunState = 'idle' | 'recording' | 'busy';

export function runState(dogfood: UseDogfoodCaptureResult): RunState {
  if (dogfood.phase === 'recording' || dogfood.captureState.kind === 'active') return 'recording';
  if (dogfood.phase === 'transcribing' || dogfood.phase === 'cleaning') return 'busy';
  return 'idle';
}

/** A failed or cancelled run frays; otherwise the words decide, as they do for toasts. */
export function runTone(dogfood: UseDogfoodCaptureResult): ToastTone {
  return dogfood.phase === 'error' || dogfood.phase === 'cancelled' ? 'err' : toastTone(dogfood.message ?? '');
}

/** Only the Escape-cancellation diagnostic offers an explicit copy of its full text. */
export function hasDiagnostic(dogfood: UseDogfoodCaptureResult): boolean {
  return dogfood.phase === 'error' && Boolean(dogfood.message?.startsWith('Escape cancellation unavailable [cancel-'));
}

/** True when the run has something to show: controls while it runs, or what it did. */
export function runHasNews(dogfood: UseDogfoodCaptureResult): boolean {
  return runState(dogfood) !== 'idle' || Boolean(dogfood.message);
}
