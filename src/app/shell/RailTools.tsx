import { Icon } from '../../components/Icon';
import { comboLabel } from '../../components/KeyCombo';

type Props = {
  settingsOpen: boolean;
  onSettings: () => void;
  onHelp: (opener: HTMLElement) => void;
};

/**
 * The rail's last line (ui-iter-27): Settings… ⌘, and the keyboard-shortcuts "?" button.
 * The window has no toolbar any more. Recall sits under the brand at the top of the rail
 * and these two close it at the foot, so every page starts at the top of the window.
 * The standard macOS title bar still names the window; no overlay or traffic-light inset.
 */
export function RailTools({ settingsOpen, onSettings, onHelp }: Props) {
  const combo = comboLabel('CommandOrControl+,');
  return (
    <div className="rail-tools">
      <button
        aria-current={settingsOpen ? 'page' : undefined}
        aria-label="Settings"
        className="rail-settings"
        onClick={onSettings}
        title={`Settings… (${combo})`}
        type="button"
      >
        <Icon name="gear" />
        <span aria-hidden="true">Settings…</span>{' '}
        <kbd aria-hidden="true">{combo}</kbd>
      </button>
      <button
        aria-label="Open keyboard shortcuts"
        className="rail-help"
        onClick={(event) => onHelp(event.currentTarget)}
        title="Keyboard shortcuts (?)"
        type="button"
      >
        ?
      </button>
    </div>
  );
}
