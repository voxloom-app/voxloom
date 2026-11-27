import { useEffect, useState } from 'react';
import { comboLabel, isMacPlatform, spokenCombo } from '../components/KeyCombo';
import { SegmentedControl } from '../components/SegmentedControl';
import { GestureScore, scores, type Gesture } from '../features/onboarding/GestureScore';
import { NO_SHORTCUT } from '../features/settings/shortcutCopy';
import { useShortcutActive } from '../services/shortcut/activeShortcut';
import { loneKeyCap } from '../services/shortcut/loneKey';

const options = [{ value: 'hold', label: 'Hold to talk' }, { value: 'tap', label: 'Hands-free' }] as const;
const duration = 3000;

function PrintedKeys({ shortcut }: { shortcut: string }) {
  const mac = isMacPlatform();
  return <>
    <span className="sr-only">{spokenCombo(shortcut, mac)}</span>
    <span aria-hidden="true" className="shortcut-demo__caps">
      {shortcut.split('+').map((part, i) => {
        const face = loneKeyCap(part, mac) ?? comboLabel(part, mac);
        const name = spokenCombo(part, mac);
        return <kbd className="kbd" key={`${part}-${i}`}>
          {face}{face.toLowerCase() !== name.toLowerCase() && <small>{name}</small>}
        </kbd>;
      })}
    </span>
  </>;
}

/** A silent illustration. The caps follow the same press intervals drawn on the score;
 * neither the keyboard nor the microphone is observed to play it. */
export function ShortcutDemo({ shortcut, native }: { shortcut: string; native: boolean }) {
  const active = useShortcutActive();
  const [gesture, setGesture] = useState<Gesture>('hold');
  const [playing, setPlaying] = useState(false);
  const [down, setDown] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timers = scores[gesture].presses.flatMap(([start, end]) => [
      window.setTimeout(() => setDown(true), duration * start / 100),
      window.setTimeout(() => setDown(false), duration * end / 100),
    ]);
    timers.push(window.setTimeout(() => setPlaying(false), duration));
    return () => timers.forEach(window.clearTimeout);
  }, [playing, gesture]);
  function stop() { setPlaying(false); setDown(false); }
  return <section aria-labelledby="dictation-guide-title" className="shortcut-demo">
    <h3 id="dictation-guide-title">Dictation keys</h3>
    <p className="shortcut-guide__scope">{!active ? NO_SHORTCUT : native ? 'Works in any app.' : 'Browser preview: this window only.'}</p>
    <SegmentedControl label="Example to show" onChange={(next) => { stop(); setGesture(next); }} options={options} size="sm" value={gesture} />
    <div className="shortcut-demo__illustration">
      <div className="shortcut-demo__keys" data-down={down || undefined}><PrintedKeys shortcut={shortcut} /></div>
      <GestureScore gesture={gesture} playing={playing} traceMs={duration} />
    </div>
    <p className="shortcut-demo__instruction" aria-live="polite">{scores[gesture].instruction}</p>
    <div className="shortcut-demo__playback">
      <button className="btn" onClick={() => playing ? stop() : setPlaying(true)} type="button">
        <span aria-hidden="true">{playing ? '■' : '▷'}</span>{playing ? 'Stop example' : 'Play example'}
      </button>
      <small>No microphone used.</small>
    </div>
  </section>;
}
