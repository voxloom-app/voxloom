import { HudSignal } from './HudSignal';
import { Waveform } from './Waveform';

/** Still of the real meter for Settings and the shortcut illustration. */
const phrase = [.04, .12, .35, .72, .9, .55, .27, .12, .42, .7, .58, .3, .18, .51, .82, .62, .32];

export function HudPreview() {
  return <span aria-hidden="true" className="hud-preview hud-capsule">
    <HudSignal signal="listening" />
    <Waveform levels={phrase} />
  </span>;
}
