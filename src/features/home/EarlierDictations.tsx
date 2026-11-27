import { useApp } from '../../app/AppContext';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import type { DictationRecord, HistoryStatus } from '../../domain/types';
import { formatTime } from '../history/HistoryRow';
import { knotKey } from './pickWords';

type Props = {
  /** Up to five dictations before the last pick, newest first. */
  earlier: DictationRecord[];
  /** Whether the stage shows a last pick (so an empty list is "nothing earlier", not "nothing"). */
  hasWords: boolean;
  onCopy: (text: string) => void;
};

/** Failed runs never reach Home's list (pickWords.ts), so three outcomes are enough. */
const LABELS: Partial<Record<HistoryStatus, string>> = { copied: 'Copied', inserted: 'Inserted', unverified: 'Unverified' };

/**
 * The dictations woven before the last pick, hanging under the stage's weft on the open
 * page (ui-iter-29): no card, no per-row pill. Each knot's shape says how the words ended
 * (filled typed, ring copied, dotted unconfirmed); the key beneath says it once, with the
 * count, and every row still names its status for screen readers.
 */
export function EarlierDictations({ earlier, hasWords, onCopy }: Props) {
  const { dispatch } = useApp();
  const key = knotKey(earlier);
  return (
    <section aria-labelledby="recent-title" className="earlier">
      <div className="earlier__head">
        <h2 id="recent-title">Earlier dictations</h2>
        <button className="link-button" onClick={() => dispatch({ screen: 'history', type: 'set-screen' })} type="button">
          View all →
        </button>
      </div>
      <div className="recent-list">
        {earlier.map((record) => (
          <div className="recent-row" data-status={record.status} key={record.id}>
            <span className="timestamp">{formatTime(record.createdAt)}</span>
            <p>{record.text}</p>
            <span className="sr-only">{LABELS[record.status] ?? record.status}</span>
            <IconButton icon="copy" label="Copy dictation" onClick={() => onCopy(record.text)} />
          </div>
        ))}
        {!earlier.length && (
          <EmptyState compact icon="clock" title={hasWords ? 'Nothing earlier yet.' : 'No dictations yet.'} />
        )}
      </div>
      {key.length > 0 && (
        <p className="earlier__key">
          {key.map(({ count, status }) => (
            <span data-status={status} key={status}>
              <i aria-hidden="true" />
              {`${count} ${(LABELS[status] ?? status).toLowerCase()}`}
              {status === 'unverified' && ` · Couldn’t confirm ${count === 1 ? 'it was' : 'they were'} typed.`}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
