import { useApp } from '../../app/AppContext';
import { initialSettings } from '../../domain/fixtures';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';
import type { WritingStyle } from '../../domain/types';
import { isTauriEnv } from '../../services/capture/captureService';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { isCleanupActive } from '../../domain/cleanup';
import { CleanupSettings } from './CleanupSettings';
import { STYLE_HELP_OFF, STYLE_HELP_ON } from './cleanupCopy';
import { cleanupShown, useCleanupModel } from './useCleanupModel';
import { MicrophoneRows } from './MicrophoneRows';
import { ModelsTab } from './ModelsTab';
import { ShortcutRecorder } from './ShortcutRecorder';
import { HELP as SHORTCUT_HELP } from './shortcutCopy';

/*
 * The panes for the stops a dictation passes (ui-iter-13), split from the old
 * Capture & Output tab (S1–S11). Browser-only rows stay gated per CHECKLIST
 * § Hidden in the native app.
 */

const styles: { value: WritingStyle; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
  { value: 'very-casual', label: 'Very Casual' },
];

/** Shortcut: the recorder, guided setup, and whether Voxloom is there at login. */
export function ShortcutPane({ onSetup }: { onSetup: (opener: HTMLElement) => void }) {
  const { settings, state } = useApp();
  const isNative = isTauriEnv();
  const update = settings.update;
  return (
    <div className="settings-rows">
      <div className="shortcut-station" data-path-stop="shortcut">
        <span className="sr-only" id="settings-shortcut-label">Shortcut</span>
        <ShortcutRecorder
          defaultValue={initialSettings.shortcut}
          labelId="settings-shortcut-label"
          onChange={(value) => update({ key: 'shortcut', value })}
          value={state.settings.shortcut}
        />
        <button aria-label="Set up shortcuts" className="btn" onClick={(event) => onSetup(event.currentTarget)} type="button">
          Set up shortcuts…
        </button>
        <small className="shortcut-station__help" id="settings-shortcut-help">{SHORTCUT_HELP}</small>
      </div>
      <div className="frow">
        <span className="frow__label">
          <span>{isNative ? 'Start at login' : 'Start at login · simulated'}</span>
          {isNative && <span className="tag">Unavailable in desktop</span>}
        </span>
        <Switch
          checked={isNative ? false : state.settings.startAtLogin}
          disabled={isNative}
          hideLabel
          label={isNative ? 'Start at login · unavailable in desktop' : 'Start at login · simulated'}
          onChange={(value) => update({ key: 'startAtLogin', value })}
        />
      </div>
    </div>
  );
}

/** Microphone: the input device and a test recording. */
export function MicrophonePane() {
  return <div className="settings-rows"><MicrophoneRows /></div>;
}

/** Speech: the local model cards, then the language that model hears. */
export function SpeechPane() {
  const { settings, state } = useApp();
  const isNative = isTauriEnv();
  const multilingual = state.settings.transcriptionModel === 'parakeet-tdt-0.6b-v3';
  const nativeLanguage = multilingual ? 'Automatic (Multilingual)' : 'English (US)';
  return (
    <>
      <ModelsTab />
      <div className="settings-rows settings-rows--after-fieldset">
        <div className="frow">
          <span className="frow__label">
            <label htmlFor="settings-language">Language</label>
            {isNative && <span className="tag">{multilingual ? 'Multilingual' : 'English-first'}</span>}
          </span>
          <select
            disabled={isNative}
            id="settings-language"
            onChange={(event) => settings.update({ key: 'language', value: event.target.value })}
            value={isNative ? nativeLanguage : state.settings.language}
          >
            {isNative && multilingual ? <option>Automatic (Multilingual)</option> : <option>English (US)</option>}
            {!isNative && <option>English (UK)</option>}
          </select>
        </div>
      </div>
    </>
  );
}

/** Cleanup: the writing style it follows, the local cleanup itself, and its model. */
export function CleanupPane({ cleanupModelStore }: {
  /** Test seam: cleanup model status/download (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
}) {
  const { settings, state } = useApp();
  const isNative = isTauriEnv();
  const update = settings.update;
  const cleanupModel = useCleanupModel(isNative, cleanupModelStore);
  // Same gate as the Local cleanup block: no cleanup wording while it's hidden.
  const cleanupActive = isCleanupActive(state.settings);
  const mentionCleanup = isNative && cleanupShown(cleanupModel, cleanupActive);
  // BUS-229: the picker stays live here so the preference can be set ahead.
  const styleHelp = cleanupActive ? STYLE_HELP_ON : STYLE_HELP_OFF;
  return (
    <div className="settings-rows">
      <div className="frow" data-path-stop="style">
        <span className="frow__label">
          <span>Writing style</span>
          {mentionCleanup && <small className="frow__help">{styleHelp}</small>}
        </span>
        <SegmentedControl
          label={mentionCleanup ? (cleanupActive ? 'Style preference · used by local cleanup'
            : 'Style preference · applies only when local cleanup is on')
            : isNative ? 'Style preference' : 'Current style'}
          onChange={(value) => update({ key: 'style', value })}
          options={styles}
          size="sm"
          value={state.settings.style}
        />
      </div>
      <CleanupSettings isNative={isNative} model={cleanupModel} />
      {!isNative && (
        <div className="frow">
          <span className="frow__label">
            <label htmlFor="settings-language-model">Language-processing model</label>
          </span>
          <select
            id="settings-language-model"
            onChange={(event) => update({ key: 'languageModel', value: event.target.value })}
            value={state.settings.languageModel}
          >
            <option>Alder Text Small · local</option>
            <option>Alder Text Medium · unavailable</option>
          </select>
        </div>
      )}
    </div>
  );
}

/** Output: how finished words reach the app you're in. */
export function OutputPane() {
  const { settings, state } = useApp();
  return (
    <div className="settings-rows">
      <div className="frow" data-path-stop="output">
        <span className="frow__label">
          <span>Clipboard fallback</span>
          <small className="frow__help" id="settings-output-help">
            When on, Voxloom pastes through your clipboard and then restores it. If inserting can’t safely start, it may copy your words for you to paste.
          </small>
        </span>
        <Switch
          aria-describedby="settings-output-help"
          checked={state.settings.clipboardFallback}
          hideLabel
          label="Clipboard fallback"
          onChange={(value) => settings.update({ key: 'clipboardFallback', value })}
        />
      </div>
    </div>
  );
}
