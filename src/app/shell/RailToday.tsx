import type { CSSProperties } from 'react';
import { Icon } from '../../components/Icon';
import { dayKey, formatSpoken, loomLayout, looseThreads, tally } from '../../features/history/historyLoom';
import { useApp } from '../AppContext';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Today's weave, on every screen: one thread with a knot per dictation so far
 * today, coloured by what happened to the words, and a count of loose threads
 * (failed or unverified) worth a look. Opens History.
 */
export function RailToday({ onOpen }: { onOpen: () => void }) {
  const { now, state } = useApp();
  const time = now();
  const today = dayKey(time);
  const records = state.records.filter((record) => dayKey(record.createdAt) === today);
  const sum = tally(records);
  const loose = looseThreads(records);
  const looseCount = loose.failed + loose.unverified;
  const layout = loomLayout(records, time, true);
  const label = records.length
    ? `Today: ${plural(sum.dictations, 'dictation')}, ${plural(sum.words, 'word')}${looseCount ? `, ${plural(looseCount, 'loose thread')}` : ''}`
    : 'Today: no dictations yet';
  return (
    <button aria-label={label} className="rail-today" onClick={onOpen} type="button">
      <span className="rail-today__head">Today<b>{sum.dictations}</b></span>
      <span
        aria-hidden="true"
        className="rail-today__weave"
        data-empty={records.length ? undefined : true}
        style={{ '--now': `${layout.now ?? 100}%` } as CSSProperties}
      >
        {layout.knots.map((knot) => (
          <i
            className="rail-today__knot"
            data-newest={knot.newest || undefined}
            data-status={knot.status}
            key={knot.id}
            style={{ left: `${knot.x}%` }}
          />
        ))}
      </span>
      <span className="rail-today__sum">
        {records.length ? `${plural(sum.words, 'word')} · ${formatSpoken(sum.seconds)} spoken` : 'Nothing woven yet'}
      </span>
      {looseCount > 0 && (
        <span className="rail-today__loose"><Icon name="warn" size={12} />{plural(looseCount, 'loose thread')}</span>
      )}
    </button>
  );
}
