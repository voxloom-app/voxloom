import { isMacPlatform } from '../components/KeyCombo';
import { Waveform, WAVEFORM_SAMPLES } from '../components/Waveform';
import type { OverlayResult, OverlayWaveform } from '../services/shortcut/overlayVisibility';
import { ShuttleBody } from './ShuttleBody';

interface Props {
  levels: readonly number[];
  waveform: OverlayWaveform;
  result?: OverlayResult | null;
  mac?: boolean;
}

/**
 * The HUD's words for a result. Short enough for the 248px result window;
 * `spokenResultText` gives screen readers the full sentence.
 */
export function resultText(result: OverlayResult | null, mac = isMacPlatform()): string {
  const paste = mac ? '⌘V' : 'Ctrl+V';
  switch (result) {
    case 'copied': return `Copied · ${paste} to paste`;
    case 'maybe-copied': return 'Maybe inserted · copied';
    case 'insert-failed': return 'Couldn’t insert';
    default: return 'Couldn’t transcribe';
  }
}

/** Full sentence for the live region (no width limit). */
export function spokenResultText(result: OverlayResult | null, mac = isMacPlatform()): string {
  // Spelled out so screen readers say it; the visible pill keeps ⌘V / Ctrl+V.
  const paste = mac ? 'Command V' : 'Control V';
  if (result === 'copied') return `Copied. Press ${paste} to paste`;
  if (result === 'maybe-copied') return `May have been inserted; also copied. If it's missing, press ${paste} to paste.`;
  return resultText(result, mac);
}

const isResult = (w: OverlayWaveform) => w.startsWith('result-');

type ResultKind = 'copied' | 'unverified' | 'failed';

/**
 * How the thread ends, so the outcome reads by shape as well as colour (the same
 * knots as History): copied ties a solid knot, an uncertain write half-ties one,
 * and a failure frays into a broken ring.
 */
function ResultKnot({ kind }: { kind: ResultKind }) {
  return (
    <svg className="hud-result__knot" height="14" viewBox="0 0 14 14" width="14">
      {kind === 'copied' && <><circle cx="7" cy="7" r="5.25" /><circle className="hud-result__core" cx="7" cy="7" r="2.75" /></>}
      {kind === 'unverified' && <><circle cx="7" cy="7" r="5.25" /><path className="hud-result__core" d="M7 3.5a3.5 3.5 0 0 0 0 7z" /></>}
      {kind === 'failed' && <circle className="hud-result__fray" cx="7" cy="7" r="5.25" />}
    </svg>
  );
}

/**
 * Non-focusable desktop HUD (SPEC § HUD behavior rules), drawn as a weaving shuttle
 * (ui-iter-06). Listening: your voice twists a three-strand thread through the
 * shuttle, swelling with the live level. Transcribing: the strands settle into a
 * rope that shimmers lime→cyan while text pays out of the cyan eyelet (a slow
 * breathe under Reduce Motion). The shuttle stays mounted across both. Results: the
 * thread ties off on a small tag: Copied / maybe-copied / error. One permanent
 * role=status node announces "Transcribing" and results.
 */
export function OverlayWaveformView({ levels, waveform, result = null, mac = isMacPlatform() }: Props) {
  // Levels arrive as 0–1 display levels (OverlayApp applies toDisplayLevel).
  const energy = levels.reduce((sum, level) => sum + level, 0) / WAVEFORM_SAMPLES;
  const text = isResult(waveform) ? resultText(result, mac) : '';
  const spoken = waveform === 'processing' ? 'Transcribing' : isResult(waveform) ? spokenResultText(result, mac) : '';
  const kind: ResultKind = waveform === 'result-copied' ? 'copied' : waveform === 'result-unverified' ? 'unverified' : 'failed';
  return (
    <>
      <div aria-atomic="true" className="sr-only" role="status">{spoken}</div>
      {isResult(waveform) ? (
        <div aria-hidden="true" className={`hud-result hud-result--${kind}`} data-waveform={waveform}>
          <span className="hud-result__lead" />
          <span className="hud-result__tag">
            <ResultKnot kind={kind} />
            <span className="hud-result__text">{text}</span>
          </span>
          <span className="hud-result__lead hud-result__lead--out" />
        </div>
      ) : (
        <div className="recording recording--overlay" data-waveform={waveform}>
          <ShuttleBody energy={energy} />
          {waveform === 'processing'
            ? <>
              <div aria-hidden="true" className="hud-transcribing"><i /></div>
              <span aria-hidden="true" className="hud-payout" />
            </>
            : <Waveform levels={levels} waveform={waveform} />}
        </div>
      )}
    </>
  );
}
