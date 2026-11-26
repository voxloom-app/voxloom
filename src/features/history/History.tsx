import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { canStartDictation } from '../../app/state';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { SearchField } from '../../components/SearchField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { canRetry } from '../../domain/records';
import type { DictationRecord, HistoryStatus, Settings } from '../../domain/types';
import { isTauriEnv } from '../../services/capture/captureService';
import { DayLoom } from './DayLoom';
import { HistoryRow } from './HistoryRow';
import {
  dayKey, dayLabel, formatSpoken, groupByDay, loomLayout, looseThreads, tally,
} from './historyLoom';

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
  '30-days': 'Kept for 30 days (Settings › Privacy).',
  forever: 'Kept until you delete them (Settings › Privacy).',
  off: 'Transcript retention is off (Settings › Privacy).',
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * History as a woven day: a dark masthead (the Home stage's material) tallies
 * the latest day and ties each dictation as a knot on its loom, a deck calls
 * out loose threads, and the timeline below groups transcripts by day on one
 * status-knotted thread.
 */
export function History({ onToast }: HistoryProps) {
  const { clipboard, dictation, history, now, state } = useApp();
  const isNative = isTauriEnv();
  const [currentTime, setCurrentTime] = useState(now);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  // The row under the pointer or keyboard focus; its knot lights up on the day loom.
  const [active, setActive] = useState<string | null>(null);
  const sorted = [...state.records].sort((a, b) => b.createdAt - a.createdAt);
  const records = sorted
    .filter((record) => status === 'all' || record.status === status)
    .filter((record) => record.text.toLowerCase().includes(query.toLowerCase()));
  const groups = groupByDay(records, currentTime);

  // The masthead follows the latest day with dictations, whatever the filters show.
  const latest = sorted[0];
  const loomDay = latest ? dayKey(latest.createdAt) : null;
  const dayRecords = sorted.filter((record) => dayKey(record.createdAt) === loomDay);
  const day = tally(dayRecords);
  const layout = loomLayout(dayRecords, currentTime, loomDay === dayKey(currentTime));
  const matches = new Set(records.map((record) => record.id));
  const loose = looseThreads(state.records);
  const looseCount = loose.failed + loose.unverified;

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

  const toggle = (next: HistoryStatus) => setStatus(status === next ? 'all' : next);
  const track = (target: EventTarget | null) => {
    const row = target instanceof Element ? target.closest<HTMLElement>('[data-record]') : null;
    setActive(row?.dataset.record ?? null);
  };

  return (
    <section aria-labelledby="history-title" className="history">
      <header className="stage history-stage">
        <div className="history-stage__top">
          <div className="history-stage__title">
            <h1 id="history-title">History</h1>
            <p className="history-stage__lede">
              {retentionCopy[state.settings.transcriptRetention]}{' '}
              {isNative
                ? 'Audio isn’t saved, so audio retry isn’t available in the desktop app.'
                : 'Failed dictations can be retried while their temporary recovery buffer lasts.'}
            </p>
          </div>
          {latest && (
            <div className="history-stage__tally">
              <p className="history-stage__day">{dayLabel(latest.createdAt, currentTime)}</p>
              <dl>
                <div><dt>{day.dictations === 1 ? 'Dictation' : 'Dictations'}</dt><dd>{day.dictations}</dd></div>
                <div><dt>Words</dt><dd>{day.words}</dd></div>
                <div><dt>Spoken</dt><dd>{formatSpoken(day.seconds)}</dd></div>
              </dl>
            </div>
          )}
        </div>
        <DayLoom active={active} layout={layout} matches={matches} />
        {looseCount > 0 && (
          <div className="history-stage__deck">
            <Icon name="warn" size={15} />
            <p>
              <strong>{plural(looseCount, 'loose thread')}</strong>
              {' · '}
              {[loose.failed && `${loose.failed} failed`, loose.unverified && `${loose.unverified} unverified`]
                .filter(Boolean).join(', ')}
              . Check {looseCount === 1 ? 'it' : 'them'} before you copy or retry.
            </p>
            <div className="history-stage__jump">
              {loose.failed > 0 && (
                <button aria-pressed={status === 'failed'} className="btn" onClick={() => toggle('failed')} type="button">
                  Show failed
                </button>
              )}
              {loose.unverified > 0 && (
                <button aria-pressed={status === 'unverified'} className="btn" onClick={() => toggle('unverified')} type="button">
                  Show unverified
                </button>
              )}
            </div>
          </div>
        )}
      </header>
      <div className="cloth">
        <div className="history-tools">
          <SearchField label="Search history" onChange={setQuery} placeholder="Search transcripts" value={query} />
          <SegmentedControl label="History status" onChange={setStatus} options={filters} size="sm" value={status} />
        </div>
        <div
          className="history-timeline"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(null);
          }}
          onFocus={(event) => track(event.target)}
          onMouseLeave={() => setActive(null)}
          onMouseOver={(event) => track(event.target)}
        >
          {groups.map((group) => {
            const sum = tally(group.records);
            return (
              <div className="history-day" key={group.key}>
                <div className="history-day__head">
                  <h2>{group.label}</h2>
                  <span>{plural(sum.dictations, 'dictation')} · {formatSpoken(sum.seconds)} spoken</span>
                </div>
                <div className="history-list">
                  {group.records.map((record) => (
                    <HistoryRow
                      canStart={canStartDictation(state.dictation)}
                      currentTime={currentTime}
                      isNative={isNative}
                      key={record.id}
                      onCopy={(text) => { void copy(text); }}
                      onDelete={(id) => history.delete(id)}
                      onRetry={retry}
                      record={record}
                    />
                  ))}
                </div>
              </div>
            );
          })}
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
