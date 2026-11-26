import type { DictationRecord, HistoryStatus } from '../../domain/types';

const HOUR = 3_600_000;
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

function startOfHour(timestamp: number): number {
  const d = new Date(timestamp);
  d.setMinutes(0, 0, 0);
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

export interface LoomKnot {
  id: string;
  newest: boolean;
  /** Diameter in px; longer dictations tie bigger knots. */
  size: number;
  status: HistoryStatus;
  /** 0–100 along the day's window. */
  x: number;
}

export interface LoomLayout {
  /** Oldest first. */
  knots: LoomKnot[];
  /** Position of "now" when the loom shows today; null for an earlier day. */
  now: number | null;
  ticks: { label: string; x: number }[];
}

const hourLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });

/**
 * Lays one day's dictations along a window that starts on the hour before the
 * first and ends on the hour after the last (or after now, for today), at least
 * three hours wide so a quiet morning still reads as a span of time.
 */
export function loomLayout(records: readonly DictationRecord[], now: number, isToday: boolean): LoomLayout {
  if (!records.length) return { knots: [], now: null, ticks: [] };
  const times = records.map((record) => record.createdAt);
  const first = Math.min(...times);
  const last = Math.max(...times, isToday ? now : -Infinity);
  const start = startOfHour(first);
  let end = startOfHour(last);
  if (end <= last) end += HOUR;
  if (end - start < 3 * HOUR) end = start + 3 * HOUR;
  const span = end - start;
  const at = (timestamp: number) => ((timestamp - start) / span) * 100;
  const step = Math.ceil(span / HOUR / 6) * HOUR;
  const ticks: LoomLayout['ticks'] = [];
  for (let t = start; t <= end; t += step) ticks.push({ label: hourLabel.format(t), x: at(t) });
  const newest = Math.max(...times);
  const knots = [...records]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((record) => ({
      id: record.id,
      newest: record.createdAt === newest,
      size: Math.round(Math.min(18, 9 + record.durationSeconds / 4)),
      status: record.status,
      x: at(record.createdAt),
    }));
  return { knots, now: isToday ? at(now) : null, ticks };
}

const MID = 24;

/**
 * One weft thread through the knots (viewBox x 0–1000). The two threads swap
 * sides at every knot, so together they twist through the day; `side` picks
 * which one. They part slightly after the last knot and meet again at `end`.
 */
export function weftPath(xs: readonly number[], side: 1 | -1, end: number): string {
  if (!xs.length) return '';
  const [first] = xs;
  const lead = MID + side * 7;
  let d = `M0 ${lead} C ${first * 0.5} ${lead} ${first * 0.5} ${MID} ${first} ${MID}`;
  for (let i = 1; i < xs.length; i += 1) {
    const a = xs[i - 1];
    const b = xs[i];
    const gap = b - a;
    // 4/3 of the wanted peak: a cubic with level handles peaks at 3/4 of their height.
    const lift = (MID + side * (i % 2 ? 1 : -1) * Math.min(15, 3 + gap * 0.12) * 1.33).toFixed(1);
    d += ` C ${(a + gap * 0.25).toFixed(1)} ${lift} ${(b - gap * 0.25).toFixed(1)} ${lift} ${b.toFixed(1)} ${MID}`;
  }
  const last = xs.at(-1)!;
  if (end > last + 1) {
    const gap = end - last;
    const lift = (MID + side * (xs.length % 2 ? 1 : -1) * Math.min(6, gap * 0.1) * 1.33).toFixed(1);
    d += ` C ${(last + gap * 0.25).toFixed(1)} ${lift} ${(end - gap * 0.25).toFixed(1)} ${lift} ${end.toFixed(1)} ${MID}`;
  }
  return d;
}
