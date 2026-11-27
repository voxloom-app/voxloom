import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AppearanceTab } from './AppearanceTab';
import { CleanupPane, MicrophonePane, OutputPane, ShortcutPane, SpeechPane } from './CapturePanes';
import { PrivacyTab } from './PrivacyTab';
import { PATH_LENGTH, settingsPanes, type SettingsTab } from './SettingsTabs';
import { VoicePath } from './VoicePath';

interface SettingsProps {
  onSetup: (opener: HTMLElement) => void;
  initialTab?: SettingsTab;
  /** In the native Settings window: name the window after the open pane. */
  onTabTitle?: (title: string) => void;
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Settings, laid out as the Console Settings window. The header is the voice
 * path (ui-iter-04), and since ui-iter-13 it is also the navigation: each stop
 * a dictation passes opens its own pane, so Settings reads in the order your
 * words travel, from the key you hold to the transcript that stays.
 */
export function Settings({ onSetup, initialTab = 'shortcut', onTabTitle }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const section = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const index = settingsPanes.findIndex((pane) => pane.value === tab);
  const { intro, title } = settingsPanes[index];
  const onPath = index < PATH_LENGTH;
  const previous = onPath && index > 0 ? settingsPanes[index - 1] : null;
  const next = onPath && index < PATH_LENGTH - 1 ? settingsPanes[index + 1] : null;
  useEffect(() => { onTabTitle?.(title); }, [title, onTabTitle]);

  /** Walk to a neighbouring stop from the pane's foot: keep focus in the pane, show the path. */
  function walk(to: SettingsTab) {
    panel.current?.focus({ preventScroll: true });
    setTab(to);
    section.current?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  return (
    <section aria-labelledby="settings-title" className="settings-window" ref={section}>
      <header className="settings-window__bar stage">
        <div className="settings-window__head">
          <h1 id="settings-title">Settings</h1>
          <p>Every dictation follows this path. Pick a stop to change it.</p>
        </div>
        <VoicePath onSelect={setTab} tab={tab} />
      </header>
      <div
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-panel"
        data-pane={tab}
        id={`settings-panel-${tab}`}
        ref={panel}
        role="tabpanel"
        style={{ '--stop': index } as CSSProperties}
        tabIndex={0}
      >
        <div className="settings-pane__head" key={tab}>
          <p className="settings-pane__where"><i aria-hidden="true" />{onPath ? `Stop ${index + 1} of ${PATH_LENGTH}` : 'Off the path'}</p>
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
        {(previous || next) && (
          <div className="settings-pane__walk">
            {previous && (
              <button
                aria-label={`Previous stop: ${previous.title}`}
                className="settings-pane__step"
                data-dir="previous"
                onClick={() => walk(previous.value)}
                type="button"
              >
                <span aria-hidden="true" className="settings-pane__arrow">←</span>
                <small>Previous stop</small>
                <span className="settings-pane__to">{previous.title}</span>
              </button>
            )}
            {next && (
              <button
                aria-label={`Next stop: ${next.title}`}
                className="settings-pane__step"
                data-dir="next"
                onClick={() => walk(next.value)}
                type="button"
              >
                <span aria-hidden="true" className="settings-pane__arrow">→</span>
                <small>Next stop</small>
                <span className="settings-pane__to">{next.title}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
