import type { CSSProperties } from 'react';
import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import type { SettingsTab } from './SettingsTabs';
import { voicePathStops, type PathStop } from './pathStops';

/**
 * The path a dictation travels, drawn as one thread with a knot per stop:
 * Shortcut → Microphone → Speech → Cleanup → Output → Transcripts. Each stop
 * shows its saved value and opens the control that changes it. Stops owned by
 * the open tab are tied (filled knots), so the tabs read as stretches of the path.
 */
export function VoicePath({ onStop, tab }: { onStop: (stop: PathStop) => void; tab: SettingsTab }) {
  const { state } = useApp();
  const active = useShortcutActive();
  const stops = voicePathStops(state.settings, active);
  return (
    <nav aria-label="Voice path" className="voice-path">
      <ol className="voice-path__stops">
        {stops.map((stop, index) => (
          <li
            data-current={stop.tab === tab || undefined}
            data-stop={stop.id}
            key={stop.id}
            style={{ '--i': index } as CSSProperties}
          >
            <button aria-label={stop.name} className="voice-path__stop" onClick={() => onStop(stop)} type="button">
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
        ))}
      </ol>
    </nav>
  );
}
