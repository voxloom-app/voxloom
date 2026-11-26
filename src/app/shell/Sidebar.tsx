import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { isMacPlatform, KeyCombo } from '../../components/KeyCombo';
import { ScenarioPanel } from '../../dev/ScenarioPanel';
import type { Screen } from '../../domain/types';
import type { StagePhase } from '../../features/home/stagePhase';
import { navScreens } from './screens';
import { RailToday } from './RailToday';
import { RailWarp } from './RailWarp';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT } from '../../features/settings/shortcutCopy';

type Props = {
  screen: Screen;
  shortcut: string;
  status: string;
  /** What your voice is doing right now; the warp and the key caps follow it. */
  phase?: StagePhase;
  onNavigate: (screen: Screen) => void;
  onReset: () => void;
};

/**
 * The warp rail (ui-iter-03): the window's frame, in the Home stage's dark
 * material in both themes. It stays put while pages scroll; its threads run
 * into the shortcut keys and move only while you speak or Voxloom writes.
 */
export function Sidebar({ screen, shortcut, status, phase = 'idle', onNavigate, onReset }: Props) {
  const active = useShortcutActive();
  return (
    <aside className="sidebar" data-phase={phase}>
      <div className="brand">
        <AppTile />
        <div>
          <b className="brand__name">Voxloom</b>
          <small className="brand__status"><i aria-hidden="true" className="brand__dot" />{status}</small>
        </div>
      </div>
      <nav aria-label="Voxloom screens">
        {navScreens.map(({ icon, label, value }, index) => (
          <button
            aria-current={screen === value ? 'page' : undefined}
            aria-keyshortcuts={`Alt+${index + 1}`}
            aria-label={label}
            className="nav-button"
            key={value}
            onClick={() => onNavigate(value)}
            type="button"
          >
            <Icon name={icon} />
            <span>{label}</span>
            <kbd aria-hidden="true">{isMacPlatform() ? '⌥' : 'Alt+'}{index + 1}</kbd>
          </button>
        ))}
      </nav>
      <RailToday onOpen={() => onNavigate('history')} />
      <RailWarp />
      <div className="rail-key">
        {active && <span className="rail-key__caps"><KeyCombo combo={shortcut} /></span>}
        <p className="sidebar__hint">
          {active ? <>
            Hold the shortcut in any app to dictate. Release to insert, or it
            copies if insertion isn’t safe.
          </> : NO_SHORTCUT}
        </p>
      </div>
      {import.meta.env.DEV && (
        <details className="dev-panel">
          <summary>Developer</summary>
          <ScenarioPanel onReset={onReset} />
        </details>
      )}
    </aside>
  );
}
