import { describe, expect, it } from 'vitest';
import {
  CLEANUP_DELIVERY_MARGIN_MS,
  remainingCleanupBudgetMs,
  STOP_BUDGET_MS,
  STOP_LATE_NOTHING_SAVED,
  stopPendingNote,
  stopSavedNote,
  STOP_CANCELLED_PENDING,
  STOP_CANCELLED_SAVED,
  STOP_CANCELLED_SAVED_HISTORY,
  STOP_TAKING_LONGER_PENDING,
  STOP_TAKING_LONGER_SAVED,
  STOP_TAKING_LONGER_SAVED_HISTORY,
} from '../../../src/services/stt/stopBudget';

describe('stopBudget', () => {
  it('keeps the safety net at 15 seconds and a 2s delivery margin', () => {
    expect(STOP_BUDGET_MS).toBe(15_000);
    expect(CLEANUP_DELIVERY_MARGIN_MS).toBe(2_000);
  });

  it('names History and the clipboard only when the copy succeeded', () => {
    expect(stopSavedNote('cap', true)).toBe(STOP_TAKING_LONGER_SAVED);
    expect(stopSavedNote('cap', false)).toBe(STOP_TAKING_LONGER_SAVED_HISTORY);
    expect(stopSavedNote('cancel', true)).toBe(STOP_CANCELLED_SAVED);
    expect(stopSavedNote('cancel', false)).toBe(STOP_CANCELLED_SAVED_HISTORY);
    expect(stopPendingNote('cap')).toBe(STOP_TAKING_LONGER_PENDING);
    expect(stopPendingNote('cancel')).toBe(STOP_CANCELLED_PENDING);
  });

  it('names the late-failure placeholder for UI/UX review', () => {
    expect(STOP_LATE_NOTHING_SAVED).toBe(
      'Transcription didn\'t finish — nothing was saved.',
    );
  });

  it('shrinks cleanup to whatever is left after the delivery margin, at least 1ms', () => {
    expect(remainingCleanupBudgetMs(0, 0)).toBe(10_000);
    expect(remainingCleanupBudgetMs(0, 5_000)).toBe(8_000);
    expect(remainingCleanupBudgetMs(0, 13_000)).toBe(1);
    expect(remainingCleanupBudgetMs(0, 14_000)).toBe(1);
    expect(remainingCleanupBudgetMs(0, 15_000)).toBe(1);
    expect(remainingCleanupBudgetMs(0, 20_000)).toBe(1);
    // At 12s, 1s remains for cleanup so a 2s insert can still start before 15s.
    expect(remainingCleanupBudgetMs(0, 12_000)).toBe(1_000);
  });
});
