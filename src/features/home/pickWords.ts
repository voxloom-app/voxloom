import type { DictationRecord } from '../../domain/types';

/** Dictations that produced words, newest first (failed runs never become the last pick). */
export function wovenRecords(records: readonly DictationRecord[]): DictationRecord[] {
  return records
    .filter(({ status }) => status !== 'failed')
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** How large the last pick sets the words: short lines get the hero size, long ones step down. */
export type PickMeasure = 'short' | 'medium' | 'long';

export function pickMeasure(text: string): PickMeasure {
  const length = text.trim().length;
  if (length <= 90) return 'short';
  return length <= 200 ? 'medium' : 'long';
}
