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

describe('platform Settings shortcut: modifiers and keys', () => {
  function opensSettings(platform: string, options: KeyboardEventInit) {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const onNavigate = vi.fn();
    const { unmount } = renderHook(() => useAppKeys({ blocked: false, onHelp: vi.fn(), onNavigate }));
    const event = press(options);
    unmount();
    // Handled means navigated and consumed; anything else must do neither.
    expect(event.defaultPrevented).toBe(onNavigate.mock.calls.length === 1);
    return onNavigate.mock.calls.length === 1;
  }

  it.each([
    ['Cmd+Ctrl', { metaKey: true, ctrlKey: true }],
    ['Cmd+Alt', { metaKey: true, altKey: true }],
    ['Cmd+Shift', { metaKey: true, shiftKey: true }],
    ['Cmd during IME composition', { metaKey: true, isComposing: true }],
    ['Ctrl alone', { ctrlKey: true }],
  ] as const)('does not open Settings on Mac with %s', (_, modifiers) => {
    expect(opensSettings('MacIntel', modifiers)).toBe(false);
  });

  it('opens Settings on Mac with Cmd+, and on Linux with Ctrl+, but not Meta+,', () => {
    expect(opensSettings('MacIntel', { metaKey: true })).toBe(true);
    expect(opensSettings('Linux x86_64', { ctrlKey: true })).toBe(true);
    expect(opensSettings('Linux x86_64', { metaKey: true })).toBe(false);
  });

  it.each(['MacIntel', 'Win32'])('ignores other keys with the primary modifier on %s', (platform) => {
    const modifier = platform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true };
    expect(opensSettings(platform, { ...modifier, key: '.', code: 'Period' })).toBe(false);
    expect(opensSettings(platform, { ...modifier, key: 'a', code: 'KeyA' })).toBe(false);
  });

  describe('physical comma key (code Comma)', () => {
    it('opens Settings where the layout puts a non-Latin letter on the comma key', () => {
      // Russian: the comma itself needs Shift, so Ctrl+, never reports key ",".
      expect(opensSettings('Win32', { ctrlKey: true, key: 'б', code: 'Comma' })).toBe(true);
      expect(opensSettings('MacIntel', { metaKey: true, key: 'б', code: 'Comma' })).toBe(true);
    });

    it.each([
      ['Shift', { shiftKey: true }],
      ['Alt/AltGr', { altKey: true }],
      ['IME composition', { isComposing: true }],
    ] as const)('still rejects %s', (_, extra) => {
      expect(opensSettings('Win32', { ctrlKey: true, key: 'б', code: 'Comma', ...extra })).toBe(false);
    });

    it('does not consume the other platform modifier', () => {
      expect(opensSettings('Win32', { metaKey: true, key: 'б', code: 'Comma' })).toBe(false);
      expect(opensSettings('MacIntel', { ctrlKey: true, key: 'б', code: 'Comma' })).toBe(false);
    });

    it.each([
      ['Dvorak, where the physical comma key is W', 'w'],
      ['AZERTY, where the physical comma key is ;', ';'],
    ])('leaves Latin layouts alone: %s', (_, key) => {
      expect(opensSettings('Win32', { ctrlKey: true, key, code: 'Comma' })).toBe(false);
    });
  });
});
