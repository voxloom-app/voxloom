/// Stop safety net (BUS-255): retain, pending notes, late History, and
/// the budget race. This is not an STT abort.

import type { DictationRecord, WritingStyle } from '../../domain/types';
import type { ClipboardAdapter } from '../clipboard';
import type { CaptureAudioMeta } from './dogfoodPath';
import type { DogfoodViewActions } from './dogfoodPhase';
import type { Cancellation } from './dogfoodSessionState';
import { retainTranscript } from './retainTranscript';
import {
  CAPTURE_CANCELLED_NOTHING,
  DELIVERY_IN_FLIGHT_GRACE_MS,
  STOP_LATE_NOTHING_SAVED,
  STOP_LATE_SAVED,
  stopPendingNote,
  stopSavedNote,
  type StopNoteKind,
} from './stopBudget';
import type { Transcript } from './types';

export interface StopBudgetRace {
  against<T>(work: Promise<T>): Promise<T | 'budget'>;
  clear(): void;
}

/**
 * Arm the cap from `startedAt` so pre-STT awaits (model, paste binding)
 * cannot skip it. `against` resolves `'budget'` if the timer fires first.
 */
export function startStopBudget(
  budgetMs: number,
  startedAt: number,
  now: () => number = () => performance.now(),
): StopBudgetRace {
  const remaining = Math.max(0, budgetMs - (now() - startedAt));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const cap = new Promise<'budget'>((resolve) => {
    timer = setTimeout(() => {
      settled = true;
      resolve('budget');
    }, remaining);
  });
  return {
    clear() {
      clearTimeout(timer);
    },
    against<T>(work: Promise<T>) {
      return new Promise<T | 'budget'>((resolve, reject) => {
        void cap.then((value) => resolve(value));
        work.then((result) => {
          if (!settled) resolve(result);
        }, reject);
      });
    },
  };
}

/** Arm a 10s timer when an insert/paste/Copy write starts. */
export function createDeliveryGrace(
  graceMs: number = DELIVERY_IN_FLIGHT_GRACE_MS,
): {
  arm(): void;
  clear(): void;
  promise: Promise<'grace'>;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = false;
  let resolveGrace: (value: 'grace') => void = () => {};
  const promise = new Promise<'grace'>((resolve) => {
    resolveGrace = resolve;
  });
  return {
    arm() {
      if (armed) return;
      armed = true;
      timer = setTimeout(() => resolveGrace('grace'), graceMs);
    },
    clear() {
      clearTimeout(timer);
    },
    promise,
  };
}

export interface SafetyNetInput {
  actions: Pick<
    DogfoodViewActions,
    'announce' | 'setHudResult' | 'setPhase' | 'setTranscript' | 'toast'
  >;
  audio: CaptureAudioMeta;
  cancellation: Cancellation;
  clipboard: () => ClipboardAdapter;
  clipboardFallback: () => boolean;
  modelId: () => string;
  now: () => number;
  onHistoryRecord: () => ((record: DictationRecord) => void) | undefined;
  ownsUi: () => boolean;
  /** Guided practice: never write the clipboard. */
  skipClipboard: boolean;
  /**
   * Guided practice: match main's Escape-after-stop — no History row,
   * and the status must not claim one was saved. A cap or Escape ends on
   * the same cancelled state, with no pending note or late toast.
   */
  skipHistory: boolean;
  style: WritingStyle;
}

export interface SafetyNet {
  finishLate(
    work: Promise<{ transcript?: Transcript }>,
    settle: () => Promise<void>,
    release: () => Promise<void>,
  ): void;
  retain(
    transcript: Transcript,
    mode: 'cap' | 'cancel' | 'late',
  ): Promise<void>;
  showPending(mode: StopNoteKind): void;
  toastIfPendingFailed(): void;
  wireRetainOnCancel(
    latestText: () => Transcript | undefined,
    finished: () => boolean,
  ): void;
}

export function createSafetyNet(input: SafetyNetInput): SafetyNet {
  const { actions, cancellation } = input;
  let pendingShown = false;

  /** Guided practice ends here: main's Escape state, never a History promise. */
  const showGuidedCancelled = () => {
    if (!input.ownsUi()) return;
    actions.setPhase('cancelled');
    actions.announce(CAPTURE_CANCELLED_NOTHING);
  };

  const retain = async (
    transcript: Transcript,
    mode: 'cap' | 'cancel' | 'late',
  ) => {
    if (cancellation.retained || !transcript.text.trim()) return;
    if (input.skipHistory) {
      // Guided practice: no History row and no clipboard. End on the same
      // terminal state as Escape so no spinner stays up after a cap.
      if (mode !== 'late') showGuidedCancelled();
      return;
    }
    cancellation.retained = true;
    const copyToClipboard = mode !== 'late'
      && input.ownsUi()
      && !input.skipClipboard
      && !cancellation.deliveryInFlight
      && input.clipboardFallback();
    const status = await retainTranscript({
      clipboard: input.clipboard(),
      copyToClipboard,
      durationMs: input.audio.duration_ms,
      id: `dogfood-${input.audio.id}`,
      model: input.modelId(),
      now: input.now(),
      onHistoryRecord: input.onHistoryRecord(),
      rawText: transcript.rawText,
      style: input.style,
      text: transcript.text,
    });
    if (mode === 'late') {
      actions.toast(STOP_LATE_SAVED);
      return;
    }
    if (!input.ownsUi()) return;
    actions.setTranscript(transcript);
    if (mode === 'cap') {
      actions.setHudResult(status === 'copied' ? 'copied' : null);
      actions.setPhase('success');
      actions.announce(stopSavedNote('cap', status === 'copied'));
    } else {
      actions.setPhase('cancelled');
      actions.announce(stopSavedNote('cancel', status === 'copied'));
    }
  };

  const showPending = (mode: StopNoteKind) => {
    cancellation.suppressDelivery = true;
    if (input.skipHistory) {
      // Nothing will be saved, so never promise History or toast later.
      showGuidedCancelled();
      return;
    }
    pendingShown = true;
    if (!input.ownsUi()) return;
    if (mode === 'cap') {
      actions.setHudResult(null);
      actions.setPhase('success');
      actions.announce(stopPendingNote('cap'));
    } else {
      actions.setPhase('cancelled');
      actions.announce(stopPendingNote('cancel'));
    }
  };

  const toastIfPendingFailed = () => {
    if (input.skipHistory || !pendingShown || cancellation.retained) return;
    actions.toast(STOP_LATE_NOTHING_SAVED);
  };

  return {
    retain,
    showPending,
    toastIfPendingFailed,
    finishLate(work, settle, release) {
      void work.then(async (value) => {
        await settle();
        if (value?.transcript?.text.trim() && !cancellation.retained
          && !input.skipHistory) {
          await retain(value.transcript, 'late');
          return;
        }
        toastIfPendingFailed();
      }).catch(() => {
        toastIfPendingFailed();
      }).finally(() => {
        void release();
      });
    },
    wireRetainOnCancel(latestText, finished) {
      cancellation.retainOnCancel = () => {
        if (input.skipHistory) {
          showGuidedCancelled();
          return;
        }
        const transcript = latestText();
        if (transcript?.text.trim()) {
          void retain(transcript, 'cancel');
        } else if (!finished()) {
          showPending('cancel');
        }
      };
    },
  };
}
