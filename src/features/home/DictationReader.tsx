import { useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Badge } from '../../components/Badge';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import type { DictationRecord } from '../../domain/types';
import { formatTime } from '../history/HistoryRow';
import { pickMeasure, wordCount } from './pickWords';

type PageProps = { record: DictationRecord; index: number; count: number; onTurn: (index: number) => void };
type Props = PageProps & { opener: HTMLButtonElement; onClose: () => void };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const folio = (page: number) => String(page).padStart(2, '0');

/** The stage stays on the latest dictation. Turning the sheet resets the page's scroll,
 * focus and copy receipt, without remounting the dialog or changing its original opener. */
export function DictationReader({ opener, onClose, ...page }: Props) {
  return (
    <Dialog initialFocus=".reader__words" label="Recent dictations" onClose={onClose} opener={opener}>
      <ReadingPage key={page.record.id} {...page} />
    </Dialog>
  );
}

function ReadingPage({ record, index, count, onTurn }: PageProps) {
  const { clipboard } = useApp();
  const body = useRef<HTMLQuoteElement>(null);
  const [notice, setNotice] = useState('');
  const words = wordCount(record.text);
  const uncertain = record.status === 'unverified' || Boolean(record.mayHaveInserted);
  useLayoutEffect(() => { body.current?.focus({ preventScroll: true }); }, []);

  async function copy() {
    try {
      await clipboard.copy(record.text);
      setNotice('Copied to clipboard');
    } catch {
      setNotice('Couldn’t copy. Select the text to copy it manually.');
    }
  }
  return (
    <article className="reader">
      <header className="reader__head">
        <h2>Recent dictations</h2>
        <time dateTime={new Date(record.createdAt).toISOString()} id="reader-date">
          {date.format(record.createdAt)} · {formatTime(record.createdAt)}
        </time>
      </header>
      <div className="reader__spread">
        <div className="reader__folio">
          <span className="sr-only" id="reader-position">Dictation {index + 1} of {count}</span>
          <b aria-hidden="true">{folio(index + 1)}</b><span aria-hidden="true">of {folio(count)}</span>
          <small>{words} {words === 1 ? 'word' : 'words'} · {record.durationSeconds}s</small>
        </div>
        <div className="reader__page">
          <blockquote aria-describedby="reader-position reader-date reader-outcome" aria-label="Full dictation" className="reader__words"
            data-measure={pickMeasure(record.text)} ref={body} tabIndex={0}>{record.text}</blockquote>
          <div className="reader__outcome" id="reader-outcome">
            <Badge status={record.status} />
            {uncertain && <span>{record.mayHaveInserted?.copied && 'Also copied. '}Check the destination before copying.</span>}
          </div>
        </div>
      </div>
      <footer className="reader__foot">
        <button className="btn reader__copy" disabled={!record.text.trim()} onClick={() => { void copy(); }} type="button">
          <Icon name="copy" size={14} /> Copy text
        </button>
        <span className="reader__notice" role="status">{notice}</span>
        <nav aria-label="Read another dictation" className="reader__turn">
          <button disabled={index === 0} onClick={() => onTurn(index - 1)} type="button"><span aria-hidden="true">←</span> Newer</button>
          <button disabled={index + 1 === count} onClick={() => onTurn(index + 1)} type="button">Older <span aria-hidden="true">→</span></button>
        </nav>
      </footer>
    </article>
  );
}
