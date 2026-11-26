import { useApp } from '../../app/AppContext';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import type { DictationRecord } from '../../domain/types';
import { formatTime } from '../history/HistoryRow';

type Props = {
  /** Up to five dictations before the last pick, newest first. */
  earlier: DictationRecord[];
  /** Whether the stage shows a last pick (so an empty list is "nothing earlier", not "nothing"). */
  hasWords: boolean;
  onCopy: (text: string) => void;
};

/** The dictations woven before the last pick, on one thread, with status badge + copy (H9–H11). */
export function RecentCard({ earlier, hasWords, onCopy }: Props) {
  const { dispatch } = useApp();
  return (
    <section aria-labelledby="recent-title" className="card home-card">
      <div className="card__head">
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
            <Badge status={record.status} />
            <IconButton icon="copy" label="Copy dictation" onClick={() => onCopy(record.text)} />
          </div>
        ))}
        {!earlier.length && (
          <EmptyState compact icon="clock" title={hasWords ? 'Nothing earlier yet.' : 'No dictations yet.'} />
        )}
      </div>
    </section>
  );
}
