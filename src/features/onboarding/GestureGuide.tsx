import { useEffect, useState } from 'react';
import { SegmentedControl } from '../../components/SegmentedControl';
import { GestureScore, scores, type Gesture } from './GestureScore';

const gestures = [
  { value: 'hold', label: 'Hold to talk' },
  { value: 'tap', label: 'Hands-free' },
] as const;
const TRACE_MS = 3000;

export function GestureGuide() {
  const [gesture, setGesture] = useState<Gesture>('hold');
  const [playing, setPlaying] = useState(false);
  const score = scores[gesture];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setPlaying(false), TRACE_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);
  function select(next: Gesture) { setPlaying(false); setGesture(next); }
  return <section className="gesture-guide" aria-labelledby="gesture-guide-title">
    <header className="gesture-guide__head">
      <h3 id="gesture-guide-title">Gesture guide</h3>
      <SegmentedControl label="Preview a gesture" options={gestures} value={gesture} onChange={select} size="sm" />
    </header>
    <GestureScore gesture={gesture} playing={playing} traceMs={TRACE_MS} />
    <p className="gesture-guide__instruction" aria-live="polite">{score.instruction}</p>
    <div className="gesture-guide__print">
      <span>Example text</span>
      <p aria-live="polite" data-pending={playing || undefined}>{playing ? 'Tracing gesture…' : 'Meet me at noon.'}</p>
      <button className="gesture-guide__watch" type="button" onClick={() => setPlaying(!playing)}>
        <span aria-hidden="true">{playing ? '■' : '▷'}</span>{playing ? 'Stop example' : 'Watch example'}
      </button>
    </div>
  </section>;
}
