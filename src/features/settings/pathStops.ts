import { spokenCombo } from '../../components/KeyCombo';
import { isCleanupActive } from '../../domain/cleanup';
import type { Settings } from '../../domain/types';
import { SYSTEM_DEFAULT_DEVICE_ID } from '../../services/capture/types';
import { resolveTranscriptionModelId } from '../../services/stt/resolveModelId';
import { STT_MODEL_CATALOG } from '../../services/stt/types';
import type { SettingsTab } from './SettingsTabs';

export type PathStopId = 'shortcut' | 'microphone' | 'speech' | 'cleanup' | 'output' | 'transcripts';

/** One stop on the path a dictation travels, from the key you hold to the text it leaves. */
export interface PathStop {
  id: PathStopId;
  label: string;
  /** The Settings tab that owns this stop's control. */
  tab: SettingsTab;
  /** Visible value; the shortcut stop draws key caps instead. */
  value: string;
  detail: string;
  /** Accessible name: starts with the visible label (WCAG 2.5.3). */
  name: string;
  /** Rows to land on, most specific first (`data-path-stop` on a row). */
  targets: readonly string[];
}

const styleNames: Record<Settings['style'], string> = {
  casual: 'Casual',
  formal: 'Formal',
  'very-casual': 'Very Casual',
};

const kept: Record<Settings['transcriptRetention'], string> = {
  '30-days': 'Kept 30 days',
  forever: 'Kept until deleted',
  off: 'Not kept',
};

const row = (id: string) => `[data-path-stop="${id}"]`;

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
      tab: 'capture', targets: [row('shortcut')], value: settings.shortcut || 'None' },
    { detail: 'Input device', id: 'microphone', label: 'Microphone', name: `Microphone: ${mic}`,
      tab: 'capture', targets: [row('microphone')], value: mic },
    { detail: speechDetail, id: 'speech', label: 'Speech', name: `Speech: ${speech.name}, ${speechDetail}`,
      tab: 'models', targets: ['.stt-model-row[data-selected]', '.stt-model-row'], value: speech.name },
    { detail: cleanupDetail, id: 'cleanup', label: 'Cleanup', name: `Cleanup: ${cleanupOn ? 'on' : 'off'}, ${cleanupDetail}`,
      tab: 'capture', targets: [row('cleanup'), row('style')], value: cleanupOn ? 'On' : 'Off' },
    { detail: output, id: 'output', label: 'Output', name: `Output: insert, ${output.toLowerCase()}`,
      tab: 'capture', targets: [row('output')], value: 'Insert' },
    { detail: transcriptDetail, id: 'transcripts', label: 'Transcripts', name: `Transcripts: ${transcripts.toLowerCase()}, ${transcriptDetail.toLowerCase()}`,
      tab: 'privacy', targets: [row('transcripts')], value: transcripts },
  ];
}

const FOCUSABLE = [
  'select:not([disabled])',
  'input:checked:not([disabled])',
  'input:not([type="radio"]):not([disabled])',
  'button:not([disabled]):not([tabindex="-1"]):not([aria-disabled="true"])',
  '[tabindex="0"]',
].join(', ');

/** The row a stop lands on in `panel`, or null while it hasn't rendered yet. */
export function findStopRow(panel: ParentNode, stop: Pick<PathStop, 'targets'>): HTMLElement | null {
  for (const selector of stop.targets) {
    const found = panel.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}

/**
 * Land on a row: mark it, bring it into view and focus its first usable
 * control. Disabled rows (browser preview) still land; focus goes to the panel.
 */
export function landOn(panel: HTMLElement, target: HTMLElement, reduced: boolean): HTMLElement {
  panel.querySelectorAll('[data-landed]').forEach((node) => node.removeAttribute('data-landed'));
  target.setAttribute('data-landed', '');
  const control = target.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
  control.focus({ preventScroll: true });
  target.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  return control;
}
