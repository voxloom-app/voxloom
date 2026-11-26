import { useEffect, useRef, useState } from 'react';
import { AppearanceTab } from './AppearanceTab';
import { CaptureTab } from './CaptureTab';
import { ModelsTab } from './ModelsTab';
import { PrivacyTab } from './PrivacyTab';
import { settingsTabs, SettingsTabs, type SettingsTab } from './SettingsTabs';
import { VoicePath } from './VoicePath';
import { findStopRow, landOn, type PathStop } from './pathStops';

interface SettingsProps {
  onSetup: (opener: HTMLElement) => void;
  initialTab?: SettingsTab;
  /** In the native Settings window: name the window after the current tab. */
  onTabTitle?: (label: string) => void;
}

/** How long a landed row keeps its thread mark. */
const LANDED_MS = 2400;
/** Rows that render late (the model list) get this long to appear. */
const LANDING_WAIT_MS = 1500;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Settings, laid out as the Console Settings window. The header is the voice
 * path (ui-iter-04): one thread through every stop a dictation passes, each
 * stop opening its control, over the toolbar tabs and one panel.
 * Rendered in-page for now; UI PR 6b moves it into its own Tauri window (⌘,).
 */
export function Settings({ onSetup, initialTab = 'capture', onTabTitle }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [landing, setLanding] = useState<{ stop: PathStop } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { label, title } = settingsTabs.find((t) => t.value === tab)!;
  useEffect(() => { onTabTitle?.(label); }, [label, onTabTitle]);

  // Land after the stop's tab has rendered: mark the row, focus its control.
  useEffect(() => {
    const root = panel.current;
    if (!landing || !root) return;
    let unmark: number | undefined;
    let observer: MutationObserver | undefined;
    let wait: number | undefined;
    const tryLand = () => {
      const row = findStopRow(root, landing.stop);
      if (!row) return false;
      observer?.disconnect();
      window.clearTimeout(wait);
      landOn(root, row, prefersReducedMotion());
      unmark = window.setTimeout(() => row.removeAttribute('data-landed'), LANDED_MS);
      return true;
    };
    if (!tryLand()) {
      observer = new MutationObserver(() => { tryLand(); });
      observer.observe(root, { childList: true, subtree: true });
      wait = window.setTimeout(() => {
        observer?.disconnect();
        root.focus({ preventScroll: true });
      }, LANDING_WAIT_MS);
    }
    return () => {
      observer?.disconnect();
      window.clearTimeout(wait);
      window.clearTimeout(unmark);
    };
  }, [landing]);

  return (
    <section aria-labelledby="settings-title" className="settings-window">
      <header className="settings-window__bar stage">
        <div className="settings-window__head">
          <h1 id="settings-title">Settings</h1>
          <p>Every dictation follows this path. Pick a stop to change it.</p>
        </div>
        <VoicePath
          onStop={(stop) => { setTab(stop.tab); setLanding({ stop }); }}
          tab={tab}
        />
        <SettingsTabs onChange={setTab} value={tab} />
      </header>
      <div
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
        id={`settings-panel-${tab}`}
        ref={panel}
        role="tabpanel"
        tabIndex={0}
      >
        {/* BUS-41: the window title already names the tab; keep the heading for screen readers. */}
        <h2 className="sr-only">{title}</h2>
        {tab === 'capture' && <CaptureTab onSetup={onSetup} />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </section>
  );
}
