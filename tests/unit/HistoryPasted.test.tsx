import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryRow } from '../../src/features/history/HistoryRow';
import type { DictationRecord } from '../../src/domain/types';

const base: DictationRecord = {
  createdAt: 1_000, durationSeconds: 1, id: 'p', model: null,
  recoveryExpiresAt: null, status: 'pasted', style: 'formal', text: 'hi',
};

function row(record: DictationRecord) {
  render(<HistoryRow canStart currentTime={2_000} isNative onCopy={() => {}} onDelete={() => {}} onRetry={() => {}} record={record} />);
  return screen.getByRole('article');
}

describe('History Pasted rows', () => {
  it('shows a neutral Pasted badge with no warning note', () => {
    const article = row(base);
    const badge = within(article).getByText('Pasted');
    expect(badge.className).toBe('badge badge--pasted');
    expect(article).toHaveAttribute('data-status', 'pasted');
    expect(article.querySelector('.recovery-state')).toBeNull();
    expect(within(article).queryByText(/Unverified|not verified/)).toBeNull();
  });

  it('keeps the warning on a legacy unflagged Unverified row', () => {
    const article = row({ ...base, status: 'unverified' });
    expect(within(article).getByText('Unverified')).toBeInTheDocument();
    expect(within(article).getByText(/Input not verified\. Inspect before copying or retrying\./))
      .toBeInTheDocument();
  });
});
