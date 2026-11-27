import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import type { DictationRecord } from '../../domain/types';
import { formatTime } from '../history/HistoryRow';
import { pickMeasure, wordCount } from './pickWords';

type Props = {
  record: DictationRecord;
  /** True when this dictation landed while Home was open: the line weaves in once. */
  fresh: boolean;
  onCopy: (text: string) => void;
};

/**
 * The last pick: one pass of the weft is one dictation. Under your shortcut, the stage shows
 * the last thing you said, set in the words face, with what happened to it and when. Keys
 * restart the weave (mask sweep) for each new dictation. The heading is for screen readers
 * only (ui-iter-25): the quote marks and the time already say what these words are. Copy is
 * a quiet word at the end of that line (ui-iter-33), like the copy mark on earlier rows,
 * instead of a capsule on the weft.
 */
export function LastDictation({ fresh, onCopy, record }: Props) {
  const words = wordCount(record.text);
  return (
    <section aria-labelledby="pick-title" className="pick" data-status={record.status}>
      <h2 className="pick__label sr-only" id="pick-title">Last dictation</h2>
      <blockquote className="pick__words" data-fresh={fresh || undefined} data-measure={pickMeasure(record.text)} key={record.id}>
        <p>{record.text}</p>
      </blockquote>
      <div className="pick__meta">
        <Badge status={record.status} />
        <span>
          <time dateTime={new Date(record.createdAt).toISOString()}>{formatTime(record.createdAt)}</time>
          {` · ${words} ${words === 1 ? 'word' : 'words'} · ${record.durationSeconds}s`}
        </span>
        <button aria-label="Copy last dictation" className="pick__copy" onClick={() => onCopy(record.text)} type="button">
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
    </section>
  );
}
