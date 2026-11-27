import { Icon } from './Icon';
import { Knot } from './Knot';

type Signal = 'listening' | 'processing' | 'ok' | 'warn' | 'err';

/** One signal well: microphone in, pen on paper, then the delivery knot. */
export function HudSignal({ signal }: { signal: Signal }) {
  return <span aria-hidden="true" className="hud-signal">
    {signal === 'listening' ? <Icon name="mic" size={15} />
      : signal === 'processing' ? <Icon name="edit" size={14} />
      : <Knot className="hud-knot" tone={signal} />}
  </span>;
}
