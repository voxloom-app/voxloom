import { useApp } from '../../app/AppContext';
import type { SettingsTab } from './SettingsTabs';

/** Inline navigation from an explanation to the control it names. */
export function SettingsStopLink({ tab, children }: { tab: SettingsTab; children: string }) {
  const { dispatch } = useApp();
  return <button className="settings-stop-link" type="button"
    onClick={() => dispatch({ type: 'set-screen', screen: 'settings', settingsTab: tab })}>{children}</button>;
}
