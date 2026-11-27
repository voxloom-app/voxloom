/// BUS-220 · Option A: the welcome step previews the three setup steps as numbered rows.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { Onboarding } from '../../src/features/onboarding/Onboarding';
import type { SetupBoundary } from '../../src/features/onboarding/guidedSetup';
import { renderWithApp } from './testUtils';

const storage = () => ({ read: () => null, write: vi.fn() });
const setupBoundary = (): SetupBoundary => ({
  native: true, query: vi.fn().mockResolvedValue({ microphone: 'authorized', accessibility: 'authorized' }),
  readiness: vi.fn(async (modelId) => ({ modelId, ready: true, reason: null })),
  request: vi.fn(), openSettings: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(), activeShortcut: () => 'Ctrl + Shift + Space',
});

function SetShortcut({ value }: { value: string }) {
  const { settings } = useApp();
  return <button onClick={() => settings.update({ key: 'shortcut', value })} type="button">Set test shortcut</button>;
}

describe('guided setup welcome (step 0)', () => {
  it('shows one setup outline on the cover, before the progress rail is needed', () => {
    renderWithApp(<Onboarding boundary={setupBoundary()} onClose={vi.fn()} progressStorage={storage()} />);
    const list = screen.getByRole('list', { name: 'Setup steps' });
    expect(list.tagName).toBe('OL');
    // WebKit drops list semantics with list-style: none, so the role is explicit.
    expect(list).toHaveAttribute('role', 'list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const titles = within(list).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(screen.queryByRole('complementary', { name: 'Setup progress' })).not.toBeInTheDocument();
    expect(titles).toEqual(['Get connected', 'Your shortcut', 'First words']);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Allow Microphone and Accessibility.');
    expect(rows[2]).toHaveTextContent('Try a short dictation both ways.');
    for (const [index, row] of rows.entries()) {
      const badge = row.querySelector('.guided-steps-badge');
      expect(badge).toHaveTextContent(String(index + 1));
      expect(badge).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.queryByText('A LITTLE PREVIEW')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Illustrative preview/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect your microphone, typing and keyboard access/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Input Monitoring/)).not.toBeInTheDocument();
    expect(screen.getByText(/Starting setup downloads Whisper Base/)).toHaveTextContent('148 MB');
  });

  it('teaches both gestures before setup without requesting access or downloading a model', async () => {
    const user = userEvent.setup();
    const io = setupBoundary();
    renderWithApp(<Onboarding boundary={io} onClose={vi.fn()} progressStorage={storage()} />);
    const preview = screen.getByRole('button', { name: 'Preview the gestures' });
    expect(preview).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Gesture guide' })).not.toBeInTheDocument();
    await user.click(preview);
    expect(preview).toHaveAttribute('aria-expanded', 'true');
    const guide = screen.getByRole('region', { name: 'Gesture guide' });
    const hold = within(guide).getByRole('radio', { name: 'Hold to talk' });
    const handsFree = within(guide).getByRole('radio', { name: 'Hands-free' });
    expect(hold).toBeChecked();
    await user.click(hold);
    await user.keyboard('{ArrowRight}');
    expect(handsFree).toHaveFocus();
    expect(handsFree).toBeChecked();
    expect(guide).toHaveTextContent('Double-tap, speak with the keys up, then press once to finish.');
    await user.click(within(guide).getByRole('button', { name: 'Watch example' }));
    expect(guide).toHaveTextContent('Tracing gesture…');
    await user.click(hold);
    expect(hold).toBeChecked();
    expect(guide).toHaveTextContent('Meet me at noon.');
    expect(guide).toHaveTextContent('Hold your shortcut while you speak. Release to finish.');
    await user.click(screen.getByRole('button', { name: 'Close gesture preview' }));
    expect(preview).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Gesture guide' })).not.toBeInTheDocument();
    expect(io.request).not.toHaveBeenCalled();
    expect(io.download).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Start setup/ })).toBeEnabled();
  });

  it('shows the live shortcut as key caps in the shortcut row', async () => {
    const user = userEvent.setup();
    renderWithApp(<><Onboarding boundary={setupBoundary()} onClose={vi.fn()} progressStorage={storage()} /><SetShortcut value="Alt + D" /></>);
    const row = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')[1];
    expect(row).toHaveTextContent(/^02Your shortcutKeep .*Control Shift Space, or pick your own keys\.$/);
    expect(row.querySelectorAll('.kbd')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Set test shortcut' }));
    expect(row).not.toHaveTextContent('Control Shift Space');
    expect(row.querySelector('.key-combo .sr-only')).toHaveTextContent(/^(Option|Alt) D$/);
    expect(row.querySelectorAll('.kbd')).toHaveLength(2);
  });
});
