import type { HistoryStatus } from '../../domain/types';
import { formatSpoken, type DayGroup } from './historyLoom';

const outcomes: HistoryStatus[] = ['inserted', 'copied', 'failed', 'unverified'];

export function HistoryDayHead({ group }: { group: DayGroup }) {
  const dictations = group.records.length;
  const counts: Record<HistoryStatus, number> = { inserted: 0, copied: 0, failed: 0, unverified: 0 };
  let seconds = 0;
  for (const record of group.records) {
    counts[record.status]++;
    seconds += record.durationSeconds;
  }
  return (
    <header className="history-day__head">
      <div className="ledger-dateline">
        <h2>{group.label}</h2>
        <span>{dictations} {dictations === 1 ? 'dictation' : 'dictations'} · {formatSpoken(seconds)} spoken</span>
      </div>
      <div className="ledger-headings">
        <span className="ledger-headings__time">Run details</span>
        <div className="ledger-key">
          {outcomes.filter((status) => counts[status] > 0).map((status) => (
            <span className={status === 'unverified' ? 'history-day__unsure' : undefined} key={status}>
              <i aria-hidden="true" className="ledger-knot" data-status={status} />
              <span>{counts[status]} {status}{status === 'unverified' && (
                <> · Couldn’t confirm {counts.unverified === 1 ? 'it was' : 'they were'} typed. Check the field before copying or retrying.</>
              )}</span>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}
