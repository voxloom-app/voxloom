import type { DictationRecord, HistoryStatus } from '../../domain/types';

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

/** Home's knot key lists the knots that need a word first: unconfirmed, then on the clipboard, then typed. */
const KEY_ORDER: HistoryStatus[] = ['unverified', 'copied', 'inserted'];

/** How many of the listed dictations ended each way, in key order (only statuses that appear). */
export function knotKey(records: readonly DictationRecord[]): { count: number; status: HistoryStatus }[] {
  return KEY_ORDER
    .map((status) => ({ count: records.filter((r) => r.status === status).length, status }))
    .filter(({ count }) => count > 0);
}
