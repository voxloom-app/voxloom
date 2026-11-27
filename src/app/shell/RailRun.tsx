import { useId } from 'react';
import { Icon } from '../../components/Icon';
import { type CaptureProps, runState } from '../../features/home/captureRun';
import { RunOutcome } from '../../features/home/RunOutcome';

/**
 * Dictating from the window (ui-iter-33). The shortcut is the way in, from any app, so Home
 * no longer carries a Start capsule; the rail's foot holds the run on every page instead. At
 * rest it offers a quiet Start dictating, for anyone who hasn't learned the keys or works by
 * pointer or switch control, under what the last run did. While it listens it offers Stop
 * and Cancel, whether it started here or with the shortcut; while Voxloom writes it says so.
 * Starting here focuses Voxloom, which the tip says on hover and focus.
 */
export function RailRun({ dogfood, isNative, onCopy }: CaptureProps) {
  const tipId = `vx-rail-start-tip-${useId().replace(/:/g, '')}`;
  const state = runState(dogfood);
  if (state === 'recording') {
    return (
      <div className="rail-run">
        <button className="btn rail-run__stop" onClick={() => { void dogfood.stop(); }} type="button">
          <span aria-hidden="true" className="rec-dot" /> Stop
        </button>
        <button className="quiet-button rail-run__cancel" onClick={() => dogfood.cancel()} type="button">Cancel</button>
      </div>
    );
  }
  if (state === 'busy') {
    return <p className="rail-run__busy" role="status">{dogfood.phase === 'cleaning' ? 'Cleaning up…' : 'Transcribing…'}</p>;
  }
  return (
    <>
      <RunOutcome dogfood={dogfood} onCopy={onCopy} />
      <div className="rail-start">
        <button aria-describedby={tipId} className="rail-start__button" disabled={!isNative} onClick={() => { void dogfood.start(); }} type="button">
          <Icon name="mic" size={14} /> Start dictating
        </button>
        <p className="rail-start__tip" id={tipId}>
          Starting here focuses Voxloom, so the words may be copied instead of inserted.
        </p>
        {!isNative && <p className="rail-start__note">Dictating here needs the Voxloom desktop app.</p>}
      </div>
    </>
  );
}
