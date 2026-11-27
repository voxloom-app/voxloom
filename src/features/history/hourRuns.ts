import type { DictationRecord } from '../../domain/types';

const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });

export type HourRun = { key: string; label: string; records: DictationRecord[] };

/**
 * A day's rows split where the local clock hour changes, in the rows' own newest-first
 * order (ui-iter-39). History marks each run with its hour in the time margin, in place
 * of the separate time cards it used to show above the list (ui-iter-28).
 */
export function hourRuns(records: DictationRecord[]): HourRun[] {
  const runs: HourRun[] = [];
  for (const record of records) {
    const at = new Date(record.createdAt);
    const key = `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}-${at.getHours()}`;
    const last = runs[runs.length - 1];
    if (last?.key === key) last.records.push(record);
    else runs.push({ key, label: hour.format(record.createdAt), records: [record] });
  }
  return runs;
}
