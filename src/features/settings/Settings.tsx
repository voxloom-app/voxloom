import { useEffect, useRef, useState } from 'react';
import { AppearanceTab } from './AppearanceTab';
import { CleanupPane, MicrophonePane, OutputPane, ShortcutPane, SpeechPane } from './CapturePanes';
import { PrivacyTab } from './PrivacyTab';
import { settingsPanes, type SettingsTab } from './SettingsTabs';
import { VoicePath } from './VoicePath';

interface SettingsProps {
  onSetup: (opener: HTMLElement) => void;
  initialTab?: SettingsTab;
  focusOnOpen?: boolean;
  /** In the native Settings window: name the window after the open pane. */
  onTabTitle?: (title: string) => void;
}

/**
 * Settings, laid out as the Console Settings window. The header is the voice
 * path (ui-iter-04), and since ui-iter-13 it is also the navigation: each stop
 * a dictation passes opens its own pane. Since ui-iter-41 the path is one plain
 * sentence about what happens when you dictate, and its underlined parts are the
 * tabs, so Settings says what each setting does before you open it.
 */
export function Settings({ onSetup, initialTab = 'shortcut', focusOnOpen, onTabTitle }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const section = useRef<HTMLElement>(null);
  const { intro, title } = settingsPanes.find((pane) => pane.value === tab) ?? settingsPanes[0];
  useEffect(() => { onTabTitle?.(title); }, [title, onTabTitle]);
  useEffect(() => {
    if (focusOnOpen) section.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusOnOpen]);

  return (
    <section aria-labelledby="settings-title" className="settings-window" ref={section}>
      <header className="settings-window__bar stage">
        <div className="settings-window__head">
          <h1 id="settings-title">Settings</h1>
          <p>Pick an underlined part to change it.</p>
        </div>
        <VoicePath onSelect={setTab} tab={tab} />
      </header>
      <div
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
        data-pane={tab}
        id={`settings-panel-${tab}`}
        role="tabpanel"
        tabIndex={0}
      >
        <div className="settings-pane__head" key={tab}>
          <h2>{title}</h2>
          <p className="settings-pane__intro">{intro}</p>
        </div>
        {tab === 'shortcut' && <ShortcutPane onSetup={onSetup} />}
        {tab === 'microphone' && <MicrophonePane />}
        {tab === 'speech' && <SpeechPane />}
        {tab === 'cleanup' && <CleanupPane />}
        {tab === 'output' && <OutputPane />}
        {tab === 'transcripts' && <PrivacyTab />}
        {tab === 'appearance' && <AppearanceTab />}
      </div>
    </section>
  );
}
