import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppKeys } from '../../src/app/useAppKeys';
import { beginModal } from '../../src/app/modalState';

function press(options: KeyboardEventInit, target: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ',', ...options });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => vi.restoreAllMocks());

describe('platform Settings shortcut', () => {
  it.each([
    ['Alt/AltGr', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['Windows key', { metaKey: true }],
    ['IME composition', { isComposing: true }],
  ] as const)('does not consume Windows Ctrl+, with %s', (_, extra) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    const event = press({ ctrlKey: true, ...extra });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens Settings with the advertised Ctrl+, on Windows', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    const event = press({ ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('settings');
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['MacIntel', { metaKey: true }],
    ['Linux x86_64', { ctrlKey: true }],
  ] as const)('preserves the advertised primary modifier on %s', (platform, modifier) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    expect(press(modifier).defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('settings');
  });

  it.each([
    ['MacIntel', { ctrlKey: true }],
    ['Win32', { metaKey: true }],
  ] as const)('does not consume the other platform modifier on %s', (platform, modifier) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    expect(press(modifier).defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('preserves intentional Settings navigation from an editable field', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    try {
      expect(press({ ctrlKey: true }, field).defaultPrevented).toBe(true);
      expect(onNavigate).toHaveBeenCalledExactlyOnceWith('settings');
    } finally {
      field.remove();
    }
  });

  it('does not navigate beneath a modal', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onNavigate = vi.fn();
    renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    const close = beginModal();
    try {
      expect(press({ ctrlKey: true }).defaultPrevented).toBe(false);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it('honors blocked state changes and removes its listener on unmount', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onNavigate = vi.fn();
    const { rerender, unmount } = renderHook(({ blocked }) => useAppKeys({ blocked, onHelp: vi.fn(), onNavigate }), {
      initialProps: { blocked: true },
    });
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    rerender({ blocked: false });
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('settings');
    unmount();
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
