import { useState } from 'react';
import { statusLabels } from '../../components/Badge';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { canRetry } from '../../domain/records';
import type { DictationRecord } from '../../domain/types';
import { cleanupLabel } from './cleanupProvenance';
import { RecordingSlip } from './RecordingSlip';

export function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

type Props = {
  record: DictationRecord;
  isNative: boolean;
  currentTime: number;
  canStart: boolean;
  clipNumber?: number;
  onClip?: (id: string) => void;
  onCopy: (text: string) => void;
  onRetry: (record: DictationRecord) => void;
  onDelete: (id: string) => void;
};

/** A ledger entry. Inspect the recording by its time; recovery stays outside the slip. */
export function HistoryRow({ record, isNative, currentTime, canStart, clipNumber, onClip, onCopy, onRetry, onDelete }: Props) {
  const textId = `history-text-${record.id}`;
  const retryable = !isNative && canRetry(record, currentTime);
  const failedNote = isNative
    ? 'No audio retry available; copy the text to recover it.'
    : retryable && record.recoveryExpiresAt
      ? `Temporary recovery buffer · expires ${formatTime(record.recoveryExpiresAt)}`
      : 'Temporary recovery buffer expired';
  const note = record.mayHaveInserted
    ? `May have been inserted${record.mayHaveInserted.copied ? ' (also copied)' : ''}. Check the field before copying or retrying.`
    : record.status === 'unverified'
    ? 'Input not verified. Inspect before copying or retrying.'
    : record.status === 'failed' ? failedNote : null;
  const saidOnce = record.status === 'unverified';

  const [open, setOpen] = useState(false);
  const slipId = `recording-slip-${record.id}`;
  const time = formatTime(record.createdAt);
  const hasText = Boolean(record.text.trim());
  const cleanup = cleanupLabel(record.cleanup);
  return (
    <article id={`history-record-${record.id}`} className="recent-row history-row" data-clipped={clipNumber ? true : undefined} data-record={record.id} data-status={record.status} tabIndex={0}>
      <button
        aria-controls={slipId} aria-expanded={open} aria-label={`Recording details, ${time}, ${statusLabels[record.status]}`}
        className="ledger-stamp" onClick={() => setOpen(!open)} title={`Recording details · ${statusLabels[record.status]}`} type="button"
      >
        <time className="timestamp" dateTime={new Date(record.createdAt).toISOString()}>{time}</time>
        <i aria-hidden="true" className="ledger-knot" data-status={record.status} />
      </button>
      <div className="history-row__body">
        <h3 className="history-row__text" id={textId}>{record.text}</h3>
        {record.mayHaveInserted?.copied && !open && <p aria-hidden="true" className="history-row__exception">Also copied</p>}
        {record.cleanup?.status === 'fallback' && <p className="history-row__exception">{cleanup}</p>}
        {note && saidOnce && !open && <p className="sr-only">{note}</p>}
        {note && !saidOnce && (
          <p className="recovery-state">
            <Icon name="warn" size={13} /> {note}
          </p>
        )}
      </div>
      <section aria-label={`Recording details at ${time}`} className="recording-slip" hidden={!open} id={slipId}>
        {open && <RecordingSlip cleanup={cleanup} record={record} />}
        {open && saidOnce && <p>{note}</p>}
      </section>
      <div aria-label="Transcript actions" className="action-group" role="group">
        {/* Only the first action is described by the transcript, so VoiceOver reads it once. */}
        {hasText && (
          <IconButton icon="copy" aria-describedby={textId} label="Copy transcript" onClick={() => onCopy(record.text)} />
        )}
        {retryable && (
          <IconButton disabled={!canStart} icon="retry" aria-describedby={hasText ? undefined : textId} label="Retry transcription" onClick={() => onRetry(record)} />
        )}
        <IconButton icon="trash" aria-describedby={hasText || retryable ? undefined : textId} label="Delete transcript" onClick={() => onDelete(record.id)} tone="danger" />
      </div>
      {onClip && (
        <button
          aria-label={`Clip passage from ${time}`} aria-pressed={Boolean(clipNumber)}
          className="clip-tab" onClick={() => onClip(record.id)}
          title={clipNumber ? 'Remove from clipping sheet' : 'Add to clipping sheet'} type="button"
        >
          <Icon name="clip" size={16} />
          <span aria-hidden="true">{clipNumber ? String(clipNumber).padStart(2, '0') : '+'}</span>
        </button>
      )}
    </article>
  );
}
