/** Recall and the time index both land on the transcript, never on a row action. */
export function focusHistoryRecord(id: string) {
  const row = document.getElementById(`history-record-${id}`);
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView?.({ block: 'center' });
  row.dataset.recalled = '';
  window.setTimeout(() => { delete row.dataset.recalled; }, 2_400);
}
