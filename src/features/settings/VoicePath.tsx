import { Fragment, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import type { SettingsTab } from './SettingsTabs';
import { appearanceStop, type PathStop, voicePathStops } from './pathStops';

const step: Record<string, number> = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 };

/**
 * The path a dictation travels, said in one plain sentence (ui-iter-41): "Hold ⌃ ⇧ Space
 * and Voxloom listens through your default microphone. Whisper Base (English) turns
 * what you say into words on this Mac, …". Each underlined part is a saved setting and
 * the Settings tab for its pane (ui-iter-13); the underlines run lime to cyan in the
 * order a dictation passes them, voice in to text out. Appearance follows on its own
 * line, because nothing in it changes a dictation. The parts are inline spans, not
 * buttons, so a long one wraps with the sentence like any other words; arrows, Home and
 * End move between them, and Enter or Space opens one.
 */
export function VoicePath({ onSelect, tab }: { onSelect: (tab: SettingsTab) => void; tab: SettingsTab }) {
  const { state } = useApp();
  const active = useShortcutActive();
  const path = voicePathStops(state.settings, active);
  const look = appearanceStop(state.settings);
  const stops = [...path, look];
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const current = stops.findIndex((stop) => stop.id === tab);

  function onKeyDown(event: KeyboardEvent) {
    const n = stops.length;
    if (event.key === 'Enter' || event.key === ' ') {
      const id = (event.target as HTMLElement).dataset.stop as SettingsTab | undefined;
      if (id) { event.preventDefault(); onSelect(id); }
      return;
    }
    const next = event.key in step ? (current + step[event.key] + n) % n
      : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(stops[next].id);
    refs.current[next]?.focus();
  }

  function part(stop: PathStop, index: number) {
    const selected = stop.id === tab;
    const keys = stop.id === 'shortcut' && state.settings.shortcut;
    return (
      <Fragment key={stop.id}>
        {stop.lead}
        <span
          aria-controls={`settings-panel-${stop.id}`}
          aria-label={stop.name}
          aria-selected={selected}
          className="path-sentence__stop"
          data-current={selected || undefined}
          data-inactive={stop.id === 'shortcut' && !active ? '' : undefined}
          data-stop={stop.id}
          id={`settings-tab-${stop.id}`}
          onClick={() => onSelect(stop.id)}
          ref={(el) => { refs.current[index] = el; }}
          role="tab"
          style={{ '--i': index } as CSSProperties}
          tabIndex={selected ? 0 : -1}
        >
          {keys ? <KeyCombo combo={state.settings.shortcut} /> : stop.phrase}
          {keys && !active && <small className="path-sentence__note">(not active)</small>}
        </span>
        {stop.tail}
      </Fragment>
    );
  }

  return (
    <div aria-label="Settings sections" className="path-sentence" onKeyDown={onKeyDown} role="tablist">
      <div className="path-sentence__path">{path.map(part)}</div>
      <div className="path-sentence__look">{part(look, path.length)}</div>
    </div>
  );
}
