import { HudSignal } from '../components/HudSignal';
import { isMacPlatform } from '../components/KeyCombo';
import { Waveform } from '../components/Waveform';
import type { OverlayResult, OverlayWaveform } from '../services/shortcut/overlayVisibility';
import { WaitClock } from './WaitClock';

interface Props {
  levels: readonly number[];
  waveform: OverlayWaveform;
  result?: OverlayResult | null;
  mac?: boolean;
}

/** Visible result; the live region has room to spell out the paste shortcut. */
export function resultText(result: OverlayResult | null, mac = isMacPlatform()): string {
  const paste = mac ? '⌘V' : 'Ctrl+V';
  switch (result) {
    case 'copied': return `Copied · ${paste} to paste`;
    case 'maybe-copied': return 'Maybe inserted · copied';
    case 'insert-failed': return 'Couldn’t insert';
    default: return 'Couldn’t transcribe';
  }
}

export function spokenResultText(result: OverlayResult | null, mac = isMacPlatform()): string {
  const paste = mac ? 'Command V' : 'Control V';
  if (result === 'copied') return `Copied. Press ${paste} to paste`;
  if (result === 'maybe-copied') return `May have been inserted; also copied. If it's missing, press ${paste} to paste.`;
  return resultText(result, mac);
}

/** Preserve the face, signal well and single live region across all three phases. */
export function OverlayWaveformView({ levels, waveform, result = null, mac = isMacPlatform() }: Props) {
  const outcome = waveform.startsWith('result-');
  const processing = waveform === 'processing';
  const listening = !outcome && !processing;
  const kind = waveform === 'result-copied' ? 'copied' : waveform === 'result-unverified' ? 'unverified' : 'failed';
  const tone = kind === 'copied' ? 'ok' : kind === 'unverified' ? 'warn' : 'err';
  const spoken = outcome ? spokenResultText(result, mac) : processing ? 'Transcribing' : '';
  return <>
    <div aria-atomic="true" className="sr-only" role="status">{spoken}</div>
    <div className={`hud-capsule${outcome ? ` hud-result hud-result--${kind}` : ''}`} data-waveform={waveform}>
      <HudSignal signal={listening ? 'listening' : processing ? 'processing' : tone} />
      <Waveform form={listening ? 'meter' : processing ? 'ink' : 'knot'} levels={levels} />
      {processing && <>
        <span aria-hidden="true" className="hud-caption">Transcribing</span>
        <WaitClock />
      </>}
      {outcome && <span aria-hidden="true" className="hud-label" key={waveform}>{resultText(result, mac)}</span>}
    </div>
  </>;
}
