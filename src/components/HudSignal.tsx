import { Icon } from './Icon';
import { Knot } from './Knot';

type Signal = 'listening' | 'processing' | 'ok' | 'warn' | 'err';

/** The fixed signal well: microphone in, lines of text out, then the delivery knot. */
export function HudSignal({ signal }: { signal: Signal }) {
  return <span aria-hidden="true" className="hud-signal">
    {signal === 'listening' ? <Icon name="mic" size={15} />
      : signal === 'processing' ? <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
        <g stroke="currentColor" strokeLinecap="round" strokeWidth="1.6">
          <path d="M2.5 3.5h9M2.5 7H10" />
          <path className="hud-writing-line" d="M2.5 10.5h6" />
        </g>
      </svg> : <Knot className="hud-knot" tone={signal} />}
  </span>;
}
