import { Fragment, useEffect, useState } from 'react';
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
import { hourRuns } from './hourRuns';
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

/** The filter is also the key: each outcome shows its margin knot and how many match
 * the search, so the knots are explained once, at the top, instead of per day. */
function filterOptions(records: DictationRecord[]) {
  const counts: Record<Filter, number> = { all: records.length, copied: 0, failed: 0, inserted: 0, unverified: 0 };
  for (const record of records) counts[record.status]++;
  return filters.map(({ value, label }) => ({
    value,
    label: (
      <>
        {value !== 'all' && <i aria-hidden="true" className="ledger-knot" data-status={value} />}
        <span>{label}</span>{' '}
        <b className="history-filter__count" data-none={counts[value] === 0 || undefined}>{counts[value]}</b>
      </>
    ),
  }));
}

const retentionCopy: Record<Settings['transcriptRetention'], string> = {
  '30-days': 'Kept for 30 days',
  forever: 'Kept until you delete them',
  off: 'Transcript retention is off',
};

/** History opens on the words (ui-iter-39): one header line with the search, one filter
 * that doubles as the knot key, then each day's words on one thread with their hours in
 * the time margin. Each day states its unverified caution once instead of on every row. */
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
  const found = sorted.filter((record) => record.text.toLowerCase().includes(query.toLowerCase()));
  const records = found.filter((record) => status === 'all' || record.status === status);
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
            {retentionCopy[state.settings.transcriptRetention]} · Settings › <SettingsStopLink tab="transcripts">Transcripts</SettingsStopLink>
          </p>
        </div>
        <SearchField label="Search history" onChange={setQuery} placeholder="Search transcripts" value={query} />
      </header>
      <div className="page-body">
        <div className="history-tools" data-clipping={passages.length > 0 || undefined}>
          <div className="history-filter">
            <SegmentedControl label="History status" onChange={setStatus} options={filterOptions(found)} size="sm" value={status} />
          </div>
          {clippable && <ClippingSheet onCopy={(text) => clipboard.copy(text)} passages={passages} />}
        </div>
        <div className="history-timeline">
          {groups.map((group) => (
            <div className="history-day" key={group.key}>
              <HistoryDayHead group={group} />
              <div className="history-list">
                {hourRuns(group.records).map((run, i, runs) => (
                  <Fragment key={run.key}>
                    {/* One hour needs no mark; two or more get one each, in the time margin. */}
                    {runs.length > 1 && <p className="history-hour" data-first={i === 0 || undefined}><span>{run.label}</span></p>}
                    {run.records.map((record) => (
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
                  </Fragment>
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
