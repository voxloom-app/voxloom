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

type Form = 'meter' | 'ink' | 'knot';

/** Same marks throughout: live bars, two lines of ink, then a single point
 * inside the result well. Ink lengths describe level, never recognized words. */
export function Waveform({ levels, form = 'meter' }: { levels: readonly number[]; form?: Form }) {
  const meter = form === 'meter';
  let lineWidth = 0;
  return <span aria-label={meter ? 'Microphone level' : undefined} aria-hidden={meter ? undefined : true}
    className="wave" data-form={form} role={meter ? 'img' : undefined}>
    {levels.map((level, i) => {
      // Listening centers are 6px apart (4px bar + 2px gap).
      let transform = `scaleY(${(3 + 15 * level) / 18})`;
      if (form === 'ink') {
        if (i === 9) lineWidth = 0;
        const length = 3 + 5 * level;
        const x = lineWidth + length / 2 - (6 * i + 2);
        transform = `translate(${x}px, ${i < 9 ? 4 : 10}px) rotate(90deg) scale(.63, ${length / 18})`;
        lineWidth += length + 2;
      } else if (form === 'knot') {
        transform = `translateX(${-20 - i * 6}px) scale(.45, .1)`;
      }
      return <i key={i} style={{ transform, animationDelay: form === 'ink' ? `${i * 65}ms` : undefined }} />;
    })}
  </span>;
}
