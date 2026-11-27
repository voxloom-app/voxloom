import { formatSpoken, type DayGroup } from './historyLoom';

/** The date, how much was said, and (only when it applies) the day's one Unverified
 * caution. Outcome counts live on the status filter above the list (ui-iter-39). */
export function HistoryDayHead({ group }: { group: DayGroup }) {
  const dictations = group.records.length;
  let seconds = 0;
  let unverified = 0;
  for (const record of group.records) {
    seconds += record.durationSeconds;
    if (record.status === 'unverified') unverified++;
  }
  return (
    <header className="history-day__head">
      <div className="ledger-dateline">
        <h2>{group.label}</h2>
        <span>{dictations} {dictations === 1 ? 'dictation' : 'dictations'} · {formatSpoken(seconds)} spoken</span>
      </div>
      {unverified > 0 && (
        <p className="history-day__unsure">
          <i aria-hidden="true" className="ledger-knot" data-status="unverified" />
          <span>
            {unverified} unverified · Couldn’t confirm {unverified === 1 ? 'it was' : 'they were'} typed.
            Check the field before copying or retrying.
          </span>
        </p>
      )}
    </header>
  );
}
