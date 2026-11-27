import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../../src/features/settings/Settings';
import { isTauriEnv } from '../../src/services/capture/captureService';
import { renderWithApp } from './testUtils';

afterEach(() => vi.mocked(isTauriEnv).mockReturnValue(false));

describe('Settings panes are the voice path (UI PR 6a, ui-iter-13)', () => {
  const tab = (name: RegExp) => screen.getByRole('tab', { name });

  it('has one tab per stop in path order, Appearance last, with arrow-key navigation', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    const tabs = within(screen.getByRole('tablist', { name: 'Settings sections' })).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['Shortcut', 'Microphone', 'Speech', 'Cleanup', 'Output', 'Transcripts', 'Appearance']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    const panel = screen.getByRole('tabpanel', { name: /^Shortcut/ });
    expect(within(panel).getByRole('heading', { level: 2, name: 'Shortcut' })).toBeInTheDocument();
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(tab(/^Microphone/)).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab(/^Microphone/));
    await user.keyboard('{ArrowDown}');
    expect(tab(/^Speech/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    const appearance = screen.getByRole('tabpanel', { name: /^Appearance/ });
    expect(appearance).toHaveTextContent('Nothing here changes what you dictate');
    expect(within(appearance).getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(tab(/^Shortcut/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(tab(/^Appearance/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tab(/^Shortcut/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel-shortcut');
    expect(tab(/^Shortcut/)).toHaveAttribute('aria-controls', 'settings-panel-shortcut');
  });

  it('says what each setting does in one sentence, with no stop counter or Previous/Next walk', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(screen.getByText(/Pick an underlined part to change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /stop:/ })).toBeNull();
    expect(screen.queryByText(/Stop \d of 6/)).toBeNull();
    await user.click(tab(/^Output/));
    expect(screen.getByRole('tabpanel', { name: /^Output/ })).toHaveTextContent('never presses Return or Send');
    expect(screen.queryByRole('button', { name: /stop:/ })).toBeNull();
  });

  it('keeps every CHECKLIST Settings feature reachable in the browser preview', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    // S1–S11, pane by pane along the path
    expect(screen.getByRole('button', { name: 'Set up shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Shortcut|App-local shortcut|Global shortcut) / })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Start at login · simulated' })).toBeEnabled();
    await user.click(tab(/^Microphone/));
    expect(screen.getByLabelText('Microphone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh microphones/ })).toBeInTheDocument();
    expect(screen.getByText('Microphone test')).toBeInTheDocument();
    await user.click(tab(/^Speech/));
    expect(screen.getByRole('option', { name: 'English (UK)' })).toBeInTheDocument();
    await user.click(tab(/^Cleanup/));
    expect(screen.getByRole('radiogroup', { name: 'Current style' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Language-processing model/)).toBeEnabled();
    await user.click(tab(/^Output/));
    expect(screen.getByRole('switch', { name: 'Clipboard fallback' })).toBeEnabled();
    // A1
    await user.click(tab(/^Appearance/));
    expect(screen.getAllByRole('radio', { name: /system|Light|Dark/ })).toHaveLength(3); // Follow system · Light · Dark (Sodium Rain removed, PR 10)
    // BUS-41 PR 3: Text size segmented control
    const textSize = screen.getByRole('radiogroup', { name: 'Text size' });
    expect(within(textSize).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Small', 'Default', 'Large']);
    expect(within(textSize).getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Recording indicator')).toBeInTheDocument();
    // R1–R3, E1
    await user.click(tab(/^Transcripts/));
    expect(screen.getByRole('radiogroup', { name: 'Transcript retention' })).toBeInTheDocument();
    expect(screen.getByLabelText('Audio retention')).toBeEnabled();
    expect(screen.getByText('Stays on this Mac')).toBeInTheDocument();
    expect(document.querySelectorAll('.recovery-item')).toHaveLength(6);
    for (const item of document.querySelectorAll('.recovery-item')) expect(item.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/Temporary recovery buffers expire/)).toBeInTheDocument();
    expect(screen.getByText('Download a speech-to-text model in Speech.')).toBeInTheDocument();
  });

  it('toggles clipboard fallback through the switch', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings initialTab="output" onSetup={vi.fn()} />);
    const fallback = screen.getByRole('switch', { name: 'Clipboard fallback' });
    const before = fallback.getAttribute('aria-checked');
    await user.click(fallback);
    expect(fallback.getAttribute('aria-checked')).not.toBe(before);
    expect(fallback).toHaveAccessibleDescription(/pastes through your clipboard/);
  });

  it('hides browser-only rows in the native app', async () => {
    vi.mocked(isTauriEnv).mockReturnValue(true);
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(screen.getByRole('switch', { name: /Start at login · unavailable/ })).toBeDisabled();
    await user.click(tab(/^Speech/));
    expect(screen.queryByRole('option', { name: 'English (UK)' })).toBeNull();
    expect(screen.getByText('English-first')).toBeInTheDocument();
    await user.click(tab(/^Cleanup/));
    expect(screen.queryByLabelText(/Language-processing model/)).toBeNull();
  });
});

describe('Settings breakpoints (designer #41)', () => {
  it('the 760px Settings window never hits the collapse: it starts below 640px', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['settings.css', 'responsive.css']) {
      const css = readFileSync(`src/styles/${file}`, 'utf8');
      for (const m of css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)) {
        if (/recovery-grid|appearance-options|settings-rows/.test(m[2])) expect(Number(m[1])).toBeLessThan(760);
      }
    }
  });
});
