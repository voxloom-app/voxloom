import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useDogfoodCapture } from '../../services/stt/useDogfoodCapture';
import type { OwnFieldDeliveryGuard } from '../../services/stt/dogfoodPath';
import { resolveTranscriptionModelId } from '../../services/stt/resolveModelId';
import { STT_MODEL_CATALOG } from '../../services/stt/types';
import { subscribe as subscribeSettings } from '../../services/settingsWindow';
import { listenShortcutBound } from '../../services/shortcut/bindingEvents';
import { listenModelsChanged } from '../../services/stt/modelsChanged';
import { createOverlayBridge } from '../../services/shortcut';
import { createGuidedSetup, permissionsClear, type PermissionKind, type SetupBoundary, type SetupProgressStorage } from './guidedSetup';
import { registerPracticeHandler, resetPracticeGestures } from './practiceBridge';
import { LoomLine } from './LoomLine';
import { createSetupBoundary } from './setupBoundary';
import { SetupThread } from './SetupThread';
import { ConnectionStep } from './ConnectionStep';
import { PracticeStep, practiceLook } from './PracticeStep';
import { ShortcutStep } from './ShortcutStep';
import { SetupWindow } from './SetupWindow';
import { SetupBrand, WelcomeCover } from './WelcomeCover';

interface OnboardingProps {
  onClose: () => void;
  opener?: HTMLElement | null;
  /** OS boundary and isolated progress store for safe component tests. */
  boundary?: SetupBoundary;
  progressStorage?: SetupProgressStorage;
}
const PROGRESS_KEY = 'voxloom.guided-setup.v1';
const localProgress: SetupProgressStorage = {
  read: () => localStorage.getItem(PROGRESS_KEY),
  write: (value) => localStorage.setItem(PROGRESS_KEY, value),
  clear: () => localStorage.removeItem(PROGRESS_KEY),
};
/** Reopening setup starts the tutorial over; Resume setup keeps unfinished progress. */
export function clearGuidedProgress(): void {
  try { localProgress.clear?.(); } catch { /* Unavailable storage has nothing to resume. */ }
}
/** The other gesture than this try expects: say which one it wants instead of ignoring it. */
const wrongGesture = {
  hold: 'That was a double-tap. For this try, hold your shortcut, speak, then release.',
  tap: 'That was a hold. For this try, double-tap your shortcut, speak, then press it once to finish.',
} as const;

/** Do not construct the controller or expose setup actions against boot defaults. */
export function Onboarding(props: OnboardingProps) {
  const { bootReady } = useApp();
  if (!bootReady) return <SetupWindow onEscape={props.onClose} opener={props.opener}>
    <div className="setup-window__loading"><p role="status">Loading your saved setup…</p><button className="btn ghost" onClick={props.onClose} type="button">Set up later</button></div>
  </SetupWindow>;
  return <HydratedOnboarding {...props} />;
}

/** Approved B / v3: a setup spine, two permissions and two real tries in one note. */
function HydratedOnboarding({ onClose, opener, boundary, progressStorage }: OnboardingProps) {
  const { clipboard, settings, setup, state } = useApp();
  const latest = useRef(state.settings);
  latest.current = state.settings;
  const [io] = useState(() => boundary ?? createSetupBoundary());
  const [controller] = useState(() => createGuidedSetup(io,
    () => resolveTranscriptionModelId(latest.current.transcriptionModel),
    () => latest.current.shortcut, progressStorage ?? localProgress));
  const guided = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [error, setError] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const guard = useRef<OwnFieldDeliveryGuard | undefined>(undefined);
  const sequence = useRef(0);
  const pending = useRef(false);
  // A practice capture was started and has not reached a result yet.
  const capturing = useRef(false);
  const practice = useDogfoodCapture({
    clipboard, clipboardFallback: false, cleanupActive: false, ownedCaptureOnly: true,
    modelId: state.settings.transcriptionModel,
    preferredDeviceId: state.settings.microphone,
    deliveryGuard: () => guard.current,
  });
  const live = useRef(practice);
  live.current = practice;
  const busy = pending.current || ['starting', 'recording', 'transcribing', 'cleaning'].includes(practice.phase);
  const modelId = resolveTranscriptionModelId(state.settings.transcriptionModel);
  const model = STT_MODEL_CATALOG.find((item) => item.id === modelId);
  const modelLabel = model?.label ?? modelId;
  const size = model ? `${Math.round(model.sizeBytes / 1_000_000)} MB` : 'size shown in Settings';

  function cancel() {
    sequence.current++;
    pending.current = false;
    setHint(null);
    controller.cancelPractice();
    guard.current = undefined;
    // Only a live capture is cancelled: after a result, Try double-tap/Back
    // must not replace it with "Capture cancelled — nothing transcribed."
    if (capturing.current || ['starting', 'recording', 'transcribing', 'cleaning'].includes(live.current.phase)) live.current.cancel();
    capturing.current = false;
    resetPracticeGestures();
  }
  function close() { cancel(); onClose(); }
  async function action(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); } catch (e) { setError(String(e)); }
  }
  async function permission(kind: PermissionKind, settingsOnly = false) {
    await action(async () => {
      cancel();
      if (settingsOnly) await io.openSettings(kind); else await io.request(kind);
      await controller.refresh();
    });
  }

  useEffect(() => {
    heading.current?.focus();
    setup.update({ step: guided.step === 3 ? 3 : guided.step >= 2 ? 2 : 1 });
  }, [guided.step, setup]);
  useEffect(() => {
    controller.cancelPractice();
    sequence.current++;
    pending.current = false;
    if (['starting', 'recording', 'transcribing', 'cleaning'].includes(live.current.phase)) live.current.cancel();
    resetPracticeGestures();
    void controller.refresh();
  }, [controller, state.settings.transcriptionModel, state.settings.shortcut]);
  useEffect(() => {
    const recheck = () => { void controller.refresh(); };
    const onReturn = () => { if (document.visibilityState !== 'hidden') recheck(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    const bound = subscribeSettings(() => listenShortcutBound(recheck));
    const changed = subscribeSettings(() => listenModelsChanged(recheck));
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      bound(); changed();
    };
  }, [controller]);
  useEffect(() => {
    if (!guided.downloading || guided.step === 0) return;
    const timer = window.setInterval(() => { void controller.refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [controller, guided.downloading, guided.step]);
  useEffect(() => registerPracticeHandler((gesture) => {
    if (controller.getSnapshot().step !== 3) return;
    if (gesture === 'hold-start' || gesture === 'latch-start') {
      if (pending.current || ['starting', 'recording', 'transcribing', 'cleaning'].includes(live.current.phase)) return;
      const mode = gesture === 'hold-start' ? 'hold' : 'tap';
      const expected = controller.getSnapshot().mode;
      // A start that will not become a try must not leave the gesture machine
      // latched/holding: a stray latch would turn the next hold into its finish.
      if (mode !== expected) { setHint(wrongGesture[expected]); resetPracticeGestures(); return; }
      setHint(null);
      const own = ++sequence.current;
      pending.current = true;
      void controller.begin(mode).then(async (lease) => {
        if (!lease || own !== sequence.current) {
          if (own === sequence.current) { pending.current = false; resetPracticeGestures(); }
          return;
        }
        guard.current = {
          current: () => controller.current(lease),
          validate: async () => (await controller.refresh()) && controller.current(lease),
          insert: (text) => controller.insert(lease, text, field.current),
          result: (result) => controller.result(lease, result),
        };
        pending.current = false;
        capturing.current = true;
        await live.current.start('gesture');
      }).catch((e: unknown) => { pending.current = false; setError(String(e)); });
    } else if (gesture === 'hold-finish' || gesture === 'latch-finish') {
      if (pending.current) { sequence.current++; pending.current = false; controller.cancelPractice(); }
      else void live.current.stop().catch((e: unknown) => setError(String(e)));
    }
  }), [controller]);
  useEffect(() => {
    if (practice.phase === 'cancelled' || practice.phase === 'error' || practice.phase === 'success') {
      capturing.current = false;
      controller.cancelPractice();
      resetPracticeGestures();
    }
  }, [controller, practice.phase]);
  useEffect(() => {
    if (!io.native) return;
    const overlay = createOverlayBridge();
    overlayRef.current = overlay;
    return () => { overlayRef.current = null; void overlay.dispose(); };
  }, [controller, io]);
  const overlayRef = useRef<ReturnType<typeof createOverlayBridge> | null>(null);
  useEffect(() => {
    const phase = practice.phase;
    const visual = phase === 'transcribing' || phase === 'cleaning'
      ? { kind: 'processing' as const, completion: 'held' as const, runId: -1 }
      : phase === 'recording' || phase === 'starting'
        ? { kind: 'listening' as const, runId: -1, waveform: 'speaking' as const }
        : { kind: 'ready' as const };
    void overlayRef.current?.sync(practice.hudReady ? visual : { kind: 'ready' }, false, practice.scopeReady);
  }, [practice.phase, practice.hudReady, practice.scopeReady]);
  useEffect(() => () => { sequence.current++; controller.cancelPractice(); }, [controller]);

  const allPermissions = permissionsClear(guided.permissions);
  const connected = io.native && allPermissions && guided.modelReady && !guided.checking;
  const both = guided.holdDone && guided.tapDone;
  // Step 4 not ready shows a specific error in place of its attention line, so it is never shown twice.
  const shownError = error || guided.error;
  // A success only belongs to this way once its try is tied off; after Try double-tap,
  // the hold's result is history, so the note goes back to waiting.
  const counted = guided.mode === 'tap' ? guided.tapDone : guided.holdDone;
  const stale = practice.phase === 'success' && !counted;
  const look = practiceLook(practice.phase, counted, hint !== null);
  const status = practice.phase === 'recording' ? (guided.mode === 'tap' ? 'Listening hands-free · press once to finish' : 'Listening · release to finish')
    : practice.phase === 'starting' ? 'Preparing microphone…'
      : practice.phase === 'transcribing' || practice.phase === 'cleaning' ? 'Transcribing…'
        : hint ?? (look === 'done' ? `Inserted. ${guided.mode === 'tap' ? 'Hands-free' : 'Hold to talk'} works.` : stale ? null : practice.message) ?? 'Ready when you are';
  // Say why the primary action is still waiting, beside it, instead of a dead button.
  const waiting = guided.step === 2 ? (guided.ready ? '' : 'Waiting for your shortcut to be ready')
    : guided.step === 3 && guided.mode === 'hold' ? (!guided.holdDone ? 'Opens after one hold-to-talk try' : busy ? 'Opens when this try ends' : '')
      : guided.step === 3 ? (!guided.tapDone ? 'Opens after one hands-free try' : !guided.ready ? 'Waiting for access and the voice pack' : busy ? 'Opens when this try ends' : '')
        : '';
  const next = () => action(async () => { cancel(); await controller.next(); });
  const finish = () => action(async () => {
    if (await controller.finish()) { controller.clearProgress(); setup.update({ complete: true }); close(); }
  });

  return <SetupWindow onEscape={() => { if (pending.current || ['starting', 'recording', 'transcribing', 'cleaning'].includes(live.current.phase)) cancel(); else close(); }} opener={opener}>
    <div className="guided-setup" data-step={guided.step}>
      {guided.step > 0 && <aside className="guided-rail" aria-label="Setup progress">
        <SetupBrand />
        <SetupThread guided={guided} shortcut={state.settings.shortcut} />
        <div className="guided-private">PRIVATE BY DESIGN<br /><span>On-device dictation.<br />No account. No cloud model.</span></div>
      </aside>}
      {/* ui-iter-07: the content column is the loom's stage, in both themes. */}
      <div className="guided-main stage">
        <section className="guided-content" aria-labelledby="guided-heading" tabIndex={0}>
          {guided.step === 0 ? <WelcomeCover heading={heading} shortcut={state.settings.shortcut} /> : guided.step === 2 ?
            <ShortcutStep heading={heading} onChange={(value) => settings.update({ key: 'shortcut', value })} shortcut={state.settings.shortcut} /> : guided.step === 3 ?
            <PracticeStep attempted={hint !== null || ['success', 'error', 'cancelled'].includes(practice.phase)} busy={busy} field={field} heading={heading}
              holdDone={guided.holdDone} look={look} mode={guided.mode} onCheck={() => void action(controller.refresh)}
              onRetry={() => { cancel(); field.current?.focus(); }} ready={guided.ready} shortcut={state.settings.shortcut} status={status} tapDone={guided.tapDone} /> : guided.step === 1 ?
            <ConnectionStep guided={guided} heading={heading} modelLabel={modelLabel} size={size} connected={connected} native={io.native} error={shownError}
              permission={permission} refresh={() => void action(controller.refresh)} download={() => void action(controller.download)}
              cancelDownload={id => void action(() => io.cancelDownload(id))} /> : <>
            <div className="guided-kicker">Ready for your next thought</div>
            <div className="guided-hero"><h2 id="guided-heading" ref={heading} tabIndex={-1}>You speak.<br />Voxloom types.</h2><LoomLine /></div>
          </>}
          {guided.step === 4 && <>
            <p className="guided-intro">You’ve tried both ways to dictate. Choose Open Voxloom to finish, then use your shortcut in any app.</p>
            {!guided.ready && <>
              <p className="form-error" role="alert">{shownError || 'Access or the voice pack needs attention before you finish.'}</p>
              <button className="btn" onClick={() => { cancel(); controller.back(); controller.back(); controller.back(); }} type="button">Review access and voice pack</button>
            </>}
            <div className="guided-shortcut"><KeyCombo combo={state.settings.shortcut} /><ul aria-label="Two ways to use it">
              <li><b>Hold</b> for a quick thought.</li>
              <li><b>Double-tap</b> to go hands-free. Press once more to finish.</li>
            </ul></div>
            <p className="guided-mini">Your shortcut works in other apps once setup closes. If an app won’t take typed text, Voxloom may copy your words so you can paste them.</p>
          </>}
          {shownError && guided.step !== 1 && !(guided.step === 4 && !guided.ready) && <p className="form-error" role="alert">{shownError}</p>}
        </section>
        {guided.step === 0 && <p className="guided-mini guided-disclosure">{modelId === 'whisper-base.en' ? 'Starting setup downloads Whisper Base (English)' : `Starting setup prepares your selected ${modelLabel}`} ({size}) if needed. Your dictation is processed on this Mac. Larger voice packs are optional in Settings.</p>}
        <footer className="guided-footer">
          {guided.step > 0 && <button className="btn ghost" onClick={() => { cancel(); controller.back(); }} type="button">Back</button>}
          {guided.step < 4 && <button className="btn ghost" onClick={close} type="button">Set up later</button>}
          <span className="guided-footer__wait" id="guided-wait">{waiting}</span>
          {guided.step === 0 ? <button className="btn primary" disabled={!io.native} onClick={() => void action(controller.start)} type="button">Start setup →</button>
            : guided.step === 1 ? <button className="btn primary" disabled={!connected} onClick={() => void next()} type="button">Continue →</button>
              : guided.step === 2 ? <button aria-describedby={waiting ? 'guided-wait' : undefined} className="btn primary" disabled={!guided.ready} onClick={() => void next()} type="button">Use this shortcut →</button>
                : guided.step === 3 && guided.mode === 'hold' ? <button aria-describedby={waiting ? 'guided-wait' : undefined} className="btn primary" disabled={!guided.holdDone || busy} onClick={() => { cancel(); controller.tryHandsFree(); field.current?.focus(); }} type="button">Try double-tap →</button>
                  : guided.step === 3 ? <button aria-describedby={waiting ? 'guided-wait' : undefined} className="btn primary" disabled={!both || !guided.ready || busy} onClick={() => void next()} type="button">Finish setup →</button>
                    : <button className="btn primary" disabled={!both || !guided.ready} onClick={() => void finish()} type="button">Open Voxloom</button>}
        </footer>
      </div>
    </div>
  </SetupWindow>;
}
