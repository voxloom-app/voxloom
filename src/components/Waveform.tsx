import type { OverlayWaveform } from '../services/shortcut/overlayVisibility';

/** Level history length: one sample per capture-level event (20 Hz, so ~1.2 s). */
export const WAVEFORM_SAMPLES = 24;

/** Per-frame RMS is metadata only; map speech into a legible display range. */
export function toDisplayLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(1, Math.max(0, (Math.sqrt(level) - 0.04) / 0.4));
}

/**
 * The voice thread's geometry, in the 142×28 shuttle (ui-iter-06). Three strands
 * twist along one 118px row between the eyelets. The newest level enters on the
 * voice side (left) and older ones travel toward the text side (right), so speech
 * swells the braid as it is pulled through. Strands meet on the centre line at both
 * ends, so they always leave the shuttle as one thread.
 */
export const WEAVE = {
  height: 28,
  mid: 14,
  points: 48,
  restAmp: 1.1,
  maxAmp: 8,
  strands: 3,
  twists: 2,
  width: 142,
  x0: 12,
  x1: 130,
} as const;

/** 0 at both ends of the row, 1 across the middle 80% (eased). */
function taper(t: number): number {
  const s = Math.min(1, Math.min(t, 1 - t) / 0.1);
  return s * s * (3 - 2 * s);
}

const sample = (levels: readonly number[], age: number) => {
  const value = levels[WAVEFORM_SAMPLES - 1 - Math.min(WAVEFORM_SAMPLES - 1, Math.max(0, age))] ?? 0;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
};

/** Lightly smoothed (1-2-1) so the braid swells instead of jittering. Age 0 is newest. */
const smoothed = (levels: readonly number[], age: number) =>
  (sample(levels, age - 1) + 2 * sample(levels, age) + sample(levels, age + 1)) / 4;

/** Level at row position t: the entry ramp shows the newest sample at once. */
function levelAt(levels: readonly number[], t: number): number {
  const age = Math.min(1, Math.max(0, (t - 0.1) / 0.8)) * (WAVEFORM_SAMPLES - 1);
  const low = Math.floor(age);
  const high = Math.min(WAVEFORM_SAMPLES - 1, low + 1);
  return smoothed(levels, low) + (smoothed(levels, high) - smoothed(levels, low)) * (age - low);
}

interface WeavePoint { x: number; y: number; front: boolean }

const round = (value: number) => Math.round(value * 100) / 100;

/** One strand as a helix seen from the side: y is the twist, cos() is its depth. */
function strandPoints(levels: readonly number[], strand: number): WeavePoint[] {
  const { maxAmp, mid, points, restAmp, strands, twists, x0, x1 } = WEAVE;
  return Array.from({ length: points + 1 }, (_, p) => {
    const t = p / points;
    const angle = 2 * Math.PI * (twists * t + strand / strands);
    const amp = (restAmp + levelAt(levels, t) * (maxAmp - restAmp)) * taper(t);
    return { front: Math.cos(angle) > 0, x: x0 + t * (x1 - x0), y: mid + amp * Math.sin(angle) };
  });
}

const toPath = (points: readonly WeavePoint[]) =>
  `M${points.map(({ x, y }) => `${round(x)} ${round(y)}`).join('L')}`;

/** SVG path for one whole strand. `levels` are 0–1 display levels, oldest first. */
export function weavePath(levels: readonly number[], strand: number): string {
  return toPath(strandPoints(levels, strand));
}

/**
 * The same strand split into the stretches behind and in front of the others, so
 * every crossing alternates over and under like a real braid. Runs share their end
 * points, so the strand stays unbroken.
 */
export function weaveRuns(levels: readonly number[], strand: number): { back: string; front: string } {
  const points = strandPoints(levels, strand);
  const runs: { back: string[]; front: string[] } = { back: [], front: [] };
  let start = 0;
  for (let index = 1; index <= points.length; index++) {
    if (index < points.length && points[index].front === points[start].front) continue;
    runs[points[start].front ? 'front' : 'back'].push(toPath(points.slice(start, Math.min(points.length, index + 1))));
    start = index;
  }
  return { back: runs.back.join(''), front: runs.front.join('') };
}

interface Props {
  levels: readonly number[];
  waveform: OverlayWaveform;
}

/** The accessible microphone meter, drawn as a braided thread instead of bars. */
export function Waveform({ levels, waveform }: Props) {
  const runs = Array.from({ length: WEAVE.strands }, (_, strand) => weaveRuns(levels, strand));
  return (
    <svg
      aria-label={waveform === 'processing' ? 'Transcribing' : 'Microphone level'}
      className="wave"
      role="img"
      viewBox={`0 0 ${WEAVE.width} ${WEAVE.height}`}
    >
      {(['back', 'front'] as const).map((depth) => (
        <g className={`wave__${depth}`} key={depth}>
          {runs.map((run, strand) => run[depth] && (
            // A dark underlay parts each strand from the one it crosses.
            <g key={strand}>
              <path className="wave__gap" d={run[depth]} />
              <path className={`wave__strand wave__strand--${strand}`} d={run[depth]} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}
