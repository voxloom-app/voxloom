import type { ReactNode } from 'react';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { isMacPlatform, KeyCombo } from '../../components/KeyCombo';
import { Knot } from '../../components/Knot';
import { ScenarioPanel } from '../../dev/ScenarioPanel';
import type { Screen } from '../../domain/types';
import { type CaptureProps, runState } from '../../features/home/captureRun';
import type { StagePhase } from '../../features/home/stagePhase';
import { navScreens } from './screens';
import { RailRun } from './RailRun';
import { RailToday } from './RailToday';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT } from '../../features/settings/shortcutCopy';

type Props = {
  screen: Screen;
  shortcut: string;
  status: string;
  /** What your voice is doing right now; the status dot and the page's reed follow it. */
  phase?: StagePhase;
  onNavigate: (screen: Screen) => void;
  onReset: () => void;
  /** The shared run: the rail's foot starts, stops and cancels it from any page (ui-iter-33). */
  capture?: CaptureProps;
  /** Recall, under the brand (ui-iter-27: the window has no toolbar). */
  search?: ReactNode;
  /** Settings… and the shortcuts "?", the rail's last line. */
  tools?: ReactNode;
};

/**
 * The warp rail (ui-iter-03): the window's frame, in the Home stage's dark material in
 * both themes. It stays put while pages scroll. Since ui-iter-21 it is quiet: the brand
 * and its live status, the pages, and Today on its beam, with a tick on the rod for each
 * dictation by time of day. Since ui-iter-27 it is the window's only chrome: Recall sits
 * under the brand and Settings… closes the rail, so no toolbar crosses the pages. Since
 * ui-iter-33 its foot holds the run on every page: a quiet Start dictating at rest, Stop and
 * Cancel while it listens, then what it did. Away from Home, with nothing to report, it also
 * says which keys to hold; Home's stage shows them already.
 */
export function Sidebar({ capture, screen, shortcut, status, phase = 'idle', onNavigate, onReset, search, tools }: Props) {
  const active = useShortcutActive();
  const away = screen !== 'home';
  const quiet = !capture || (runState(capture.dogfood) === 'idle' && !capture.dogfood.message);
  return (
    <aside className="sidebar" data-phase={phase}>
      <div className="brand">
        <AppTile />
        <div>
          <b className="brand__name">Voxloom</b>
          <small className="brand__status"><i aria-hidden="true" className="brand__dot" />{status}</small>
        </div>
      </div>
      {search}
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
      <div className="rail-foot">
        {!active && (
          <p className="run-tag" data-tone="warn">
            <Knot className="run-tag__knot" tone="warn" />
            <span className="run-tag__words">{NO_SHORTCUT}</span>
          </p>
        )}
        {active && away && quiet && (
          <p className="rail-key">
            <span className="rail-key__hold">Hold <KeyCombo combo={shortcut} /></span>
            {' '}<span>in any app to dictate</span>
          </p>
        )}
        {capture && <RailRun {...capture} />}
      </div>
      {import.meta.env.DEV && (
        <details className="dev-panel">
          <summary>Developer</summary>
          <ScenarioPanel onReset={onReset} />
        </details>
      )}
      {tools}
    </aside>
  );
}
