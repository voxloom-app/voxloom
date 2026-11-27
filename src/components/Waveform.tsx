/** One bar per 50ms RMS sample: a short, readable trail, newest on the right. */
export const WAVEFORM_SAMPLES = 17;

/** Lift conversational levels above the floor without flattening louder syllables. */
export function toDisplayLevel(level: number): number {
  const floor = 0.0015;
  if (!Number.isFinite(level) || level <= floor) return 0;
  const rms = (Math.min(1, level) - floor) / (1 - floor);
  // Half the scale resolves quiet syllables; the linear half retains differences
  // between normal speech and louder peaks instead of pegging the meter.
  const knee = 0.012;
  const sensitive = (1 + knee) * rms / (rms + knee);
  return (sensitive + rms) / 2;
}

/** Levels are display-normalised by the overlay; the preview uses a fixed phrase. */
export function Waveform({ levels }: { levels: readonly number[] }) {
  return <span aria-label="Microphone level" className="wave" role="img">
    {levels.map((level, i) => (
      <i key={i} style={{ transform: `scaleY(${(3 + 15 * level) / 18})` }} />
    ))}
  </span>;
}
