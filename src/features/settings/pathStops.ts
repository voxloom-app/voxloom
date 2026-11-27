import { spokenCombo } from '../../components/KeyCombo';
import { isCleanupActive } from '../../domain/cleanup';
import type { Settings } from '../../domain/types';
import { SYSTEM_DEFAULT_DEVICE_ID } from '../../services/capture/types';
import { resolveTranscriptionModelId } from '../../services/stt/resolveModelId';
import { STT_MODEL_CATALOG } from '../../services/stt/types';
import type { SettingsTab } from './SettingsTabs';

/**
 * One stop on the path a dictation travels, from the key you hold to the text
 * it leaves; each is also the Settings pane of the same id (ui-iter-13).
 */
export interface PathStop {
  id: SettingsTab;
  label: string;
  /** Visible value; the shortcut stop draws key caps instead. */
  value: string;
  detail: string;
  /** Accessible name: starts with the visible label (WCAG 2.5.3). */
  name: string;
}

const styleNames: Record<Settings['style'], string> = {
  casual: 'Casual',
  formal: 'Formal',
  'very-casual': 'Very Casual',
};

const looks: Record<Settings['appearance'], string> = { dark: 'Dark', light: 'Light', system: 'System' };
const sizes: Record<Settings['textSize'], string> = { default: 'Default text', large: 'Large text', small: 'Small text' };

const kept: Record<Settings['transcriptRetention'], string> = {
  '30-days': 'Kept 30 days',
  forever: 'Kept until deleted',
  off: 'Not kept',
};

/** "Whisper Base (English)" → ["Whisper Base", "English"]; unknown ids show as given. */
export function speechModel(raw: string): { name: string; language: string | null } {
  const id = resolveTranscriptionModelId(raw);
  const label = STT_MODEL_CATALOG.find((model) => model.id === id)?.label ?? id;
  const match = /^(.*?)\s*\(([^)]+)\)$/.exec(label);
  return match ? { language: match[2], name: match[1] } : { language: null, name: label };
}

/**
 * The six stops, in the order a dictation passes them. Values come from saved
 * Settings only: nothing here probes devices, models or the clipboard.
 */
export function voicePathStops(settings: Settings, shortcutActive: boolean, mac?: boolean): PathStop[] {
  const cleanupOn = isCleanupActive(settings);
  const style = styleNames[settings.style] ?? 'Formal';
  const speech = speechModel(settings.transcriptionModel);
  const mic = settings.microphone === SYSTEM_DEFAULT_DEVICE_ID ? 'System default' : 'Chosen microphone';
  const output = settings.clipboardFallback ? 'Falls back to Copy' : 'No clipboard fallback';
  const transcripts = kept[settings.transcriptRetention] ?? 'Kept 30 days';
  const speechDetail = speech.language ? `${speech.language} · local` : 'Local';
  const cleanupDetail = cleanupOn ? `${style} style` : `${style} when on`;
  const transcriptDetail = settings.transcriptRetention === 'off' ? 'Last one stays on Home' : 'On this Mac';
  const shortcutDetail = shortcutActive ? 'Hold to dictate' : 'Not active';
  const keys = settings.shortcut ? spokenCombo(settings.shortcut, mac) : 'none';
  return [
    { detail: shortcutDetail, id: 'shortcut', label: 'Shortcut', name: `Shortcut: ${keys}. ${shortcutDetail}`,
      value: settings.shortcut || 'None' },
    { detail: 'Input device', id: 'microphone', label: 'Microphone', name: `Microphone: ${mic}`, value: mic },
    { detail: speechDetail, id: 'speech', label: 'Speech', name: `Speech: ${speech.name}, ${speechDetail}`,
      value: speech.name },
    { detail: cleanupDetail, id: 'cleanup', label: 'Cleanup', name: `Cleanup: ${cleanupOn ? 'on' : 'off'}, ${cleanupDetail}`,
      value: cleanupOn ? 'On' : 'Off' },
    { detail: output, id: 'output', label: 'Output', name: `Output: insert, ${output.toLowerCase()}`, value: 'Insert' },
    { detail: transcriptDetail, id: 'transcripts', label: 'Transcripts',
      name: `Transcripts: ${transcripts.toLowerCase()}, ${transcriptDetail.toLowerCase()}`, value: transcripts },
  ];
}

/** Appearance sits off the path: it shows the look, and changes nothing a dictation does. */
export function appearanceStop(settings: Settings): PathStop {
  const look = looks[settings.appearance] ?? 'System';
  const size = sizes[settings.textSize] ?? 'Default text';
  const spoken = look === 'System' ? 'follow system' : look.toLowerCase();
  return { detail: size, id: 'appearance', label: 'Appearance', name: `Appearance: ${spoken}, ${size.toLowerCase()}`, value: look };
}
