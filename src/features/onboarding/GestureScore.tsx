import type { CSSProperties } from 'react';

export type Gesture = 'hold' | 'tap';

// Positions on an illustrative score, not timing thresholds for real gestures.
export const scores = {
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

/** Keys over voice on one strip: when the shortcut is down, and when you speak. */
export function GestureScore({ gesture, playing = false, traceMs = 3000 }: { gesture: Gesture; playing?: boolean; traceMs?: number }) {
  const score = scores[gesture];
  return <div className="gesture-score" aria-hidden="true" data-playing={playing || undefined}
    style={{ '--voice-start': `${score.voiceStart}%`, '--trace-duration': `${traceMs}ms` } as CSSProperties}>
    <span className="gesture-score__label">Keys</span>
    <div className="gesture-score__keys">
      <span className="gesture-score__cue">{score.start}</span><span className="gesture-score__cue end">{score.finish}</span>
      {score.presses.map(([start, end]) => <i key={start} style={{ left: `${start}%`, width: `${end - start}%` }} />)}
    </div>
    <span className="gesture-score__label">Voice</span>
    <div className="gesture-score__voice"><svg focusable="false" viewBox="-2 0 404 32" preserveAspectRatio="none"><path d={phrase} /></svg></div>
  </div>;
}
