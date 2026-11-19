/// Safety net after stop (BUS-255): never the fix for a long Large/Turbo job.
/// When the cap fires, deliver whatever text exists with a plain note. If
/// nothing is ready yet, transcription keeps running and a late result is
/// saved to History.

/** Wait after stop before the UI leaves the spinner. Not an STT abort. */
export const STOP_BUDGET_MS = 15_000;

/**
 * Time reserved after cleanup so a raw-text insert (or terminal paste,
 * including the clipboard-restore paste fallback) can still start before
 * the 15s safety net. Two seconds covers a typical AX insert or paste
 * plus restore without eating the whole leftover window; cleanup already
 * has its own 10s cap. The 15s cap remains the UI deadline.
 */
export const CLEANUP_DELIVERY_MARGIN_MS = 2_000;

/**
 * After an insert, terminal paste, or Copy write starts, how long to wait
 * for that in-flight delivery to settle. If it has not, retain to History
 * only — never the clipboard, because a paste may still be using it.
 */
export const DELIVERY_IN_FLIGHT_GRACE_MS = 10_000;

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

export const STOP_LATE_NOTHING_SAVED =
  'Your last dictation didn’t come through — nothing was saved.';

/** Guided practice only: the 15s cap fired. Nothing is typed or saved. */
export const GUIDED_CAP_NOTHING_SAVED =
  'That took too long — nothing was typed or saved. Try again.';

/** Guided practice only: Escape after stop. Nothing is typed or saved. */
export const GUIDED_ESCAPE_NOTHING_SAVED =
  'Practice cancelled — nothing was typed or saved.';

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
 * Time left for optional cleanup inside the overall stop budget, after
 * reserving the delivery margin. Cleanup is already capped at 10s; this
 * only shrinks that when STT used most of the 15s window. Always at least
 * 1ms so the stage can time out to raw text and still insert before the cap.
 */
export function remainingCleanupBudgetMs(
  startedAt: number,
  now: number = performance.now(),
  stopBudgetMs: number = STOP_BUDGET_MS,
  cleanupBudgetMs: number = 10_000,
  deliveryMarginMs: number = CLEANUP_DELIVERY_MARGIN_MS,
): number {
  return Math.max(
    1,
    Math.min(
      cleanupBudgetMs,
      stopBudgetMs - deliveryMarginMs - (now - startedAt),
    ),
  );
}
