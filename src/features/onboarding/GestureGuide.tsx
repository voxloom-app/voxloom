import { useEffect, useState, type CSSProperties } from 'react';
import { SegmentedControl } from '../../components/SegmentedControl';

const gestures = [
  { value: 'hold', label: 'Hold to talk' },
  { value: 'tap', label: 'Hands-free' },
] as const;
type Gesture = (typeof gestures)[number]['value'];

// Positions on an illustrative score, not timing thresholds for real gestures.
const scores = {
  hold: { presses: [[8, 86]], voiceStart: 8, start: 'Hold', finish: 'Release',
    instruction: 'Hold your shortcut while you speak. Release to finish.' },
  tap: { presses: [[8, 11], [16, 19], [86, 89]], voiceStart: 16, start: 'Tap twice', finish: 'Press once',
    instruction: 'Double-tap, speak with the keys up, then press once to finish.' },
} as const;

// A drawn phrase, not sampled audio. The four envelopes follow “Meet me at noon.”
const syllables = [[.13, .12, 1], [.37, .075, .72], [.55, .08, .45], [.81, .15, .94]];
const phrase = Array.from({ length: 81 }, (_, i) => {
  const level = Math.max(0, ...syllables.map(([center, width, peak]) =>
    peak * (1 - ((i / 80 - center) / width) ** 2)));
  const height = 1 + level * (9 + 4 * Math.cos(i * 1.1));
  return `M${i * 5} ${16 - height}v${height * 2}`;
}).join(' ');

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
    <div className="gesture-score" aria-hidden="true" data-playing={playing || undefined}
      style={{ '--voice-start': `${score.voiceStart}%`, '--trace-duration': `${TRACE_MS}ms` } as CSSProperties}>
      <span className="gesture-score__label">Keys</span>
      <div className="gesture-score__keys">
        <span className="gesture-score__cue">{score.start}</span><span className="gesture-score__cue end">{score.finish}</span>
        {score.presses.map(([start, end]) => <i key={start} style={{ left: `${start}%`, width: `${end - start}%` }} />)}
      </div>
      <span className="gesture-score__label">Voice</span>
      <div className="gesture-score__voice"><svg focusable="false" viewBox="-2 0 404 32" preserveAspectRatio="none"><path d={phrase} /></svg></div>
    </div>
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
