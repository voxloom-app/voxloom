import { spokenCombo } from '../../components/KeyCombo';
import { isCleanupActive } from '../../domain/cleanup';
import type { Settings } from '../../domain/types';
import { SYSTEM_DEFAULT_DEVICE_ID } from '../../services/capture/types';
import { resolveTranscriptionModelId } from '../../services/stt/resolveModelId';
import { STT_MODEL_CATALOG } from '../../services/stt/types';
import type { SettingsTab } from './SettingsTabs';

/**
 * One stop on the path a dictation travels, from the key you hold to the text it
 * leaves; each is also the Settings pane of the same id (ui-iter-13). Since ui-iter-41
 * the path is said as a sentence: `lead` joins the stop to the words before it,
 * `phrase` is the saved setting in plain words (the part you pick), and `tail` closes
 * the clause.
 */
export interface PathStop {
  id: SettingsTab;
  /** What the setting is called; the accessible name starts with it. */
  label: string;
  lead: string;
  /** The visible words you pick; the shortcut stop draws key caps instead. */
  phrase: string;
  tail: string;
  /** Accessible name: the label, then the visible phrase (WCAG 2.5.3). */
  name: string;
}

const styleNames: Record<Settings['style'], string> = {
  casual: 'Casual',
  formal: 'Formal',
  'very-casual': 'Very Casual',
};

const looks: Record<Settings['appearance'], string> = {
  dark: 'stays dark',
  light: 'stays light',
  system: 'follows your system’s look',
};
const sizes: Record<Settings['textSize'], string> = { default: '', large: ', with large text', small: ', with small text' };

const kept: Record<Settings['transcriptRetention'], string> = {
  '30-days': 'kept for 30 days',
  forever: 'kept until you delete them',
  off: 'not kept',
};

/** "Whisper Base (English)" → ["Whisper Base", "English"]; unknown ids show as given. */
export function speechModel(raw: string): { name: string; language: string | null } {
  const id = resolveTranscriptionModelId(raw);
  const label = STT_MODEL_CATALOG.find((model) => model.id === id)?.label ?? id;
  const match = /^(.*?)\s*\(([^)]+)\)$/.exec(label);
  return match ? { language: match[2], name: match[1] } : { language: null, name: label };
}

const stop = (id: SettingsTab, label: string, lead: string, phrase: string, tail = '', name = `${label}: ${phrase}`): PathStop =>
  ({ id, label, lead, name, phrase, tail });

/**
 * The six stops, in the order a dictation passes them, as one plain sentence:
 * "Hold ⌃ ⇧ Space and Voxloom listens through your default microphone. Whisper Base
 * (English) turns what you say into words on this Mac, cleanup is off, and the words
 * are inserted at your cursor, or copied. Transcripts are kept for 30 days."
 * Values come from saved Settings only: nothing here probes devices, models or the
 * clipboard.
 */
export function voicePathStops(settings: Settings, shortcutActive: boolean, mac?: boolean): PathStop[] {
  const cleanupOn = isCleanupActive(settings);
  const style = styleNames[settings.style] ?? 'Formal';
  const speech = speechModel(settings.transcriptionModel);
  const hasKeys = Boolean(settings.shortcut);
  const keys = hasKeys ? spokenCombo(settings.shortcut, mac) : 'none';
  const mic = settings.microphone === SYSTEM_DEFAULT_DEVICE_ID ? 'your default microphone' : 'the microphone you chose';
  const model = speech.language ? `${speech.name} (${speech.language})` : speech.name;
  const cleanup = cleanupOn ? `cleanup tidies them in ${style} style` : 'cleanup is off';
  const output = settings.clipboardFallback ? 'inserted at your cursor, or copied' : 'inserted at your cursor';
  const transcripts = kept[settings.transcriptRetention] ?? kept['30-days'];
  return [
    stop('shortcut', 'Shortcut', hasKeys ? 'Hold ' : 'Choose ', hasKeys ? keys : 'a shortcut', '',
      `Shortcut: ${keys}. ${shortcutActive ? 'Hold to dictate' : 'Not active'}`),
    stop('microphone', 'Microphone', hasKeys ? ' and Voxloom listens through ' : ' so Voxloom can listen through ', mic, '.'),
    stop('speech', 'Speech', ' ', model),
    stop('cleanup', 'Cleanup', ' turns what you say into words on this Mac, ', cleanup),
    stop('output', 'Output', ', and the words are ', output, '.'),
    stop('transcripts', 'Transcripts', ' Transcripts are ', transcripts,
      settings.transcriptRetention === 'off' ? ', apart from the last one on Home.' : '.'),
  ];
}

/** Appearance sits off the path: it says how Voxloom looks, and changes nothing a dictation does. */
export function appearanceStop(settings: Settings): PathStop {
  const look = looks[settings.appearance] ?? looks.system;
  return stop('appearance', 'Appearance', 'On screen, Voxloom ', `${look}${sizes[settings.textSize] ?? ''}`, '.');
}
