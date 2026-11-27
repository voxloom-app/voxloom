import { Icon } from '../../components/Icon';
import { Knot } from '../../components/Knot';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';
import { hasDiagnostic, runTone } from './captureRun';

/**
 * What the last run (Start or the shortcut) did, on one tag tied off with the HUD's knots
 * (solid done, half caveat, frayed failure; ui-iter-17). It hangs under the stage's Start
 * capsule on Home and from the rail's foot elsewhere (ui-iter-21). The Escape-cancellation
 * diagnostic adds an explicit Copy, never an automatic one.
 */
export function RunOutcome({ dogfood, onCopy }: { dogfood: UseDogfoodCaptureResult; onCopy: (text: string) => void }) {
  if (!dogfood.message) return null;
  const tone = runTone(dogfood);
  return (
    <>
      <p className="run-tag" data-phase={dogfood.phase} data-tone={tone} role="status">
        <Knot className="run-tag__knot" tone={tone} />
        <span className="run-tag__words">{dogfood.message}</span>
      </p>
      {hasDiagnostic(dogfood) && (
        <button className="btn run-copy" onClick={() => onCopy(dogfood.message!)} type="button">
          <Icon name="copy" size={13} /> Copy error details
        </button>
      )}
    </>
  );
}
