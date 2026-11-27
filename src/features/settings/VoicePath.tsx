import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import type { SettingsTab } from './SettingsTabs';
import { appearanceStop, voicePathStops } from './pathStops';

const step: Record<string, number> = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 };

/**
 * The path a dictation travels, drawn as one thread with a knot per stop:
 * Shortcut → Microphone → Speech → Cleanup → Output → Transcripts, then
 * Appearance, loose at the end because it changes nothing a dictation does.
 * Since ui-iter-13 the path is the Settings tablist: each stop shows its saved
 * value and opens its own pane, and the open stop is tied (a filled knot) with
 * a thread dropped into the pane below. Arrows, Home and End move along it.
 */
export function VoicePath({ onSelect, tab }: { onSelect: (tab: SettingsTab) => void; tab: SettingsTab }) {
  const { state } = useApp();
  const active = useShortcutActive();
  const stops = [...voicePathStops(state.settings, active), appearanceStop(state.settings)];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = stops.findIndex((stop) => stop.id === tab);

  function onKeyDown(event: KeyboardEvent) {
    const n = stops.length;
    const next = event.key in step ? (current + step[event.key] + n) % n
      : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(stops[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="voice-path">
      <ol aria-label="Settings sections" className="voice-path__stops" onKeyDown={onKeyDown} role="tablist">
        {stops.map((stop, index) => {
          const selected = stop.id === tab;
          return (
            <li
              data-current={selected || undefined}
              data-off-path={stop.id === 'appearance' || undefined}
              data-stop={stop.id}
              key={stop.id}
              role="presentation"
              style={{ '--i': index } as CSSProperties}
            >
              <button
                aria-controls={`settings-panel-${stop.id}`}
                aria-label={stop.name}
                aria-selected={selected}
                className="voice-path__stop"
                id={`settings-tab-${stop.id}`}
                onClick={() => onSelect(stop.id)}
                ref={(el) => { refs.current[index] = el; }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span className="voice-path__label">{stop.label}</span>
                <span aria-hidden="true" className="voice-path__thread"><i /></span>
                <span className="voice-path__value" data-inactive={stop.id === 'shortcut' && !active ? '' : undefined}>
                  {stop.id === 'shortcut' && state.settings.shortcut
                    ? <KeyCombo combo={state.settings.shortcut} />
                    : stop.value}
                </span>
                <span className="voice-path__detail">{stop.detail}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
