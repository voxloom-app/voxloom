import { useState } from 'react';
import type { DictationRecord } from '../../domain/types';
import { focusHistoryRecord } from './focusHistoryRecord';
import type { DayGroup } from './historyLoom';

const PAGE_SIZE = 4;
const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const dated = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

/** One slot per occupied local clock hour, in the same newest-first order as the rows. */
function byHour(records: DictationRecord[]) {
  const hours = new Map<number, DictationRecord[]>();
  for (const record of records) {
    const h = new Date(record.createdAt).getHours();
    const bucket = hours.get(h);
    if (bucket) bucket.push(record); else hours.set(h, [record]);
  }
  return [...hours.values()];
}

/** A loom card read left to right, then down: one punch per occupied five-minute
 * interval, or per occupied hour on a date card. Counts stay legible as text. */
function Imprint({ records, hourly }: { records: DictationRecord[]; hourly: boolean }) {
  const slots = Array<boolean>(hourly ? 12 : 24).fill(false);
  for (const { createdAt } of records) {
    const time = new Date(createdAt);
    slots[hourly ? Math.floor(time.getMinutes() / 5) : time.getHours()] = true;
  }
  return (
    <span aria-hidden="true" className="time-index__imprint">
      {slots.map((occupied, i) => <i key={i} data-ink={occupied || undefined} />)}
    </span>
  );
}

/** Index the actual search results, not the stored corpus. No new filter or selection:
 * jumping lands in the list, ready for the row's existing copy and recovery actions. */
export function TimeIndex({ groups }: { groups: DayGroup[] }) {
  const [page, setPage] = useState(0);
  if (!groups.length) return null;
  const hourly = groups.length === 1;
  const unit = hourly ? 'hour' : 'date';
  const year = groups[0].key.slice(0, 4);
  const sameYear = groups[groups.length - 1].key.startsWith(`${year}-`);
  const periods = hourly ? byHour(groups[0].records) : groups.map((group) => group.records);
  const last = Math.ceil(periods.length / PAGE_SIZE) - 1;
  const current = Math.min(page, last);
  const start = current * PAGE_SIZE;
  const visible = periods.slice(start, start + PAGE_SIZE);
  return (
    <nav aria-label="Time index" className="time-index">
      <div className="time-index__head">
        <strong>Jump by {unit}</strong>
        {hourly ? <span>{fullDate.format(groups[0].records[0].createdAt)}</span> : sameYear && <span>{year}</span>}
        {last > 0 && (
          <div className="time-index__pages">
            <button type="button" aria-disabled={!current} aria-label={`Later ${unit}s`} onClick={() => setPage(Math.max(0, current - 1))}>←</button>
            <span aria-live="polite">{start + 1}–{start + visible.length} of {periods.length}</span>
            <button type="button" aria-disabled={current === last} aria-label={`Earlier ${unit}s`} onClick={() => setPage(Math.min(last, current + 1))}>→</button>
          </div>
        )}
      </div>
      <div className="time-index__strip">
        {visible.map((records) => {
          const first = records[0];
          const label = (hourly ? hour : sameYear ? date : dated).format(first.createdAt);
          const spoken = hourly ? label : fullDate.format(first.createdAt);
          const count = `${records.length} ${records.length === 1 ? 'dictation' : 'dictations'}`;
          return (
            <button
              aria-label={`Jump to ${spoken}, ${count}`} className="time-index__period" key={spoken}
              onClick={() => focusHistoryRecord(first.id)}
              title={`Jump to ${spoken} · Each punch marks ${hourly ? 'five minutes' : 'an hour'} with dictation.`} type="button"
            >
              <span className="time-index__label">{label}</span>
              <span className="time-index__count">{count}</span>
              <span aria-hidden="true" className="time-index__jump">↘</span>
              <Imprint hourly={hourly} records={records} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
