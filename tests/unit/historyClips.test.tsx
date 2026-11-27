import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createRecords } from '../../src/domain/fixtures';
import { canClip } from '../../src/features/history/ClippingSheet';
import { History } from '../../src/features/history/History';
import { renderWithApp } from './testUtils';

const rows = () => screen.getAllByRole('article');
const review = () => screen.getByRole('button', { name: /^Open clipping sheet/ });
const clip = (row: HTMLElement) => within(row).getByRole('button', { name: /^Clip passage/ });

describe('History clipping sheet', () => {
  it('keeps clips through filters, previews oldest first, and copies only on request', async () => {
    const user = userEvent.setup();
    renderWithApp(<History onToast={vi.fn()} />);
    const [newer, older, failed] = rows();
    const texts = [older, newer].map((row) => within(row).getByRole('heading').textContent!);
    expect(within(failed).queryByRole('button', { name: /^Clip passage/ })).toBeNull();
    await user.click(clip(newer));
    expect(clip(newer)).toHaveAttribute('aria-pressed', 'true');
    await user.click(clip(older));
    await user.click(screen.getByRole('radio', { name: 'Failed' }));
    expect(rows()).toHaveLength(1);
    const opener = review();
    expect(opener).toHaveAccessibleName(/2 passages/);
    await user.click(opener);
    const sheet = screen.getByRole('dialog', { name: 'Clipping sheet' });
    const passages = within(sheet).getAllByRole('listitem');
    expect(passages.map((li) => li.querySelector('p')?.textContent)).toEqual(texts);
    expect(await navigator.clipboard.readText()).toBe('');
    await user.click(within(sheet).getByRole('button', { name: 'Copy passages' }));
    expect(await navigator.clipboard.readText()).toBe(texts.join('\n\n'));
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('excludes empty text, failures and uncertain deliveries even if also copied', () => {
    const [sample] = createRecords(100_000);
    expect(canClip({ ...sample, text: ' \n ' })).toBe(false);
    expect(canClip({ ...sample, status: 'failed' })).toBe(false);
    expect(canClip({ ...sample, status: 'unverified' })).toBe(false);
    expect(canClip({ ...sample, mayHaveInserted: { copied: true }, status: 'unverified' })).toBe(false);
  });

  it('reports a clipboard failure in the sheet without discarding clips or retrying', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('Unavailable'));
    renderWithApp(<History onToast={vi.fn()} />);
    await user.click(clip(rows()[0]));
    await user.click(review());
    const sheet = screen.getByRole('dialog', { name: 'Clipping sheet' });
    await user.click(within(sheet).getByRole('button', { name: 'Copy passages' }));
    expect(within(sheet).getByRole('status')).toHaveTextContent('Couldn’t copy. Your selection is still here.');
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('unclips without modifying History, and cannot copy a deleted passage', async () => {
    const user = userEvent.setup();
    renderWithApp(<History onToast={vi.fn()} />);
    await user.click(clip(rows()[0]));
    await user.click(clip(rows()[0]));
    expect(clip(rows()[0])).toHaveAttribute('aria-pressed', 'false');
    expect(rows()).toHaveLength(6);
    await user.click(clip(rows()[0]));
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Delete transcript' }));
    await user.click(review());
    const sheet = screen.getByRole('dialog', { name: 'Clipping sheet' });
    expect(within(sheet).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(sheet).getByRole('button', { name: 'Copy passages' })).toBeDisabled();
  });
});
