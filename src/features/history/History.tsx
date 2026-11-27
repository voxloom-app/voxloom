import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { canStartDictation } from '../../app/state';
import { EmptyState } from '../../components/EmptyState';
import { SearchField } from '../../components/SearchField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { canRetry } from '../../domain/records';
import type { DictationRecord, HistoryStatus, Settings } from '../../domain/types';
import { isTauriEnv } from '../../services/capture/captureService';
import { canClip, ClippingSheet } from './ClippingSheet';
import { SettingsStopLink } from '../settings/SettingsStopLink';
import { TimeIndex } from './TimeIndex';
import { HistoryRow } from './HistoryRow';
import { groupByDay } from './historyLoom';
import { HistoryDayHead } from './HistoryDayHead';

interface HistoryProps {
  onToast: (message: string) => void;
}

type Filter = HistoryStatus | 'all';

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'inserted', label: 'Inserted' },
  { value: 'copied', label: 'Copied' },
  { value: 'failed', label: 'Failed' },
  { value: 'unverified', label: 'Unverified' },
];

const retentionCopy: Record<Settings['transcriptRetention'], string> = {
  '30-days': 'Kept for 30 days',
  forever: 'Kept until you delete them',
  off: 'Transcript retention is off',
};

/** The time index leads into day-grouped transcripts. Each day states its
 * unverified caution once instead of boxing every row. */
export function History({ onToast }: HistoryProps) {
  const { clipboard, dictation, history, now, state } = useApp();
  const isNative = isTauriEnv();
  const [currentTime, setCurrentTime] = useState(now);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const sorted = [...state.records].sort((a, b) => b.createdAt - a.createdAt);
  // Keep only IDs here. Filtering does not discard a clip; deleting a record does.
  const [clipIds, setClipIds] = useState<Set<string>>(() => new Set());
  const passages = sorted.filter((record) => clipIds.has(record.id) && canClip(record)).reverse();
  // Forget withdrawn passages even if a later store reload reuses their IDs.
  if (passages.length < clipIds.size) setClipIds(new Set(passages.map(({ id }) => id)));
  const numbers = new Map(passages.map((record, i) => [record.id, i + 1]));
  function toggleClip(id: string) {
    setClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const records = sorted
    .filter((record) => status === 'all' || record.status === status)
    .filter((record) => record.text.toLowerCase().includes(query.toLowerCase()));
  const groups = groupByDay(records, currentTime);

  // The clipping sheet only earns a place once something can be clipped.
  const clippable = passages.length > 0 || state.records.some(canClip);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(now()), 1_000);
    return () => window.clearInterval(timer);
  }, [now]);

  async function copy(text: string) {
    try {
      await clipboard.copy(text);
      onToast('Copied to clipboard');
    } catch {
      onToast('Copy failed');
    }
  }

  function retry(record: DictationRecord) {
    if (!canStartDictation(state.dictation)) {
      onToast('Finish the current dictation before retrying');
      return;
    }
    if (!canRetry(record, now())) {
      setCurrentTime(now());
      onToast('Recovery buffer expired');
      return;
    }
    dictation.retry(record.id);
  }

  return (
    <section aria-labelledby="history-title" className="history">
      <header className="stage history-stage">
        <div className="history-stage__title">
          <h1 id="history-title">History</h1>
          <p className="history-stage__lede">
            {retentionCopy[state.settings.transcriptRetention]} (Settings › <SettingsStopLink tab="transcripts">Transcripts</SettingsStopLink>).{' '}
            {isNative
              ? 'Audio isn’t saved, so audio retry isn’t available in the desktop app.'
              : 'Failed dictations can be retried while their temporary recovery buffer lasts.'}
          </p>
        </div>
        <TimeIndex groups={groups} key={`${status}:${query}`} />
      </header>
      <div className="page-body">
        <div className="history-tools" data-clipping={passages.length > 0 || undefined}>
          <SearchField label="Search history" onChange={setQuery} placeholder="Search transcripts" value={query} />
          <SegmentedControl label="History status" onChange={setStatus} options={filters} size="sm" value={status} />
          {clippable && <ClippingSheet onCopy={(text) => clipboard.copy(text)} passages={passages} />}
        </div>
        <div className="history-timeline">
          {groups.map((group) => (
            <div className="history-day" key={group.key}>
              <HistoryDayHead group={group} />
              <div className="history-list">
                {group.records.map((record) => (
                  <HistoryRow
                    canStart={canStartDictation(state.dictation)}
                    clipNumber={numbers.get(record.id)}
                    currentTime={currentTime}
                    isNative={isNative}
                    key={record.id}
                    onClip={canClip(record) ? toggleClip : undefined}
                    onCopy={(text) => { void copy(text); }}
                    onDelete={(id) => history.delete(id)}
                    onRetry={retry}
                    record={record}
                  />
                ))}
              </div>
            </div>
          ))}
          {!state.records.length && (
            <EmptyState icon="clock" title="No dictations yet">
              Hold the shortcut in any app to dictate. Transcripts appear here.
            </EmptyState>
          )}
          {state.records.length > 0 && !records.length && (
            <EmptyState icon="search" title="No history matches these filters">
              Clear the search or choose All.
            </EmptyState>
          )}
        </div>
      </div>
    </section>
  );
}
