import { Icon } from '../../components/Icon';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';

type Props = {
  dogfood: UseDogfoodCaptureResult;
  isNative: boolean;
  onCopy: (text: string) => void;
};

/** The stage's deck: Start / Stop / Cancel, Transcribing…, status, last transcript (H2–H8). */
export function DictateCard({ dogfood, isNative, onCopy }: Props) {
  const recording = dogfood.phase === 'recording' || dogfood.captureState.kind === 'active';
  const busy = dogfood.phase === 'transcribing' || dogfood.phase === 'cleaning';
  const failed = dogfood.phase === 'error' || dogfood.phase === 'cancelled';
  const transcript = dogfood.transcript?.text;

  return (
    <section aria-labelledby="capture-title" className="card home-card home-card--dictate">
      <div className="capline">
        <div className="capline__lead">
          <h2 id="capture-title">Dictate</h2>
          <div className="action-group dogfood-capture-actions">
            {!recording && !busy && (
              <button className="btn primary big" disabled={!isNative} onClick={() => { void dogfood.start(); }} type="button">
                <Icon name="mic" /> Start capture
              </button>
            )}
            {recording && (
              <>
                <button className="btn primary big" onClick={() => { void dogfood.stop(); }} type="button">
                  <span aria-hidden="true" className="rec-dot" /> Stop
                </button>
                <button className="quiet-button" onClick={() => dogfood.cancel()} type="button">Cancel</button>
              </>
            )}
            {busy && (
              <span className="empty-note" role="status">
                {dogfood.phase === 'cleaning' ? 'Cleaning up…' : 'Transcribing…'}
              </span>
            )}
          </div>
        </div>
        <p className="note">
          Tip: hold the shortcut while another app is focused. Starting here
          focuses Voxloom, so the result may be <b>Copied</b> instead of inserted.
          Stop transcribes; Cancel discards without transcribing.
        </p>
      </div>
      {!isNative && (
        <p className="form-error" role="status">Native capture requires the Tauri shell (Mac smoke).</p>
      )}
      {transcript && (
        <div aria-live="polite" className="dogfood-transcript">
          <div>
            <h3 className="dogfood-transcript__label">Last transcript</h3>
            <p>{transcript}</p>
            <p className="fine">Available for manual recovery even when History retention is Off.</p>
          </div>
          <button className="btn" onClick={() => onCopy(transcript)} type="button">
            <Icon name="copy" /> Copy last transcript
          </button>
        </div>
      )}
      {dogfood.message && (
        <p className={failed ? 'status form-error' : 'status'} data-phase={dogfood.phase} role="status">
          <Icon name={failed ? 'warn' : 'check'} size={14} /> {dogfood.message}
        </p>
      )}
      {dogfood.phase === 'error' && dogfood.message?.startsWith('Escape cancellation unavailable [cancel-') && (
        <button className="btn" onClick={() => onCopy(dogfood.message!)} type="button">
          <Icon name="copy" /> Copy error details
        </button>
      )}
    </section>
  );
}
