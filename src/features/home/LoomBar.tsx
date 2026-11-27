import { useId } from 'react';
import { Icon } from '../../components/Icon';
import type { DictationRecord } from '../../domain/types';
import { type CaptureProps, runState } from './captureRun';
import { RunOutcome } from './RunOutcome';
import { VoiceLoom } from './VoiceLoom';

/** Five bars held still at rest; they sway while you speak. The capsule never meters live audio. */
const LEVEL = [0, 1, 2, 3, 4];

/**
 * Start dictating from the window (ui-iter-21): a dark glass capsule like the HUD, on the
 * stage's weft. Press to start, press again to stop; while Voxloom writes it says so.
 * Starting here focuses Voxloom, which the tip says on hover and focus.
 */
function DictateCapsule({ dogfood, isNative }: Pick<CaptureProps, 'dogfood' | 'isNative'>) {
  const tipId = `vx-dictate-tip-${useId().replace(/:/g, '')}`;
  const state = runState(dogfood);
  return (
    <div className="dictate" data-state={state}>
      {state === 'idle' && (
        <button aria-describedby={tipId} className="dictate__button" disabled={!isNative} onClick={() => { void dogfood.start(); }} type="button">
          <Icon name="mic" size={15} /> Start dictating
        </button>
      )}
      {state === 'recording' && (
        <button className="dictate__button" onClick={() => { void dogfood.stop(); }} type="button">
          <span aria-hidden="true" className="rec-dot" /> Stop
          <span aria-hidden="true" className="dictate__level">{LEVEL.map((i) => <i key={i} />)}</span>
        </button>
      )}
      {state === 'busy' && (
        <span className="dictate__button" role="status">{dogfood.phase === 'cleaning' ? 'Cleaning up…' : 'Transcribing…'}</span>
      )}
      <p className="dictate__tip" id={tipId}>
        Starting here focuses Voxloom, so the words may be copied instead of inserted.
      </p>
    </div>
  );
}

export type StagePick = { fresh: boolean; onCopy: (text: string) => void; record: DictationRecord };

/**
 * The stage's weft (ui-iter-21): one lime-to-cyan thread under your last words. Voice goes
 * in on the left, where the Start capsule sits; the last pick is knotted in the middle in
 * its outcome's colour; text comes out on the right, as Copy. One place to dictate, see the
 * words land and take them away. Whatever the run says hangs beneath on a tag. Since
 * ui-iter-25 the stage's loom gathers here too: its threads run into Start and out of Copy.
 */
export function LoomBar({ capture, pick }: { capture?: CaptureProps; pick: StagePick | null }) {
  if (!capture && !pick) return null;
  const recording = capture ? runState(capture.dogfood) === 'recording' : false;
  const hang = capture && (recording || capture.dogfood.message || !capture.isNative);
  return (
    <div className="loom-bar" data-status={pick?.record.status}>
      <VoiceLoom side="in" />
      <VoiceLoom side="out" />
      <div className="loom-bar__in">{capture && <DictateCapsule dogfood={capture.dogfood} isNative={capture.isNative} />}</div>
      <span aria-hidden="true" className="pick__weft" data-fresh={pick?.fresh || undefined} key={`weft-${pick?.record.id ?? 'none'}`}>
        {pick && <i />}
      </span>
      <div className="loom-bar__out">
        {pick && (
          <button aria-label="Copy last dictation" className="btn pick__copy" onClick={() => pick.onCopy(pick.record.text)} type="button">
            <Icon name="copy" size={14} /> Copy
          </button>
        )}
      </div>
      {hang && (
        <div className="loom-bar__hang">
          {recording && (
            <button className="quiet-button loom-bar__cancel" onClick={() => capture.dogfood.cancel()} type="button">Cancel</button>
          )}
          <RunOutcome dogfood={capture.dogfood} onCopy={capture.onCopy} />
          {!capture.isNative && <p className="loom-bar__note">Dictating here needs the Voxloom desktop app.</p>}
        </div>
      )}
    </div>
  );
}
