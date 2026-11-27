/**
 * Settings panes (ui-iter-13): one per stop a dictation passes on the voice
 * path, in that order, plus Appearance, which sits off the path because
 * nothing in it changes a dictation. The path in the header is their tablist,
 * said as one sentence since ui-iter-41.
 */
export type SettingsTab = 'shortcut' | 'microphone' | 'speech' | 'cleanup' | 'output' | 'transcripts' | 'appearance';

export interface SettingsPane {
  value: SettingsTab;
  /** Visible pane heading and the native Settings window title. */
  title: string;
  intro: string;
}

export const settingsPanes: readonly SettingsPane[] = [
  { value: 'shortcut', title: 'Shortcut',
    intro: 'Where every dictation starts. Hold it in any app, speak, and let go.' },
  { value: 'microphone', title: 'Microphone',
    intro: 'What Voxloom listens to while you dictate.' },
  { value: 'speech', title: 'Speech',
    intro: 'The speech-to-text model on this Mac that turns your voice into words.' },
  { value: 'cleanup', title: 'Cleanup',
    intro: 'An optional tidy-up on this Mac, after speech and before your words arrive.' },
  { value: 'output', title: 'Output',
    intro: 'Your words go into the app you’re using when they’re ready. Voxloom never presses Return or Send for you.' },
  { value: 'transcripts', title: 'Transcripts & privacy',
    intro: 'What stays on this Mac after a dictation, and how to recover when something goes wrong.' },
  { value: 'appearance', title: 'Appearance',
    intro: 'How Voxloom looks. Nothing here changes what you dictate.' },
];
