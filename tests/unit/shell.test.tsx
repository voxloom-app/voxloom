import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';
import { Switch } from '../../src/components/Switch';
import { screenForAltDigit } from '../../src/app/shell/screens';
import { RailTools } from '../../src/app/shell/RailTools';
import { Sidebar } from '../../src/app/shell/Sidebar';
import { Home } from '../../src/features/home/Home';
import { LoomBar } from '../../src/features/home/LoomBar';
import { isTauriEnv } from '../../src/services/capture/captureService';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

const dogfood = (over: Partial<UseDogfoodCaptureResult> = {}): UseDogfoodCaptureResult => ({
  cancel: vi.fn(), captureState: { kind: 'idle' }, hudResult: null, intendedTarget: null, message: null,
  origin: null, phase: 'idle', scopeReady: false, hudReady: false, start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined), transcript: null, ...over,
});

async function renderShell() {
  const user = userEvent.setup();
  renderWithApp(<App />);
  await user.click(screen.getByRole('button', { name: 'Set up later' }));
  return user;
}

const current = () => within(screen.getByRole('navigation', { name: 'Voxloom screens' }))
  .getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.getAttribute('aria-label');

afterEach(() => vi.mocked(isTauriEnv).mockReturnValue(false));

describe('App shell (UI PR 3)', () => {
  it('has three sidebar screens, the brand status line and the short hint', async () => {
    const user = await renderShell();
    const nav = screen.getByRole('navigation', { name: 'Voxloom screens' });
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Home', 'History', 'Dictionary']);
    const status = document.querySelector('.brand__status')!;
    expect(status).toHaveTextContent('Setup incomplete');
    expect(status).not.toHaveAttribute('aria-label');
    // ui-iter-17: Home's stage already shows the keys, so the rail says them only on other pages.
    const rail = document.querySelector('aside.sidebar')!;
    expect(rail.querySelector('.rail-key')).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(nav).getByRole('button', { name: 'History' }));
    // ui-iter-03: the shortcut lives in the rail's dock as key caps, spoken for screen readers.
    const dock = rail.querySelector('.rail-key')!;
    expect([...dock.querySelectorAll('.kbd')].map((k) => k.textContent)).toEqual(['⌃', '⇧', 'Space']);
    expect(dock).toHaveTextContent('Control Shift Space');
    expect(dock).toHaveTextContent(/^Hold .* in any app to dictate$/);
    expect(screen.queryByText(/Global hold\/latch snapshots/)).not.toBeInTheDocument();
  });

  it('⌥1–3 navigate, including the macOS Option-digit key values', async () => {
    const user = await renderShell();
    await user.keyboard('{Alt>}3{/Alt}');
    expect(current()).toBe('Dictionary');
    fireEvent.keyDown(document, { altKey: true, code: 'Digit2', key: '™' });
    expect(current()).toBe('History');
    fireEvent.keyDown(document, { altKey: true, code: 'Digit1', key: '¡' });
    expect(current()).toBe('Home');
  });

  it('ignores ⌥-digits while typing or composing, and with other modifiers', async () => {
    await renderShell();
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    document.body.append(input, editable, textarea, select);
    const alt2 = { altKey: true, code: 'Digit2', key: '™' };
    fireEvent.keyDown(input, alt2);
    fireEvent.keyDown(textarea, alt2);
    fireEvent.keyDown(select, alt2);
    fireEvent.keyDown(editable, alt2);
    fireEvent.keyDown(document, { ...alt2, isComposing: true });
    fireEvent.keyDown(document, { ...alt2, metaKey: true });
    fireEvent.keyDown(document, { ...alt2, ctrlKey: true });
    fireEvent.keyDown(document, { ...alt2, shiftKey: true });
    expect(current()).toBe('Home');
    input.remove();
    editable.remove();
    textarea.remove();
    select.remove();
  });

  it('⌥-digits still navigate from non-text inputs (radio, checkbox)', async () => {
    await renderShell();
    const radio = document.createElement('input');
    radio.type = 'radio';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(radio, checkbox);
    fireEvent.keyDown(radio, { altKey: true, code: 'Digit2', key: '™' });
    expect(current()).toBe('History');
    fireEvent.keyDown(checkbox, { altKey: true, code: 'Digit3', key: '£' });
    expect(current()).toBe('Dictionary');
    radio.remove();
    checkbox.remove();
  });

  it('⌥2 still navigates while a SegmentedControl radio or a Switch has focus', async () => {
    const user = await renderShell();
    const casual = screen.getByRole('radio', { name: /^Casual$/ });
    casual.focus();
    await user.keyboard('{Alt>}2{/Alt}');
    expect(current()).toBe('History');
    render(<Switch checked={false} label="Probe switch" onChange={vi.fn()} />);
    const probe = screen.getByRole('switch', { name: 'Probe switch' });
    probe.focus();
    fireEvent.keyDown(probe, { altKey: true, code: 'Digit1', key: '¡' });
    expect(current()).toBe('Home');
  });

  it('prevents the default action only when ⌥-digit navigates', async () => {
    await renderShell();
    expect(fireEvent.keyDown(document, { altKey: true, code: 'Digit2', key: '™' })).toBe(false);
    expect(current()).toBe('History');
    expect(fireEvent.keyDown(document, { altKey: true, code: 'Digit7', key: '¶' })).toBe(true);
  });

  it('opens Settings from the rail, ⌥4 and ⌘,', async () => {
    const user = await renderShell();
    const settings = within(document.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: 'Settings' });
    await user.click(settings);
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(current()).toBeUndefined();
    await user.keyboard('{Alt>}1{/Alt}');
    await user.keyboard('{Alt>}4{/Alt}');
    expect(settings).toHaveAttribute('aria-current', 'page');
    await user.keyboard('{Alt>}1{/Alt}');
    fireEvent.keyDown(document, { key: ',', metaKey: true });
    expect(settings).toHaveAttribute('aria-current', 'page');
  });

  it('maps Alt digits to screens', () => {
    expect(['1', '2', '3', '4', '5'].map(screenForAltDigit))
      .toEqual(['home', 'history', 'dictionary', 'settings', null]);
  });
});

describe('Home (UI PR 3)', () => {
  it('shows a status badge on the last pick; earlier rows name theirs once, in the knot key', () => {
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const rows = document.querySelectorAll('.home .recent-row');
    expect(rows).toHaveLength(4);
    expect(document.querySelector('.home .pick .badge')).toHaveAttribute('data-status', 'inserted');
    // ui-iter-29: no pill per row; each row keeps its status for screen readers.
    rows.forEach((row) => {
      expect(row.querySelector('.badge')).toBeNull();
      expect(row.querySelector('.sr-only')?.textContent).toMatch(/^(Inserted|Copied|Unverified)$/);
    });
    expect(document.querySelector('.earlier__key')).toHaveTextContent('2 copied2 inserted');
  });

  it('keeps the writing style caption ahead of its control', () => {
    vi.mocked(isTauriEnv).mockReturnValue(true);
    renderWithApp(<Home dogfood={dogfood()} onToast={vi.fn()} />);
    const caption = screen.getByText('Writing style');
    // Caption precedes the segmented control.
    expect(caption.compareDocumentPosition(screen.getByRole('radiogroup', { name: 'Current writing style' })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('Start on the stage (ui-iter-21)', () => {
  const bar = (over: Partial<UseDogfoodCaptureResult> = {}, isNative = true) => {
    const run = dogfood(over);
    render(<LoomBar capture={{ dogfood: run, isNative, onCopy: vi.fn() }} pick={null} />);
    return run;
  };

  it('starts a run from the stage and says where the words may go', async () => {
    const run = bar();
    const start = screen.getByRole('button', { name: 'Start dictating' });
    expect(start).toBeEnabled();
    expect(start).toHaveAccessibleDescription('Starting here focuses Voxloom, so the words may be copied instead of inserted.');
    expect(screen.queryByText(/needs the Voxloom desktop app/)).not.toBeInTheDocument();
    await userEvent.setup().click(start);
    expect(run.start).toHaveBeenCalledOnce();
  });

  it('is disabled with a note in the browser preview', () => {
    bar({}, false);
    expect(screen.getByRole('button', { name: 'Start dictating' })).toBeDisabled();
    expect(screen.getByText('Dictating here needs the Voxloom desktop app.')).toBeInTheDocument();
  });

  it('shows Stop/Cancel while recording and Transcribing… while busy', async () => {
    const user = userEvent.setup();
    const run = bar({ phase: 'recording' });
    expect(screen.queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(run.stop).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(run.cancel).toHaveBeenCalledOnce();
    cleanup();
    bar({ phase: 'transcribing' });
    expect(screen.getByText('Transcribing…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Stop for a latched or held run from the shortcut too', () => {
    bar({ captureState: { device: 'Mic', generation: 1, kind: 'active', request_id: 'latch-1' } });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(document.querySelector('.dictate')).toHaveAttribute('data-state', 'recording');
  });

  it('shows Cleaning up… while local cleanup runs (BUS-16)', () => {
    bar({ phase: 'cleaning' });
    expect(screen.getByText('Cleaning up…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
  });

  it('hangs a run\'s outcome beneath the capsule', () => {
    bar({ message: 'Inserted into the focused app.', phase: 'success' });
    expect(screen.getByRole('status')).toHaveTextContent('Inserted into the focused app.');
    expect(screen.getByRole('status').closest('.loom-bar__hang')).not.toBeNull();
  });

  it('ties the outcome tag off with the HUD\'s knot for what happened (ui-iter-17)', () => {
    const tag = () => screen.getByRole('status');
    const knot = () => tag().querySelector('svg.run-tag__knot')!;
    bar({ message: 'Inserted into the focused app.', phase: 'success' });
    expect(tag()).toHaveAttribute('data-tone', 'ok');
    expect(knot()).toHaveAttribute('aria-hidden', 'true');
    expect(knot().querySelector('.knot__core')).not.toBeNull();
    cleanup();
    bar({ message: 'Copied — paste it where you need it.', phase: 'success' });
    expect(tag()).toHaveAttribute('data-tone', 'warn');
    cleanup();
    // A cancelled run frays, and the words are spoken exactly as written.
    bar({ message: 'Capture cancelled — nothing transcribed.', phase: 'cancelled' });
    expect(tag()).toHaveAttribute('data-tone', 'err');
    expect(knot().querySelector('.knot__fray')).not.toBeNull();
    expect(tag().textContent).toBe('Capture cancelled — nothing transcribed.');
  });

  it('lives on Home\'s stage only; the rail carries no Start on any page', async () => {
    const user = await renderShell();
    const rail = () => document.querySelector('.sidebar') as HTMLElement;
    const stage = document.querySelector('.home-hero') as HTMLElement;
    expect(within(stage).getByRole('button', { name: 'Start dictating' })).toBeDisabled();
    expect(within(rail()).queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
    for (const page of ['History', 'Dictionary']) {
      await user.click(within(screen.getByRole('navigation', { name: 'Voxloom screens' })).getByRole('button', { name: page }));
      expect(current()).toBe(page);
      expect(screen.queryByRole('button', { name: 'Start dictating' })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Dictate' })).not.toBeInTheDocument();
  });
});

describe('Quiet rail foot (ui-iter-21)', () => {
  const rail = (run: UseDogfoodCaptureResult, page: 'home' | 'history') => renderWithApp(
    <Sidebar capture={{ dogfood: run, isNative: true, onCopy: vi.fn() }} onNavigate={() => {}} onReset={() => {}} screen={page} shortcut="Control+Shift+Space" status="Ready" />,
  );

  it('lets the outcome tag stand in for the keys hint on other pages (ui-iter-17)', () => {
    rail(dogfood({ message: 'Inserted into the focused app.', phase: 'success' }), 'history');
    expect(screen.getByRole('status')).toHaveTextContent('Inserted into the focused app.');
    expect(document.querySelector('.rail-key')).toBeNull();
  });

  it('lets you finish a run from another page with Stop and Cancel', async () => {
    const user = userEvent.setup();
    const run = dogfood({ phase: 'recording' });
    rail(run, 'history');
    // Scoped to the foot: the Developer panel has its own synthetic Cancel.
    const foot = document.querySelector('.rail-foot') as HTMLElement;
    await user.click(within(foot).getByRole('button', { name: 'Stop' }));
    expect(run.stop).toHaveBeenCalledOnce();
    await user.click(within(foot).getByRole('button', { name: 'Cancel' }));
    expect(run.cancel).toHaveBeenCalledOnce();
    cleanup();
    rail(dogfood({ phase: 'transcribing' }), 'history');
    expect(screen.getByText('Transcribing…')).toHaveAttribute('role', 'status');
  });

  it('stays out of the way on Home, where the stage holds the run', () => {
    rail(dogfood({ message: 'Inserted into the focused app.', phase: 'recording' }), 'home');
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    expect(within(sidebar).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('status')).not.toBeInTheDocument();
    expect(sidebar.querySelector('.rail-warp, .rail-cloth, .rail-shuttle')).toBeNull();
  });
});

describe('No toolbar (ui-iter-27; designer: standard macOS title bar)', () => {
  it('names the app once, in the rail, in the browser preview and natively', () => {
    const { unmount, container } = renderWithApp(<App />);
    expect(container.querySelector('#app-shell > header, .titlebar')).toBeNull();
    expect(container.querySelector('.brand__name')).toHaveTextContent('Voxloom');
    unmount();
    vi.mocked(isTauriEnv).mockReturnValue(true);
    const native = renderWithApp(<App />);
    expect(native.container.querySelector('#app-shell > header, .titlebar')).toBeNull();
    expect(native.container.querySelectorAll('.brand__name')).toHaveLength(1);
  });
});

describe('off-Mac shell labels (QA #45)', () => {
  it('the rail says Ctrl+,, Alt+1–3 and Ctrl+Shift+Space', () => {
    const spy = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    try {
      render(<RailTools onHelp={() => {}} onSettings={() => {}} settingsOpen={false} />);
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveTextContent('Settings… Ctrl+,');
      renderWithApp(
        <Sidebar onNavigate={() => {}} onReset={() => {}} screen="history" shortcut="Control+Shift+Space" status="Ready" />,
      );
      expect(document.querySelector('.brand__status')).toHaveTextContent('Ready');
      expect([...document.querySelectorAll('.rail-key .kbd')].map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'Space']);
      expect(document.body.textContent).toContain('Alt+1');
      expect(document.body.textContent).not.toMatch(/[⌥⌘⌃⇧]/);
    } finally {
      spy.mockRestore();
    }
  });
});
