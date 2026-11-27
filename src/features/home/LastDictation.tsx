import { Badge } from '../../components/Badge';
import type { DictationRecord } from '../../domain/types';
import { formatTime } from '../history/HistoryRow';
import { pickMeasure, wordCount } from './pickWords';

type Props = {
  record: DictationRecord;
  /** True when this dictation landed while Home was open: the line weaves in once. */
  fresh: boolean;
};

/**
 * The last pick: one pass of the weft is one dictation. The voice stage leads with the
 * last thing you said, set in the words face under the shortcut band, with what happened
 * to it and when. Keys restart the weave (mask sweep) for each new dictation. The weft
 * beneath, with its knot, the Start capsule and Copy, is the stage's LoomBar (ui-iter-21).
 * The heading is for screen readers only (ui-iter-25): the quote marks and the time
 * already say what these words are, so the stage shows no label above them.
 */
export function LastDictation({ fresh, record }: Props) {
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
      </div>
    </section>
  );
}
