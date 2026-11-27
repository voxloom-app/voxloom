import { useLayoutEffect, useRef } from 'react';
import { Badge } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import type { DictationRecord } from '../../domain/types';
import { formatTime } from '../../features/history/HistoryRow';
import { recallSnippet } from './recallSearch';

const date = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
const folio = (n: number) => String(n).padStart(2, '0');

/** The list excerpts; the facing leaf preserves the complete, copyable passage. */
export function RecallLeaf({ record, index, count, query, terms, onCopy, onShow }: {
  record: DictationRecord; index: number; count: number; query: string; terms: string[];
  onCopy: () => void; onShow: () => void;
}) {
  const body = useRef<HTMLQuoteElement>(null);
  useLayoutEffect(() => {
    // Reveal a deep match without moving the window, list selection or typing focus.
    const quote = body.current;
    if (!quote) return;
    const hit = quote.querySelector('mark');
    quote.scrollTop = hit ? quote.scrollTop + hit.getBoundingClientRect().top - quote.getBoundingClientRect().top - 24 : 0;
  }, [query, record.id, record.text]);
  const caution = record.status === 'unverified' || record.mayHaveInserted;
  return (
    <section aria-label="Passage preview" className="recall-leaf">
      <div className="recall-leaf__dateline">
        <span>Passage</span><span>{folio(index + 1)} / {folio(count)}</span>
      </div>
      <blockquote aria-label="Full dictation" className="recall-leaf__words" ref={body} tabIndex={0}>
        {recallSnippet(record.text, terms, Infinity).map((piece, at) => piece.hit
          ? <mark key={at}>{piece.text}</mark> : piece.text)}
      </blockquote>
      <div className="recall-leaf__detail">
        <time dateTime={new Date(record.createdAt).toISOString()}>{date.format(record.createdAt)} · {formatTime(record.createdAt)}</time>
        <Badge status={record.status} />
      </div>
      {caution && <p className="recall-leaf__caution">{record.mayHaveInserted?.copied ? 'Also copied. ' : ''}Check the destination before copying.</p>}
      <div className="recall-leaf__actions">
        <button className="recall-leaf__copy" disabled={!record.text.trim()} onClick={onCopy} type="button">
          <Icon name="copy" size={14} /> Copy passage <kbd aria-hidden="true">↵</kbd>
        </button>
        <button onClick={onShow} title="Shift+Enter" type="button">Show in History <kbd aria-hidden="true">⇧↵</kbd></button>
      </div>
    </section>
  );
}
