import type { DictationRecord } from '../../domain/types';

const DAY = 86_400_000;

/** Local calendar day, e.g. "2026-11-26". */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", or a weekday and date for older days. */
export function dayLabel(timestamp: number, now: number): string {
  // Rounded, so 23- and 25-hour DST days still count as one day.
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', weekday: 'long' }).format(timestamp);
}

export interface DayGroup {
  key: string;
  label: string;
  records: DictationRecord[];
}

/** Newest-first records grouped by local day; the input order is kept. */
export function groupByDay(records: readonly DictationRecord[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const record of records) {
    const key = dayKey(record.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.records.push(record);
    else groups.push({ key, label: dayLabel(record.createdAt, now), records: [record] });
  }
  return groups;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** "42s", "1m 57s", "1h 4m". */
export function formatSpoken(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export interface Tally {
  dictations: number;
  seconds: number;
  words: number;
}

export function tally(records: readonly DictationRecord[]): Tally {
  return records.reduce<Tally>((sum, record) => ({
    dictations: sum.dictations + 1,
    seconds: sum.seconds + record.durationSeconds,
    words: sum.words + wordCount(record.text),
  }), { dictations: 0, seconds: 0, words: 0 });
}

/** Records that didn't land cleanly: failed, or delivery couldn't be verified. */
export function looseThreads(records: readonly DictationRecord[]): Record<'failed' | 'unverified', number> {
  return {
    failed: records.filter((record) => record.status === 'failed').length,
    unverified: records.filter((record) => record.status === 'unverified').length,
  };
}
