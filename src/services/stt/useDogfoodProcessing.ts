/// Post-stop processing for dogfood capture: STT → optional local cleanup
/// (BUS-16) → delivery → History record. Runs on every clean stop (user stop
/// or the 120s/capacity bound) with the same completion-time target policy
/// (ADR §4).
///
/// A 15s safety net (BUS-255) is not an STT abort: when it fires, any text
/// already in hand is saved to History and the clipboard with a plain note.
/// If nothing is ready yet, transcription keeps running and a late result is
/// saved to History. Escape during processing does the same. If delivery
/// has already started, the cap leaves that outcome alone.

import { useCallback, useEffect, useRef } from 'react';
import { createDogfoodRecord } from '../../domain/records';
import type { CaptureState } from '../capture/types';
import type { ClipboardAdapter } from '../clipboard';
import type { CleanupEngine } from '../cleanup/contracts';
import {
  createStubDeliveryAdapter,
  createTauriDeliveryAdapter,
  type DeliveryPlatformAdapter,
  type PasteBinding,
} from '../delivery';
import { prepareDogfoodCleanup } from './dogfoodCleanup';
import { errorText } from './dogfoodModel';
import { dogfoodTranscribeAndCopy, type CaptureAudioMeta } from './dogfoodPath';
import { hudResultFor, type DogfoodViewActions } from './dogfoodPhase';
import type { DogfoodLiveSession } from './dogfoodSessionState';
import { remainingCleanupBudgetMs, STOP_BUDGET_MS, CAPTURE_CANCELLED_NOTHING } from './stopBudget';
import { createSafetyNet, startStopBudget } from './stopSafetyNet';
import type { Transcript } from './types';
import type { UseDogfoodCaptureOptions } from './useDogfoodCapture';

function resolvePlatform(
  clipboard: ClipboardAdapter,
  injected?: DeliveryPlatformAdapter,
): DeliveryPlatformAdapter {
  if (injected) return injected;
  try {
    return createTauriDeliveryAdapter(clipboard);
  } catch {
    return createStubDeliveryAdapter({ clipboard });
  }
}

export interface DogfoodProcessingInput {
  actions: DogfoodViewActions;
  captureState: CaptureState;
  cleanupEngine: () => CleanupEngine;
  /** Resolves the selected model id or throws `model-missing`. */
  ensureModel: () => Promise<string>;
  live: DogfoodLiveSession;
  options: UseDogfoodCaptureOptions;
}

export function useDogfoodProcessing({
  actions, captureState, cleanupEngine, ensureModel, live, options,
}: DogfoodProcessingInput): () => Promise<PasteBinding | null> {
  // Latest render's options, read when each step of a run needs them.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const platformRef = useRef<DeliveryPlatformAdapter>(
    resolvePlatform(options.clipboard, options.deliveryPlatform),
  );
  platformRef.current = resolvePlatform(
    options.clipboard,
    options.deliveryPlatform,
  );

  // Called by start(): the paste terminal in front right now. Any failure or
  // missing support reads as "none", so delivery behaves as before the paste route.
  const lookupPasteBinding = useCallback(async (): Promise<PasteBinding | null> => {
    try {
      return (await platformRef.current.pasteBinding?.()) ?? null;
    } catch {
      return null;
    }
  }, []);

  const runDogfood = useCallback(async (audio: CaptureAudioMeta) => {
    const { announce, setHudResult, setIntendedTarget, setMessage, setPhase, setTranscript, toast } = actions;
    const session = live.session;
    const startBinding = live.pasteBinding;
    const cancellation = live.cancellation;
    const guard = cancellation.deliveryGuard;
    cancellation.transcribing = true;
    cancellation.retained = false;
    cancellation.suppressDelivery = cancellation.cancelled;
    cancellation.deliveryInFlight = false;
    let latestText: Transcript | undefined;
    const current = () => session === live.session && !cancellation.cancelled;
    const canDeliver = () =>
      current() && !cancellation.suppressDelivery && (!guard || guard.current());
    // Cancel bumps `session` immediately; identity of this cancellation still
    // owns the status line until a newer start replaces it.
    const ownsUi = () => live.cancellation === cancellation;
    const platform = platformRef.current;
    let settlement: Promise<void> | undefined;
    // Both STT success and failure must consult the native latch, whose
    // notification may still be queued. Share the barrier so it runs once.
    const settleCancellation = () => settlement ??= (async () => {
      if (cancellation.cancelled) return;
      const scope = cancellation.scope;
      if (scope) {
        let accepted = false;
        try { accepted = await scope.finish(); } catch { /* fail closed */ }
        if (!accepted) {
          cancellation.cancelled = true;
          if (session === live.session) live.cancelAction();
          return;
        }
      }
      if (current()) live.active = false;
    })();
    cancellation.settle = settleCancellation;
    const processing = new AbortController();
    live.processing = processing;
    let stopWaitingForBinding: (() => void) | undefined;
    let lateInFlight = false;
    let finished = false;
    const startedAt = performance.now();
    // Arm before ensureModel / paste-binding awaits so a stall cannot skip the cap.
    const budget = startStopBudget(STOP_BUDGET_MS, startedAt);
    // Snapshot at stop: a settings change mid-dictation applies to the next
    // one. The same style goes to cleanup and onto the History row.
    const latest = optionsRef.current;
    const style = latest.style ?? 'formal';
    let modelId = cancellation.modelId ?? 'unknown';

    const safety = createSafetyNet({
      actions,
      audio,
      cancellation,
      clipboard: () => optionsRef.current.clipboard,
      clipboardFallback: () => optionsRef.current.clipboardFallback !== false,
      modelId: () => modelId,
      now: () => (optionsRef.current.now ?? Date.now)(),
      onHistoryRecord: () => optionsRef.current.onHistoryRecord,
      ownsUi,
      skipClipboard: Boolean(guard),
      style,
    });
    safety.wireRetainOnCancel(() => latestText, () => finished);

    const releaseResources = async () => {
      if (stopWaitingForBinding) {
        processing.signal.removeEventListener('abort', stopWaitingForBinding);
      }
      await cancellation.preparation?.release(audio.id).catch(() => {});
      if (live.processing === processing) live.processing = null;
      await cancellation.scope?.dispose().catch(() => {});
    };

    const cleanup = prepareDogfoodCleanup({
      controller: processing,
      engine: cleanupEngine,
      onStart: () => {
        if (!ownsUi() || cancellation.suppressDelivery) return;
        setPhase('cleaning');
        announce('Cleaning up…');
      },
      requestId: `cleanup-${audio.id}`,
      settings: {
        active: latest.cleanupActive === true,
        dictionary: latest.dictionary ?? [],
        modelId: latest.cleanupModelId ?? null,
        style,
      },
      timeoutMs: () => remainingCleanupBudgetMs(startedAt, performance.now()),
      userCancelled: () => cancellation.cancelled,
    });
    // Escape in the stop→stopped gap already cancelled; do not clobber the
    // cancelled phase with "Transcribing…". Still run STT for History.
    if (cancellation.cancelled) {
      safety.showPending('cancel');
    } else {
      setPhase('transcribing');
      announce('Transcribing…');
    }
    try {
      modelId = cancellation.modelId ?? await ensureModel();
      // Escape after stop must still start STT so a late result can reach History.
      // Abort (cancel or supersede) stops waiting on a stalled start-binding
      // lookup, so a prepared request's stopped PCM is never held behind it.
      const binding = cancellation.preparation
        ? Promise.race([startBinding, new Promise<null>((resolve) => {
          stopWaitingForBinding = () => resolve(null);
          processing.signal.addEventListener('abort', stopWaitingForBinding, { once: true });
        })])
        : startBinding;
      const pasteBinding = (await binding) ?? null;
      const dogfood = optionsRef.current.dogfood ?? dogfoodTranscribeAndCopy;
      const dogfoodPromise = dogfood({
        audio,
        cleanup: cleanup.stage,
        clipboard: optionsRef.current.clipboard,
        clipboardFallback: optionsRef.current.clipboardFallback !== false,
        deliveryPlatform: platform,
        dictionary: latest.dictionary,
        isCurrent: canDeliver,
        onlyOwnField: Boolean(guard),
        insertOwnField: guard ? (text) => guard.insert(text) : undefined,
        pasteBinding,
        beforeDelivery: async () => {
          if (guard && !(await guard.validate())) throw new Error('Setup access or voice pack changed. Check again before retrying.');
          await settleCancellation();
        },
        snapshotTarget: async () => {
          const target = await platform.snapshotTarget();
          if (current()) setIntendedTarget(target);
          return target;
        },
        modelId,
        onDeliveryStart: () => { cancellation.deliveryInFlight = true; },
        onTranscript: (transcript) => { latestText = transcript; },
        requestId: cancellation.preparation?.requestId,
      });

      let outcome = await budget.against(dogfoodPromise);
      // An in-flight insert or paste must finish on its own. The cap must
      // not retain, copy, or suppress that delivery.
      if (outcome === 'budget' && cancellation.deliveryInFlight) {
        outcome = await dogfoodPromise;
      }

      if (outcome === 'budget') {
        budget.clear();
        cancellation.suppressDelivery = true;
        // Abort cleanup and delivery only. Do not cancel native STT.
        processing.abort();
        await settleCancellation();
        if (!cancellation.cancelled) {
          if (latestText?.text.trim()) {
            await safety.retain(latestText, 'cap');
          } else {
            safety.showPending('cap');
          }
        }
        lateInFlight = true;
        safety.finishLate(dogfoodPromise, settleCancellation, releaseResources);
        return;
      }

      budget.clear();
      finished = true;
      // A stale successful path skips beforeDelivery, but still needs the
      // saved cancellation decision before publishing History or a toast.
      await settleCancellation();
      if (cancellation.retained) return;
      if (cancellation.cancelled || cancellation.suppressDelivery) {
        if (outcome.transcript.text.trim()) {
          await safety.retain(
            outcome.transcript,
            ownsUi() && cancellation.cancelled && !cancellation.suppressDelivery
              ? 'cancel'
              : 'late',
          );
        } else {
          safety.toastIfPendingFailed();
        }
        return;
      }
      if (current()) {
        guard?.result(outcome);
        setTranscript(outcome.transcript);
        setHudResult(hudResultFor(outcome.delivery));
        setPhase('success');
      }
      const provenance = await cleanup.provenance(outcome.cleanup);
      const record = createDogfoodRecord({
        cleanup: provenance,
        durationMs: audio.duration_ms,
        id: `dogfood-${audio.id}`,
        mayHaveInserted: outcome.delivery.mayHaveInserted,
        model: modelId,
        now: (optionsRef.current.now ?? Date.now)(),
        rawText: outcome.transcript.rawText,
        status: outcome.delivery.status,
        style,
        text: outcome.transcript.text,
      });
      if (record) {
        cancellation.retained = true;
        optionsRef.current.onHistoryRecord?.(record);
      }
      // Stale session: evidence still surfaces as a toast, phase untouched.
      // An empty message is a clean terminal paste: silent, no status line, no
      // toast (History keeps the Unverified record). Clear the stale status.
      const said = outcome.delivery.message;
      if (!said) {
        if (current()) setMessage(null);
      } else if (current()) announce(said);
      else toast(said);
    } catch (error: unknown) {
      finished = true;
      await settleCancellation();
      if (cancellation.cancelled || cancellation.suppressDelivery) {
        safety.toastIfPendingFailed();
        return;
      }
      if (current()) {
        setHudResult('transcribe-failed');
        setPhase('error');
        announce(errorText(error));
      } else {
        toast(errorText(error));
      }
    } finally {
      budget.clear();
      if (!lateInFlight) await releaseResources();
    }
  }, [actions, cleanupEngine, ensureModel, live]);

  useEffect(() => {
    const { announce, setMessage, setPhase } = actions;
    if (captureState.kind === 'cancelled') {
      // Escape after stop keeps the in-flight run; do not overwrite its note.
      if (live.cancellation.transcribing || live.cancellation.captureStopped) return;
      setPhase('cancelled');
      setMessage(CAPTURE_CANCELLED_NOTHING);
      return;
    }
    if (captureState.kind === 'error') {
      setPhase('error');
      setMessage(captureState.message);
      return;
    }
    if (captureState.kind !== 'stopped') return;
    const audio = captureState.audio;
    if (!audio) {
      setPhase('error');
      announce('Capture stopped without audio — nothing to transcribe.');
      return;
    }
    if (live.handledAudioId === audio.id) return;
    live.handledAudioId = audio.id;
    // Guided practice consumes only audio from its own guarded session.
    const unowned = optionsRef.current.ownedCaptureOnly === true
      && !live.cancellation.deliveryGuard;
    if (unowned) {
      void live.cancellation.preparation?.release(audio.id).catch(() => {});
      return;
    }
    if (live.cancellation.cancelled && !live.cancellation.captureStopped
      && !live.cancellation.transcribing) {
      // Cancelled while listening: a late stopped event must dispose PCM
      // without starting STT.
      void live.cancellation.preparation?.release(audio.id).catch(() => {});
      return;
    }
    void runDogfood(audio);
  }, [actions, captureState, live, runDogfood]);

  return lookupPasteBinding;
}
