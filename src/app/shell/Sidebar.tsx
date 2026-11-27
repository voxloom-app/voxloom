import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { isMacPlatform, KeyCombo } from '../../components/KeyCombo';
import { Knot } from '../../components/Knot';
import { ScenarioPanel } from '../../dev/ScenarioPanel';
import type { Screen } from '../../domain/types';
import type { StagePhase } from '../../features/home/stagePhase';
import { navScreens } from './screens';
import { RailToday } from './RailToday';
import { RailWarp } from './RailWarp';
import { ShuttleDock, type ShuttleDockProps } from './ShuttleDock';
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
  /** Opens one of today's dictations in History, from its pick in the cloth. */
  onShowRecord?: (id: string) => void;
  /** Dictating from the window: the shuttle docked at the fell (ui-iter-15). */
  capture?: ShuttleDockProps;
};

/**
 * The warp rail (ui-iter-03): the window's frame, in the Home stage's dark
 * material in both themes. It stays put while pages scroll. Since ui-iter-15 it
 * is a working loom: today's dictations are woven across its warp, and the
 * shuttle docked at the fell starts a dictation from any page. Since ui-iter-17
 * it hangs as one loom: Today is the beam the warp hangs from, the cloth can be
 * read pick by pick, and one line under the shuttle says what just happened or,
 * away from Home (whose stage already shows it), which keys to hold. The threads
 * move only while you speak or Voxloom writes.
 */
export function Sidebar({ capture, screen, shortcut, status, phase = 'idle', onNavigate, onReset, onShowRecord }: Props) {
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
      <RailWarp onShow={onShowRecord} />
      <div className="rail-dock">
        {capture && <ShuttleDock {...capture} />}
        {!active ? (
          <p className="rail-tag" data-tone="warn">
            <Knot className="rail-tag__knot" tone="warn" />
            <span className="rail-tag__words">{NO_SHORTCUT}</span>
          </p>
        ) : screen !== 'home' && !capture?.dogfood.message && (
          <p className="rail-key">Hold <KeyCombo combo={shortcut} /> in any app to dictate</p>
        )}
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
