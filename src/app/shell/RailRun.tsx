import { type CaptureProps, runState } from '../../features/home/captureRun';
import { RunOutcome } from '../../features/home/RunOutcome';

/**
 * A run seen from another page (ui-iter-21): Start lives on Home's stage, but a run you
 * started there, or with the shortcut, can be finished from anywhere. While it listens the
 * rail's foot offers Stop and Cancel; while Voxloom writes it says so; then what it did
 * hangs on one tag. Renders nothing at rest.
 */
export function RailRun({ dogfood, onCopy }: Pick<CaptureProps, 'dogfood' | 'onCopy'>) {
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
  return <RunOutcome dogfood={dogfood} onCopy={onCopy} />;
}
