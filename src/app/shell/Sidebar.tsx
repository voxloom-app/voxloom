import type { ReactNode } from 'react';
import { AppTile } from '../../components/AppTile';
import { Icon } from '../../components/Icon';
import { isMacPlatform, KeyCombo } from '../../components/KeyCombo';
import { Knot } from '../../components/Knot';
import { ScenarioPanel } from '../../dev/ScenarioPanel';
import type { Screen } from '../../domain/types';
import { type CaptureProps, runHasNews } from '../../features/home/captureRun';
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
  /** The shared run, so a dictation can be finished from pages without the Start capsule. */
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
 * dictation by time of day. Start dictating lives on Home's stage beside Copy. Away from
 * Home the rail's foot says which keys to hold or, during a run, offers Stop and Cancel
 * and then what the run did. Since ui-iter-27 it is the window's only chrome: Recall sits
 * under the brand and Settings… closes the rail, so no toolbar crosses the pages.
 */
export function Sidebar({ capture, screen, shortcut, status, phase = 'idle', onNavigate, onReset, search, tools }: Props) {
  const active = useShortcutActive();
  const away = screen !== 'home';
  const news = away && capture !== undefined && runHasNews(capture.dogfood);
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
        {news && <RailRun dogfood={capture.dogfood} onCopy={capture.onCopy} />}
        {active && away && !news && (
          <p className="rail-key">
            <span className="rail-key__hold">Hold <KeyCombo combo={shortcut} /></span>
            {' '}<span>in any app to dictate</span>
          </p>
        )}
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
