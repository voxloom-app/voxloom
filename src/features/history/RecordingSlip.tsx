import { useState } from 'react';
import { Badge } from '../../components/Badge';
import type { DictationRecord } from '../../domain/types';

/** A transcription's technical imprint, opened from its time in the margin. */
export function RecordingSlip({ record, cleanup }: { record: DictationRecord; cleanup: string | null }) {
  const [originalOpen, setOriginalOpen] = useState(false);
  const style = record.style === 'very-casual' ? 'Very Casual' : `${record.style[0].toUpperCase()}${record.style.slice(1)}`;
  const original = record.cleanup?.status === 'cleaned' && record.rawText !== record.text ? record.rawText : null;
  return (
    <>
      <dl className="recording-slip__fields">
        <div><dt>Delivery</dt><dd><Badge status={record.status} /></dd></div>
        <div><dt>Spoken</dt><dd>{record.durationSeconds}s</dd></div>
        <div><dt>Speech model</dt><dd>{record.model ?? 'Local STT'}</dd></div>
        <div><dt>Writing style</dt><dd>{style}</dd></div>
      </dl>
      {cleanup && record.cleanup?.status !== 'fallback' && <p>{cleanup}</p>}
      {original && (
        <details className="history-row__original" onToggle={(event) => setOriginalOpen(event.currentTarget.open)}>
          <summary>{originalOpen ? 'Hide original' : 'Show original'}</summary>
          <p>{original}</p>
        </details>
      )}
    </>
  );
}
