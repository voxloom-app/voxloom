import type { CSSProperties } from 'react';
import { Knot } from '../../components/Knot';
import { dayKey, formatSpoken, looseThreads, tally } from '../../features/history/historyLoom';
import { useApp } from '../AppContext';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How far through its local day a moment falls, from 0 (midnight) to 1. */
export function dayFraction(at: number): number {
  const midnight = new Date(at);
  midnight.setHours(0, 0, 0, 0);
  const next = new Date(midnight);
  next.setDate(next.getDate() + 1);
  return Math.min(1, Math.max(0, (at - midnight.getTime()) / (next.getTime() - midnight.getTime())));
}

/**
 * Today in words, on every screen: how many dictations, words and minutes so far,
 * and a count of loose threads (failed or unverified) worth a look. Opens History.
 * It sits on the rail's beam, a lit rod with a peg at each end (ui-iter-17). Since
 * ui-iter-21 the day's picks are ticks on that rod, placed by time of day, one dye for
 * every outcome: the rail stays quiet whatever happened to the words, and History, a
 * press away, tells them apart.
 */
export function RailToday({ onOpen }: { onOpen: () => void }) {
  const { now, state } = useApp();
  const today = dayKey(now());
  const records = state.records.filter((record) => dayKey(record.createdAt) === today);
  const sum = tally(records);
  const loose = looseThreads(records);
  const looseCount = loose.failed + loose.unverified;
  const newest = records.reduce<(typeof records)[number] | undefined>((last, record) => (!last || record.createdAt > last.createdAt ? record : last), undefined);
  const label = records.length
    ? `Today: ${plural(sum.dictations, 'dictation')}, ${plural(sum.words, 'word')}${looseCount ? `, ${plural(looseCount, 'loose thread')}` : ''}`
    : 'Today: no dictations yet';
  return (
    <button aria-label={label} className="rail-today" onClick={onOpen} type="button">
      <span className="rail-today__head">Today<b>{sum.dictations}</b></span>
      <span className="rail-today__sum">
        {records.length ? `${plural(sum.words, 'word')} · ${formatSpoken(sum.seconds)} spoken` : 'Nothing woven yet'}
      </span>
      {looseCount > 0 && (
        <span className="rail-today__loose"><Knot className="rail-today__knot" tone="warn" />{plural(looseCount, 'loose thread')}</span>
      )}
      {records.length > 0 && (
        <span aria-hidden="true" className="rail-today__day">
          {records.map((record) => (
            <i
              data-newest={record === newest ? '' : undefined}
              key={record.id}
              style={{ '--at': dayFraction(record.createdAt).toFixed(4) } as CSSProperties}
            />
          ))}
        </span>
      )}
    </button>
  );
}
