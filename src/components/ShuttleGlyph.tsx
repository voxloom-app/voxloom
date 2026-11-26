import { useId } from 'react';
import { WAVEFORM_SAMPLES, weaveRuns } from './Waveform';

/** The HUD shuttle's outline in its 142×28 box (the overlay masks use the same path). */
export const SHUTTLE_PATH = 'M1 14C12 7 28 1.5 48 1.5H94C114 1.5 130 7 141 14C130 21 114 26.5 94 26.5H48C28 26.5 12 21 1 14Z';

/** A short spoken phrase: rises, holds, trails off. Fixed, so the preview never moves. */
const PREVIEW_LEVELS = Array.from({ length: WAVEFORM_SAMPLES }, (_, index) =>
  0.25 + 0.5 * Math.sin((Math.PI * (index + 1)) / (WAVEFORM_SAMPLES + 1)));

/**
 * A still of the recording indicator (ui-iter-06): the same shuttle, eyelets and
 * braid the HUD draws while you speak. Decorative; label it with adjacent text.
 */
export function ShuttleGlyph() {
  const id = `vx-shuttle-${useId().replace(/:/g, '')}`;
  const runs = Array.from({ length: 3 }, (_, strand) => weaveRuns(PREVIEW_LEVELS, strand));
  return (
    <svg aria-hidden="true" className="shuttle-glyph" viewBox="-14 0 170 28">
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
        </linearGradient>
        <linearGradient id={`${id}-hull`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a2a36" />
          <stop offset=".45" stopColor="#111118" />
          <stop offset="1" stopColor="#08080c" />
        </linearGradient>
        <linearGradient gradientUnits="userSpaceOnUse" id={`${id}-weft`} x1="-14" x2="156" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-a)', stopOpacity: 0 }} />
          <stop offset=".12" style={{ stopColor: 'var(--brand-a)' }} />
          <stop offset=".88" style={{ stopColor: 'var(--brand-b)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-b)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path className="shuttle-glyph__weft" d="M-14 14H156" stroke={`url(#${id}-weft)`} />
      <path d={SHUTTLE_PATH} fill={`url(#${id}-hull)`} stroke={`url(#${id}-rim)`} strokeWidth="1.25" />
      {(['back', 'front'] as const).map((depth) => (
        <g className={`wave__${depth}`} key={depth}>
          {runs.map((run, strand) => run[depth] && (
            <g key={strand}>
              <path className="wave__gap" d={run[depth]} />
              <path className={`wave__strand wave__strand--${strand}`} d={run[depth]} />
            </g>
          ))}
        </g>
      ))}
      <circle cx="8" cy="14" r="2" style={{ fill: 'var(--brand-a)' }} />
      <circle cx="134" cy="14" r="2" style={{ fill: 'var(--brand-b)' }} />
    </svg>
  );
}
