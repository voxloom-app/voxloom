import { type CSSProperties, useId } from 'react';

/** Seven warp threads, spread across the rail where they start. */
const SPREAD = [-42, -28, -14, 0, 14, 28, 42];

/**
 * One warp thread (viewBox 0–100 both ways): from the top of the free space,
 * down onto the shortcut keys in the dock below. Small per-thread bends keep
 * the warp from looking ruled.
 */
export function warpPath(offset: number, index: number): string {
  const top = 50 + offset;
  const end = 50 + offset * 0.16;
  const bend = ((index * 37) % 13) - 6;
  return `M${top} 0 C ${top + bend} 46 ${end - bend / 2} 64 ${end} 100`;
}

/**
 * The warp rail's threads: they fill the rail's free space and run into the
 * shortcut keys. They hold still at rest; `.sidebar[data-phase]` in
 * rail-loom.css sends pulses down them while you speak and back up while
 * Voxloom writes. Pure decoration.
 */
export function RailWarp() {
  const gradient = `vx-warp-${useId().replace(/:/g, '')}`;
  return (
    <div aria-hidden="true" className="rail-warp">
      <svg focusable="false" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradient} x1="0" x2="0" y1="0" y2="100">
            <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
          </linearGradient>
        </defs>
        <g stroke={`url(#${gradient})`}>
          {SPREAD.map((offset, index) => {
            const d = warpPath(offset, index);
            return (
              <g key={offset} style={{ '--i': index } as CSSProperties}>
                <path className="rail-warp__thread" d={d} />
                <path className="rail-warp__pulse" d={d} pathLength={100} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
