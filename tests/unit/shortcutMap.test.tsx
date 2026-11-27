import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../../src/features/settings/Settings';
import { ShortcutRecorder } from '../../src/features/settings/ShortcutRecorder';
import { resetActiveShortcut, setActiveShortcut } from '../../src/services/shortcut/activeShortcut';
import { renderWithApp } from './testUtils';

const saved = 'Ctrl + Shift + Space';
const plotted = (field: HTMLElement) => Array.from(field.querySelectorAll('[data-plotted]'), (key) => key.getAttribute('data-key'));

afterEach(() => resetActiveShortcut());

describe('Shortcut key map', () => {
  it('pairs a single focusable recorder with a legible chord and an illustrative US keyboard', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    const field = screen.getByRole('button', { name: 'Shortcut Control Shift Space. Change keys' });
    expect(field).toHaveTextContent('US key map');
    expect(field.querySelector('.key-map__legend')).toHaveTextContent(/Control.*Shift.*Space/);
    expect(plotted(field).sort()).toEqual(['Ctrl', 'Shift', 'Space']);
    expect(field.querySelector('svg.key-map__diagram')).toHaveAttribute('aria-hidden', 'true');
    expect(within(field).queryByRole('button')).toBeNull();
    field.focus();
    await user.keyboard('{Enter}');
    expect(plotted(field)).toEqual([]);
    fireEvent.keyDown(window, { altKey: true, code: 'AltRight', key: 'Alt' });
    expect(plotted(field)).toEqual(['AltRight']);
    expect(field.querySelector('.key-map__legend')).toHaveTextContent('Right Option');
    await user.keyboard('{Escape}');
    expect(plotted(field).sort()).toEqual(['Ctrl', 'Shift', 'Space']);
    expect(field).toHaveFocus();
  });

  it.each([
    ['F19', ['F19']], ['controlright', ['ControlRight']], ['Cmd + Enter', ['Meta', 'Enter']],
    ['Alt + Backspace', ['Alt', 'Backspace']], ['Ctrl + 9', ['Ctrl', '9']], ['CmdOrCtrl + Tab', ['Meta', 'Tab']],
  ] as const)('plots %s without suggesting extra keys', (combo, keys) => {
    render(<ShortcutRecorder defaultValue={saved} onChange={vi.fn()} value={combo} />);
    expect(plotted(screen.getByRole('button', { name: /^Dictation shortcut/ })).sort()).toEqual([...keys].sort());
  });

  it('keeps a refused binding readable but does not light it as usable', () => {
    render(<ShortcutRecorder defaultValue={saved} onChange={vi.fn()} value={saved} />);
    act(() => setActiveShortcut(null));
    const field = screen.getByRole('button', { name: /not active/ });
    expect(plotted(field)).toEqual([]);
    expect(field.querySelector('.key-map__legend')).toHaveTextContent(/Control.*Shift.*Space/);
  });
});
