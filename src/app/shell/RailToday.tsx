import { Icon } from '../../components/Icon';
import { dayKey, formatSpoken, looseThreads, tally } from '../../features/history/historyLoom';
import { useApp } from '../AppContext';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Today in words, on every screen: how many dictations, words and minutes so far,
 * and a count of loose threads (failed or unverified) worth a look. Opens History.
 * Since ui-iter-17 it is the rail's warp beam: the numbers sit on a lit rod and the
 * warp hangs from it, carrying the picture of the day, the cloth (RailWarp).
 */
export function RailToday({ onOpen }: { onOpen: () => void }) {
  const { now, state } = useApp();
  const today = dayKey(now());
  const records = state.records.filter((record) => dayKey(record.createdAt) === today);
  const sum = tally(records);
  const loose = looseThreads(records);
  const looseCount = loose.failed + loose.unverified;
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
        <span className="rail-today__loose"><Icon name="warn" size={12} />{plural(looseCount, 'loose thread')}</span>
      )}
    </button>
  );
}
