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
 * The last pick: one pass of the weft is one dictation. The voice stage
 * leads with the last thing you said, set in the words face under the shortcut
 * band, tied off with a knot in its delivery colour, one click from Copy.
 * Keys restart the weave (mask sweep, thread, knot) for each new dictation.
 */
export function LastDictation({ fresh, onCopy, record }: Props) {
  const words = wordCount(record.text);
  const wovenIn = fresh || undefined;
  return (
    <section aria-labelledby="pick-title" className="pick" data-status={record.status}>
      <h2 className="pick__label" id="pick-title">Last dictation</h2>
      <blockquote className="pick__words" data-fresh={wovenIn} data-measure={pickMeasure(record.text)} key={record.id}>
        <p>{record.text}</p>
      </blockquote>
      <span aria-hidden="true" className="pick__weft" data-fresh={wovenIn} key={`weft-${record.id}`}><i /></span>
      <div className="pick__meta">
        <Badge status={record.status} />
        <span>
          <time dateTime={new Date(record.createdAt).toISOString()}>{formatTime(record.createdAt)}</time>
          {` · ${words} ${words === 1 ? 'word' : 'words'} · ${record.durationSeconds}s`}
        </span>
        <button aria-label="Copy last dictation" className="btn pick__copy" onClick={() => onCopy(record.text)} type="button">
          <Icon name="copy" size={14} /> Copy
        </button>
      </div>
    </section>
  );
}
