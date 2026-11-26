import { type CSSProperties, useId } from 'react';

/** Seven threads per side, spread wide at the stage edges. */
const SPREAD = [-84, -56, -28, 0, 28, 56, 84];
const MID = 100;

/** A thread from the stage edge to the shortcut keys (left), or back out (right). */
function thread(offset: number, index: number, side: 'in' | 'out'): string {
  const edge = MID + offset;
  const near = MID + offset * 0.1;
  // Small per-thread bends so the weave doesn't look ruled.
  const bend = ((index * 37) % 23) - 11;
  if (side === 'in') return `M0 ${edge} C ${150 + bend} ${edge} ${300 - bend} ${near} 470 ${near}`;
  return `M530 ${near} C ${700 + bend} ${near} ${850 - bend} ${edge} 1000 ${edge}`;
}

/**
 * The Home stage's signature: threads that converge on the shortcut keys from
 * the left (your voice going in) and fan out to the right (text coming out).
 * Pure decoration; `.stage[data-phase]` in stage.css drives the motion.
 */
export function VoiceLoom() {
  const gradient = `vx-loom-${useId().replace(/:/g, '')}`;
  return (
    <svg aria-hidden="true" className="loom" focusable="false" preserveAspectRatio="none" viewBox="0 0 1000 200">
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={gradient} x1="0" x2="1000" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
        </linearGradient>
      </defs>
      {(['in', 'out'] as const).map((side) => (
        <g className={`loom__side loom__side--${side}`} key={side} stroke={`url(#${gradient})`}>
          {SPREAD.map((offset, index) => {
            const d = thread(offset, index, side);
            return (
              <g key={offset} style={{ '--i': index } as CSSProperties}>
                <path className="loom__warp" d={d} />
                <path className="loom__pulse" d={d} pathLength={100} />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
