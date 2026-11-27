import { type CSSProperties, useId } from 'react';

/** Seven threads per side, spread wide at the stage edge. */
const SPREAD = [-84, -56, -28, 0, 28, 56, 84];
const MID = 100;

/**
 * A thread from the stage edge into the Start capsule (in), or out of Copy back to the
 * other edge (out). The bundle is gathered by about 60% of the way, where the controls sit.
 */
function thread(offset: number, index: number, side: 'in' | 'out'): string {
  const edge = MID + offset;
  const near = MID + offset * 0.06;
  // Small per-thread bends so the weave doesn't look ruled.
  const bend = ((index * 37) % 23) - 11;
  if (side === 'in') return `M0 ${edge} C ${140 + bend} ${edge} ${260 - bend} ${near} 500 ${near}`;
  return `M0 ${near} C ${150 + bend} ${near} ${330 - bend} ${edge} 500 ${edge}`;
}

/**
 * The Home stage's one loom (ui-iter-25): seven threads gather from the stage edge into
 * Start (your voice going in) and fan out of Copy (text coming out), on the same weft as
 * your last words. Earlier the stage drew a second set around the shortcut heading; the
 * stage now says it once. Pure decoration; `.stage[data-phase]` in stage.css drives it.
 */
export function VoiceLoom({ side }: { side: 'in' | 'out' }) {
  const gradient = `vx-loom-${useId().replace(/:/g, '')}`;
  // Voice is lime, text is cyan; each side leans toward the other where they meet.
  const from = side === 'in' ? 'var(--brand-a)' : 'color-mix(in srgb, var(--brand-a) 35%, var(--brand-b))';
  const to = side === 'in' ? 'color-mix(in srgb, var(--brand-a) 65%, var(--brand-b))' : 'var(--brand-b)';
  return (
    <svg aria-hidden="true" className={`loom loom--${side}`} focusable="false" preserveAspectRatio="none" viewBox="0 0 500 200">
      <defs>
        <linearGradient gradientUnits="userSpaceOnUse" id={gradient} x1="0" x2="500" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: from }} />
          <stop offset="1" style={{ stopColor: to }} />
        </linearGradient>
      </defs>
      <g className={`loom__side loom__side--${side}`} stroke={`url(#${gradient})`}>
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
    </svg>
  );
}
