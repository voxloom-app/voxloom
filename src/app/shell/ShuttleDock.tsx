import { useId } from 'react';
import { Icon } from '../../components/Icon';
import { SHUTTLE_PATH } from '../../components/ShuttleGlyph';
import { WAVEFORM_SAMPLES, weaveRuns } from '../../components/Waveform';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';

export type ShuttleDockProps = {
  dogfood: UseDogfoodCaptureResult;
  isNative: boolean;
  onCopy: (text: string) => void;
};

/** A spoken phrase held still: rises, holds, trails off. The dock never meters live audio. */
const LEVELS = Array.from({ length: WAVEFORM_SAMPLES }, (_, index) =>
  0.3 + 0.45 * Math.sin((Math.PI * (index + 1)) / (WAVEFORM_SAMPLES + 1)));
const RUNS = Array.from({ length: 3 }, (_, strand) => weaveRuns(LEVELS, strand));

/** The HUD's shuttle at rail scale: dark glass, a brand rim and the three-strand braid. */
function Hull() {
  const id = `vx-dock-${useId().replace(/:/g, '')}`;
  return (
    <svg aria-hidden="true" className="rail-shuttle__hull" focusable="false" preserveAspectRatio="none" viewBox="0 0 142 28">
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a2a36" />
          <stop offset=".45" stopColor="#111118" />
          <stop offset="1" stopColor="#08080c" />
        </linearGradient>
      </defs>
      <path className="rail-shuttle__body" d={SHUTTLE_PATH} fill={`url(#${id}-glass)`} stroke={`url(#${id}-rim)`} />
      <g className="rail-shuttle__braid">
        {(['back', 'front'] as const).map((depth) => (
          <g className={`wave__${depth}`} key={depth}>
            {RUNS.map((run, strand) => run[depth] && (
              <path className={`wave__strand wave__strand--${strand}`} d={run[depth]} key={strand} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * The docked shuttle (ui-iter-15): dictating from the window moves off Home and into
 * the foot of the warp rail, on every page. It is the same shuttle the HUD floats over
 * other apps, sitting at the fell of today's cloth: press it to start, press again to
 * stop; while Voxloom writes the braid becomes a rope. Status and errors from any run
 * (shortcut or here) hang beneath it.
 */
export function ShuttleDock({ dogfood, isNative, onCopy }: ShuttleDockProps) {
  const tipId = `vx-dock-tip-${useId().replace(/:/g, '')}`;
  const recording = dogfood.phase === 'recording' || dogfood.captureState.kind === 'active';
  const busy = dogfood.phase === 'transcribing' || dogfood.phase === 'cleaning';
  const failed = dogfood.phase === 'error' || dogfood.phase === 'cancelled';
  const state = recording ? 'recording' : busy ? 'busy' : 'idle';
  const parts = <><Hull /><i aria-hidden="true" className="rail-shuttle__eye rail-shuttle__eye--in" /><i aria-hidden="true" className="rail-shuttle__eye rail-shuttle__eye--out" /></>;

  return (
    <div className="rail-capture" data-state={state}>
      {state === 'idle' && (
        <button aria-describedby={tipId} className="rail-shuttle" disabled={!isNative} onClick={() => { void dogfood.start(); }} type="button">
          {parts}
          <span className="rail-shuttle__face"><Icon name="mic" size={14} /> Start dictating</span>
        </button>
      )}
      {state === 'recording' && (
        <button className="rail-shuttle" onClick={() => { void dogfood.stop(); }} type="button">
          {parts}
          <span className="rail-shuttle__face"><span aria-hidden="true" className="rec-dot" /> Stop</span>
        </button>
      )}
      {state === 'busy' && (
        <div className="rail-shuttle">
          {parts}
          <span className="rail-shuttle__face" role="status">{dogfood.phase === 'cleaning' ? 'Cleaning up…' : 'Transcribing…'}</span>
        </div>
      )}
      <p className="rail-capture__tip" id={tipId}>
        Starting here focuses Voxloom, so the words may be copied instead of inserted.
      </p>
      {state === 'recording' && (
        <button className="quiet-button rail-capture__cancel" onClick={() => dogfood.cancel()} type="button">
          Cancel
        </button>
      )}
      {!isNative && <p className="rail-capture__note">Dictating here needs the Voxloom desktop app.</p>}
      {dogfood.message && (
        <p className={failed ? 'rail-capture__status form-error' : 'rail-capture__status'} data-phase={dogfood.phase} role="status">
          <Icon name={failed ? 'warn' : 'check'} size={13} /> {dogfood.message}
        </p>
      )}
      {dogfood.phase === 'error' && dogfood.message?.startsWith('Escape cancellation unavailable [cancel-') && (
        <button className="btn rail-capture__copy" onClick={() => onCopy(dogfood.message!)} type="button">
          <Icon name="copy" size={13} /> Copy error details
        </button>
      )}
    </div>
  );
}
