/// Safety net after stop (BUS-255): never the fix for a long Large/Turbo job.
/// When the cap fires, deliver whatever text exists with a plain note. If
/// nothing is ready yet, transcription keeps running and a late result is
/// saved to History.

/** Wait after stop before the UI leaves the spinner. Not an STT abort. */
export const STOP_BUDGET_MS = 15_000;

export const STOP_TAKING_LONGER_SAVED =
  'Took too long to insert — saved to History and the clipboard.';

export const STOP_TAKING_LONGER_SAVED_HISTORY =
  'Took too long to insert — saved to History.';

export const STOP_TAKING_LONGER_PENDING =
  'This is taking longer than usual. It won’t be typed, but if transcription finishes, it will be saved to History.';

export const STOP_CANCELLED_SAVED =
  'Cancelled — saved to History and the clipboard.';

export const STOP_CANCELLED_SAVED_HISTORY =
  'Cancelled — saved to History.';

export const STOP_CANCELLED_PENDING =
  'Cancelled. If transcription finishes, it will be saved to History.';

export const STOP_LATE_SAVED = 'Your last dictation was saved to History.';

export const CAPTURE_CANCELLED_NOTHING =
  'Capture cancelled — nothing transcribed.';

export type StopNoteKind = 'cap' | 'cancel';

/** Plain status line after Escape or the safety net when text is already in hand. */
export function stopSavedNote(kind: StopNoteKind, copied: boolean): string {
  if (kind === 'cap') {
    return copied ? STOP_TAKING_LONGER_SAVED : STOP_TAKING_LONGER_SAVED_HISTORY;
  }
  return copied ? STOP_CANCELLED_SAVED : STOP_CANCELLED_SAVED_HISTORY;
}

/** Plain status line when the cap or Escape fires before any text is ready. */
export function stopPendingNote(kind: StopNoteKind): string {
  return kind === 'cap' ? STOP_TAKING_LONGER_PENDING : STOP_CANCELLED_PENDING;
}

/**
 * Time left for optional cleanup inside the overall stop budget. Cleanup is
 * already capped at 10s; this only shrinks that when STT used most of the
 * 15s window. Always at least 1ms so the stage can time out to raw text.
 */
export function remainingCleanupBudgetMs(
  startedAt: number,
  now: number = performance.now(),
  stopBudgetMs: number = STOP_BUDGET_MS,
  cleanupBudgetMs: number = 10_000,
): number {
  return Math.max(1, Math.min(cleanupBudgetMs, stopBudgetMs - (now - startedAt)));
}
