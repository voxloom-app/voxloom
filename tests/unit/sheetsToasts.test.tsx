/// UI PR 9: step dots, shortcuts sheet, toast severity icons.
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsDialog } from '../../src/app/AppDialogs';
import { useToastMessages } from '../../src/app/useToastMessages';
import { Toast, toastTone } from '../../src/components/Toast';

describe('toastTone (toasts board strings)', () => {
  it.each([
    ['Copied to clipboard', 'ok'],
    ['Inserted into Notes', 'ok'],
    ['May have been inserted — also copied', 'warn'],
    ['Text sent to Terminal — input not verified. Inspect before retrying.', 'warn'],
    ['Paste sent (clipboard not restored: clipboard changed during paste — left as-is)', 'warn'],
    ['Paste sent (clipboard not restored: restore did not complete: pasteboard refused the saved items)', 'warn'],
    ['Copy failed', 'err'],
    ['Failed to read history store: unexpected token', 'err'],
    ['Finish the current dictation before retrying', 'err'],
    ['Recovery buffer expired', 'err'],
    ['Shortcut “Ctrl + Space” is in use; kept Ctrl + Shift + Space', 'err'],
  ])('%s → %s', (message, tone) => expect(toastTone(message)).toBe(tone));

  it('renders an icon by severity and an explicit tone wins', () => {
    const { container, rerender } = render(<Toast message="Copied to clipboard" />);
    expect(container.querySelector('.toast')).toHaveClass('t-ok', 'visible');
    expect(container.querySelector('.toast svg')).not.toBeNull();
    rerender(<Toast message="Something odd" tone="err" />);
    expect(container.querySelector('.toast')).toHaveClass('t-err');
    rerender(<Toast message="" />);
    expect(container.querySelector('.toast svg')).toBeNull();
    expect(container.querySelector('.toast')).not.toHaveClass('visible');
  });
});

describe('ShortcutsDialog', () => {
  it('lists both ways to dictate and the window shortcuts, and closes from its header', async () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} opener={null} shortcut="Control+Shift+Space" />);
    const help = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const pages = within(help).getByRole('list', { name: 'Page shortcuts' });
    for (const [i, name] of ['Home', 'History', 'Dictionary', 'Settings'].entries()) {
      expect(within(pages).getAllByRole('listitem')[i]).toHaveTextContent(`${i + 1}${name}`);
    }
    for (const label of ['Recall a dictation', 'Open Settings', 'Show this sheet']) {
      expect(within(help).getByText(label)).toBeInTheDocument();
    }
    expect(within(help).getByText('Hold your shortcut while you speak. Release to finish.')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close Keyboard shortcuts' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('shortcut examples', () => {
  it('prints the side and the name on a Mac modifier key, not just its symbol', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    try {
      render(<ShortcutsDialog onClose={() => {}} opener={null} shortcut="AltRight" />);
      const key = screen.getByRole('region', { name: 'Dictation keys' }).querySelector('kbd');
      expect(key).toHaveTextContent('⌥Right Option');
    } finally { platform.mockRestore(); }
  });

  it('uses the saved key, releases it between the hands-free taps, and cancels on a mode change', () => {
    vi.useFakeTimers();
    try {
      render(<ShortcutsDialog onClose={() => {}} opener={null} shortcut="F17" />);
      const demo = screen.getByRole('region', { name: 'Dictation keys' });
      const keys = demo.querySelector('.shortcut-demo__keys')!;
      expect(keys).toHaveTextContent('F17');
      fireEvent.click(screen.getByRole('radio', { name: 'Hands-free' }));
      expect(within(demo).getByText(/press once to finish/)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Play example' }));
      const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
      advance(260); expect(keys).toHaveAttribute('data-down');
      advance(150); expect(keys).not.toHaveAttribute('data-down');
      advance(90); expect(keys).toHaveAttribute('data-down');
      advance(300); expect(keys).not.toHaveAttribute('data-down');
      fireEvent.click(screen.getByRole('radio', { name: 'Hold to talk' }));
      advance(2000); expect(keys).not.toHaveAttribute('data-down');
      expect(screen.getByRole('button', { name: 'Play example' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Play example' }));
      advance(1500); expect(keys).toHaveAttribute('data-down');
      advance(1500); expect(keys).not.toHaveAttribute('data-down');
      expect(screen.getByRole('button', { name: 'Play example' })).toBeEnabled();
    } finally { vi.useRealTimers(); }
  });
});

describe('review #45 nits', () => {
  it('reads "Error:" before error toasts (visually hidden)', () => {
    const { container, rerender } = render(<Toast message="Copy failed" />);
    expect(container.querySelector('.toast .sr-only')).toHaveTextContent('Error:');
    expect(container.querySelector('.toast')).toHaveTextContent('Error: Copy failed');
    rerender(<Toast message="Copied to clipboard" />);
    expect(container.querySelector('.toast .sr-only')).toBeNull();
  });

  it('shows "Alt" instead of ⌥ off macOS in the Shortcuts sheet', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const { unmount } = render(<ShortcutsDialog onClose={() => {}} opener={null} shortcut="Control+Shift+Space" />);
    const caps = [...document.body.querySelectorAll('.key-combo__caps .kbd')].map((k) => k.textContent);
    expect(caps).toContain('Alt');
    expect(caps).not.toContain('⌥');
    unmount();
    spy.mockReturnValue('MacIntel');
    render(<ShortcutsDialog onClose={() => {}} opener={null} shortcut="Control+Shift+Space" />);
    expect([...document.body.querySelectorAll('.key-combo__caps .kbd')].map((k) => k.textContent)).toContain('⌥');
    spy.mockRestore();
  });

  it('a newer toast is not hidden by the older toast’s timer', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToastMessages([]));
    act(() => result.current.announce('first'));
    act(() => { vi.advanceTimersByTime(1_000); });
    act(() => result.current.announce('second'));
    act(() => { vi.advanceTimersByTime(1_000); }); // first's 1.8 s timer would have fired here
    expect(result.current.toast).toBe('second');
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current.toast).toBe('');
    vi.useRealTimers();
  });
});
