import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import type { DictationRecord } from '../../domain/types';

/** Recovery rows keep their individual notes and actions; don't bundle them. */
export function canClip(record: DictationRecord): boolean {
  return (record.status === 'copied' || record.status === 'inserted')
    && !record.mayHaveInserted && Boolean(record.text.trim());
}

const folio = (n: number) => String(n).padStart(2, '0');
const countLabel = (n: number) => `${n} ${n === 1 ? 'passage' : 'passages'}`;

type Props = {
  /** From the current retained records, oldest first, independent of filters. */
  passages: DictationRecord[];
  onCopy: (text: string) => Promise<void>;
};

/** Three slips and one continuous wire clip; the empty sheet shows it. */
function ClipMark() {
  return (
    <svg aria-hidden="true" className="clip-mark" fill="none" viewBox="0 0 84 72">
      <g strokeLinejoin="round">
        <path className="clip-mark__back" d="m8 23 44-14 15 44-44 14z" />
        <path className="clip-mark__middle" d="m15 16 48-6 6 48-48 6z" />
        <path className="clip-mark__face" d="m25 12 48 3-3 46-48-3z" />
        <path d="m34 32 26 2m-26 6 19 1m-20 6 24 2" stroke="var(--ctl-line)" />
        <path d="m47 21 1-11c.5-7 10-6 9 1l-2 13c-.5 4-6 4-5-1l1-9" stroke="var(--accfg)" strokeLinecap="round" strokeWidth="2.6" />
      </g>
    </svg>
  );
}

export function ClippingSheet({ passages, onCopy }: Props) {
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const count = passages.length;
  return (
    <>
      {/* A chip in the search row (ui-iter-23); it lights and sticks with the row once filled. */}
      <button
        aria-haspopup="dialog" aria-label={`Open clipping sheet, ${countLabel(count)}`}
        className="clip-ticket" data-filled={count > 0 || undefined} onClick={(event) => setOpener(event.currentTarget)}
        title={count ? 'Review clipped passages' : 'Clip passages below to copy them together'} type="button"
      >
        <Icon name="clip" size={15} />
        <span className="clip-ticket__title">Clipping sheet</span>
        <b className="clip-ticket__count">{folio(count)}</b>
      </button>
      {opener && (
        <Dialog label="Clipping sheet" onClose={() => setOpener(null)} opener={opener}>
          <ClipProof onCopy={onCopy} passages={passages} />
        </Dialog>
      )}
    </>
  );
}

function ClipProof({ passages, onCopy }: Props) {
  const [notice, setNotice] = useState('');
  async function copy() {
    try {
      await onCopy(passages.map(({ text }) => text).join('\n\n'));
      setNotice(`Copied ${countLabel(passages.length)}.`);
    } catch {
      setNotice('Couldn’t copy. Your selection is still here.');
    }
  }
  return (
    <div className="clip-proof">
      <header>
        <div className="clip-proof__imprint"><Icon name="clip" size={16} /> {countLabel(passages.length)} · Oldest first</div>
        <h2>Clipping sheet</h2>
        <p>Only the words are copied, with a blank line between passages.</p>
      </header>
      {passages.length ? (
        <ol aria-label="Passages in spoken order" className="clip-proof__pages" tabIndex={0}>
          {passages.map((record, i) => (
            <li key={record.id}>
              <span aria-hidden="true">{folio(i + 1)}</span><p>{record.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="clip-proof__empty"><ClipMark /><p>Use the paper clip beside an inserted or copied passage to add it here.</p></div>
      )}
      <footer>
        <span role="status">{notice || 'The sheet clears when you leave History.'}</span>
        <button className="btn primary" disabled={!passages.length} onClick={() => { void copy(); }} type="button">
          <Icon name="copy" /> Copy passages
        </button>
      </footer>
    </div>
  );
}
