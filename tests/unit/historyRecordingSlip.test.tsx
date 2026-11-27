import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { DictationRecord } from '../../src/domain/types';
import { HistoryRow } from '../../src/features/history/HistoryRow';

it('opens the recording behind a timestamp without copying, retrying, or changing its outcome', async () => {
  const user = userEvent.setup();
  const record: DictationRecord = {
    id: 'slip', createdAt: 120_000, durationSeconds: 16, model: 'Example model', status: 'unverified',
    recoveryExpiresAt: null, style: 'very-casual', text: 'Meet at the gate.', mayHaveInserted: { copied: true },
  };
  const onCopy = vi.fn(), onRetry = vi.fn(), onDelete = vi.fn();
  render(<HistoryRow canStart currentTime={150_000} isNative record={record} {...{ onCopy, onRetry, onDelete }} />);
  const stamp = screen.getByRole('button', { name: /Recording details.*Unverified/i });
  expect(stamp).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: /Recording details/ })).toBeNull();
  expect(screen.getByText(/also copied/i, { selector: '.history-row__exception' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Retry transcription' })).toBeNull();
  stamp.focus();
  await user.keyboard('{Enter}');
  const slip = screen.getByRole('region', { name: /Recording details/ });
  expect(stamp).toHaveAttribute('aria-expanded', 'true');
  expect(stamp).toHaveAttribute('aria-controls', slip.id);
  for (const field of ['Unverified', '16s', 'Example model', 'Very Casual']) {
    expect(within(slip).getByText(field)).toBeVisible();
  }
  expect(within(slip).getByText('May have been inserted (also copied). Check the field before copying or retrying.')).toBeVisible();
  await user.keyboard(' ');
  expect(screen.queryByRole('region', { name: /Recording details/ })).toBeNull();
  expect(stamp).toHaveFocus();
  expect(onCopy).not.toHaveBeenCalled();
  expect(onRetry).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
});
