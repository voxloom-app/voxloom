// BUS-229 (UI/UX option B): the Home writing-style picker stays visible but
// disabled while local cleanup is off, with a note and one action, because a
// style only changes text through cleanup. Saved styles are kept.
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { initialSettings } from '../../src/domain/fixtures';
import type { Settings } from '../../src/domain/types';
import { HomeColophon } from '../../src/features/home/HomeColophon';
import { homeStyleState } from '../../src/features/home/homeStyleState';
import type { CleanupModelView } from '../../src/features/settings/cleanupCopy';
import type { CleanupModelStore } from '../../src/services/cleanup/contracts';
import { CleanupDownloadError, type CleanupDownloadProgress } from '../../src/services/cleanup/modelDownload';
import {
  CLEANUP_MODEL_ID, CLEANUP_MODEL_SHA256, QUALITY_CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_SHA256,
  type CleanupModelEntry, type CleanupModelStatus,
} from '../../src/services/cleanup/types';
import { renderWithApp } from './testUtils';

/** Default (0.6B) and optional 4B availability, as `cleanup_model_status` lists them. */
function modelStatus(defaultAvailable: boolean, quality?: boolean): CleanupModelStatus {
  const base: CleanupModelEntry = { available: defaultAvailable, id: CLEANUP_MODEL_ID, sha256: CLEANUP_MODEL_SHA256 };
  const models: CleanupModelEntry[] = [base];
  if (quality !== undefined) {
    models.push({ available: quality, id: QUALITY_CLEANUP_MODEL_ID, sha256: QUALITY_CLEANUP_MODEL_SHA256 });
  }
  return { ...base, models, runtimeAvailable: true };
}
const ready = modelStatus(true);
const missing = modelStatus(false);
const active = { cleanupEnabled: true, cleanupModelId: CLEANUP_MODEL_ID, cleanupOptIn: true };

function downloadingStore(status: CleanupModelStatus) {
  const pending: { progress: (p: CleanupDownloadProgress) => void; resolve: (s: CleanupModelStatus) => void; reject: (e: unknown) => void }[] = [];
  const store = {
    cancelDownload: vi.fn().mockResolvedValue(true),
    download: vi.fn((_modelId: string, onProgress?: (p: CleanupDownloadProgress) => void) =>
      new Promise<CleanupModelStatus>((resolve, reject) => {
        pending.push({ progress: (p) => onProgress?.(p), reject, resolve });
      })),
    status: vi.fn().mockResolvedValue(status),
  } satisfies CleanupModelStore;
  return { pending, store };
}

let current: Settings = initialSettings;
function Probe({ settings }: { settings?: Partial<Settings> }) {
  const { dispatch, state } = useApp();
  useEffect(() => {
    if (settings) dispatch({ onboardingComplete: true, settings: { ...initialSettings, ...settings }, type: 'hydrate-settings' });
  }, [dispatch, settings]);
  current = state.settings;
  return null;
}

async function renderHome(store: CleanupModelStore, settings?: Partial<Settings>) {
  renderWithApp(<><Probe settings={settings} /><HomeColophon cleanupModelStore={store} isNative /></>);
  await waitFor(() => expect(store.status).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
}

const picker = () => screen.getByRole('radiogroup', { name: 'Current writing style' });
const note = () => document.getElementById('home-style-note');
const button = (name: string) => screen.queryByRole('button', { name });

afterEach(() => { vi.restoreAllMocks(); });

describe('Home writing style while cleanup is off (BUS-229)', () => {
  it('model missing: disabled picker, note with size, Turn on downloads then turns cleanup on', async () => {
    const { pending, store } = downloadingStore(missing);
    await renderHome(store, { style: 'very-casual' });
    expect(note()).toHaveTextContent('Styles need local cleanup, which runs on this Mac (Qwen3 0.6B, 397 MB).');
    expect(screen.getByText('Writing style', { selector: '.fine' })).toBeInTheDocument();
    expect(picker()).toHaveAttribute('aria-disabled', 'true');
    expect(picker()).toHaveAttribute('aria-describedby', 'home-style-note-text');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Very Casual' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.setup().click(button('Turn on local cleanup')!);
    expect(store.download).toHaveBeenCalledOnce();
    expect(store.download.mock.calls[0][0]).toBe(CLEANUP_MODEL_ID);
    act(() => { pending[0].progress({ bytesReceived: 42, bytesTotal: 100, modelId: CLEANUP_MODEL_ID, ratio: 0.42 }); });
    expect(note()).toHaveTextContent('Downloading the cleanup model… 42%');
    expect(screen.getByRole('progressbar', { name: 'Cleanup model download' })).toHaveAttribute('aria-valuenow', '42');
    expect(picker()).toHaveAttribute('aria-disabled', 'true');
    expect(current.cleanupOptIn).not.toBe(true);

    await act(async () => { pending[0].resolve(ready); });
    await waitFor(() => expect(current.cleanupOptIn).toBe(true));
    expect(current.cleanupModelId).toBe(CLEANUP_MODEL_ID);
    expect(current.style).toBe('very-casual');
    expect(screen.getByText('Writing style · local cleanup on')).toBeInTheDocument();
    expect(picker()).not.toHaveAttribute('aria-disabled');
    expect(note()).toBeNull();
  });

  it('Cancel stops the download and cleanup stays off', async () => {
    const { pending, store } = downloadingStore(missing);
    await renderHome(store);
    const user = userEvent.setup();
    await user.click(button('Turn on local cleanup')!);
    await user.click(button('Cancel')!);
    expect(store.cancelDownload).toHaveBeenCalledOnce();
    await act(async () => { pending[0].reject(new CleanupDownloadError('cancelled', 'cancelled')); });
    expect(note()).toHaveTextContent('Styles need local cleanup, which runs on this Mac');
    expect(current.cleanupOptIn).not.toBe(true);
  });

  it('a failed download offers Try again and points at Settings', async () => {
    const { pending, store } = downloadingStore(missing);
    await renderHome(store);
    const user = userEvent.setup();
    await user.click(button('Turn on local cleanup')!);
    await act(async () => { pending[0].reject(new Error('offline')); });
    await waitFor(() => expect(note()).toHaveTextContent(
      'Couldn’t download the cleanup model. You can also add it in Settings → Cleanup.',
    ));
    expect(picker()).toHaveAttribute('aria-disabled', 'true');
    await user.click(button('Try again')!);
    expect(store.download).toHaveBeenCalledTimes(2);
  });

  it('model installed: Turn on writes the same keys as the Settings switch', async () => {
    const { store } = downloadingStore(ready);
    await renderHome(store, { style: 'formal' });
    expect(note()).toHaveTextContent('Styles need local cleanup, which is off.');
    await userEvent.setup().click(button('Turn on local cleanup')!);
    expect(current.cleanupOptIn).toBe(true);
    expect(current.cleanupModelId).toBe(CLEANUP_MODEL_ID);
    expect(current.style).toBe('formal');
    expect(picker()).not.toHaveAttribute('aria-disabled');
    expect(store.download).not.toHaveBeenCalled();
  });

  it('cleanup on but the model is gone: disabled, with the Settings download label', async () => {
    const { store } = downloadingStore(missing);
    await renderHome(store, active);
    expect(note()).toHaveTextContent('The cleanup model is missing, so styles aren’t applied.');
    expect(picker()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.setup().click(button('Download (397 MB)')!);
    expect(store.download).toHaveBeenCalledOnce();
    expect(store.download.mock.calls[0][0]).toBe(CLEANUP_MODEL_ID);
  });

  it('cleanup on and ready: live picker, unchanged caption, no note', async () => {
    const { store } = downloadingStore(ready);
    await renderHome(store, active);
    expect(screen.getByText('Writing style · local cleanup on')).toBeInTheDocument();
    expect(picker()).not.toHaveAttribute('aria-disabled');
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Casual' }));
    expect(current.style).toBe('casual');
  });

  it('the browser preview keeps today\'s live picker', () => {
    renderWithApp(<><Probe /><HomeColophon isNative={false} /></>);
    expect(screen.getByText('Writing style')).toBeInTheDocument();
    expect(picker()).not.toHaveAttribute('aria-disabled');
    expect(note()).toBeNull();
  });
});

function Screens({ settings, store }: { settings?: Partial<Settings>; store: CleanupModelStore }) {
  const [screen, setScreen] = useState<'home' | 'history'>('home');
  return (
    <>
      <Probe settings={settings} />
      <button onClick={() => setScreen(screen === 'home' ? 'history' : 'home')} type="button">Switch screen</button>
      {screen === 'home' ? <HomeColophon cleanupModelStore={store} isNative /> : <p>History</p>}
    </>
  );
}

describe('Turn on local cleanup outlives Home (BUS-229, CR #6a)', () => {
  async function startThenLeave() {
    const { pending, store } = downloadingStore(missing);
    renderWithApp(<Screens store={store} />);
    await waitFor(() => expect(button('Turn on local cleanup')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(button('Turn on local cleanup')!);
    await user.click(button('Switch screen')!);
    expect(picker).toThrow();
    return { pending, user };
  }

  it('turn on, go to History, download finishes: cleanup is on', async () => {
    const { pending } = await startThenLeave();
    await act(async () => { pending[0].resolve(ready); });
    expect(current.cleanupOptIn).toBe(true);
    expect(current.cleanupModelId).toBe(CLEANUP_MODEL_ID);
  });

  it('coming back mid-download still turns cleanup on when it finishes', async () => {
    const { pending, user } = await startThenLeave();
    await user.click(button('Switch screen')!);
    await waitFor(() => expect(note()).toHaveTextContent('Downloading the cleanup model'));
    await act(async () => { pending[0].resolve(ready); });
    expect(current.cleanupOptIn).toBe(true);
    expect(picker()).not.toHaveAttribute('aria-disabled');
  });

  it('a failure while away drops the intent: cleanup stays off and Home offers Try again', async () => {
    const { pending, user } = await startThenLeave();
    await act(async () => { pending[0].reject(new Error('offline')); });
    await user.click(button('Switch screen')!);
    await waitFor(() => expect(button('Try again')).toBeInTheDocument());
    expect(current.cleanupOptIn).not.toBe(true);
  });

  it('a model that verifies without a worker does not turn cleanup on', async () => {
    const { pending } = await startThenLeave();
    await act(async () => { pending[0].resolve({ ...ready, runtimeAvailable: false }); });
    expect(current.cleanupOptIn).not.toBe(true);
  });
});

describe('Home writing style keyboard access (BUS-229, CR #6b)', () => {
  const noteText = () => document.getElementById('home-style-note-text');

  it('the radiogroup and the action are described by the note text only', async () => {
    const { store } = downloadingStore(missing);
    await renderHome(store);
    expect(noteText()).toHaveTextContent('Styles need local cleanup, which runs on this Mac');
    expect(noteText()).not.toHaveTextContent('Turn on local cleanup');
    expect(picker()).toHaveAttribute('aria-describedby', 'home-style-note-text');
    expect(button('Turn on local cleanup')).toHaveAttribute('aria-describedby', 'home-style-note-text');
    await userEvent.setup().tab();
    expect(button('Turn on local cleanup')).toHaveFocus();
  });

  it('the note is a status, but not live while the download reports percent', async () => {
    const { pending, store } = downloadingStore(missing);
    await renderHome(store);
    expect(noteText()).toHaveAttribute('role', 'status');
    expect(noteText()).not.toHaveAttribute('aria-live');
    await userEvent.setup().click(button('Turn on local cleanup')!);
    act(() => { pending[0].progress({ bytesReceived: 42, bytesTotal: 100, modelId: CLEANUP_MODEL_ID, ratio: 0.42 }); });
    expect(noteText()).toHaveTextContent('Downloading the cleanup model… 42%');
    expect(noteText()).toHaveAttribute('aria-live', 'off');
    expect(button('Cancel')).toHaveAttribute('aria-describedby', 'home-style-note-text');
    await act(async () => { pending[0].reject(new Error('offline')); });
    await waitFor(() => expect(button('Try again')).toBeInTheDocument());
    expect(noteText()).toHaveAttribute('role', 'status');
    expect(noteText()).not.toHaveAttribute('aria-live');
  });
});

describe('Home writing style focus after Turn on (BUS-229)', () => {
  const checked = () => screen.getByRole('radio', { checked: true });

  async function pressTurnOn(store: CleanupModelStore, settings?: Partial<Settings>) {
    await renderHome(store, settings);
    const user = userEvent.setup();
    button('Turn on local cleanup')!.focus();
    await user.keyboard('{Enter}');
    return user;
  }

  it('model installed: focus moves to the checked, now enabled style', async () => {
    const { store } = downloadingStore(ready);
    await pressTurnOn(store, { style: 'casual' });
    expect(current.cleanupOptIn).toBe(true);
    expect(checked()).toHaveTextContent('Casual');
    expect(checked()).toBeEnabled();
    expect(checked()).toHaveFocus();
  });

  it('download starts: focus moves to Cancel; it finishes: focus moves to the checked style', async () => {
    const { pending, store } = downloadingStore(missing);
    await pressTurnOn(store, { style: 'formal' });
    expect(button('Cancel')).toHaveFocus();
    await act(async () => { pending[0].resolve(ready); });
    expect(current.cleanupOptIn).toBe(true);
    expect(checked()).toHaveTextContent('Formal');
    expect(checked()).toHaveFocus();
  });

  it('download fails: focus moves to Try again', async () => {
    const { pending, store } = downloadingStore(missing);
    await pressTurnOn(store);
    expect(button('Cancel')).toHaveFocus();
    await act(async () => { pending[0].reject(new Error('offline')); });
    await waitFor(() => expect(button('Try again')).toHaveFocus());
  });

  it('focus elsewhere is left alone when the download finishes', async () => {
    const { pending, store } = downloadingStore(missing);
    const user = await pressTurnOn(store);
    const elsewhere = document.body.appendChild(document.createElement('button'));
    await user.click(elsewhere);
    await act(async () => { pending[0].resolve(ready); });
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });
});

describe('Home writing style with the optional 4B (BUS-229 PR2)', () => {
  const chose4b = { cleanupModelId: QUALITY_CLEANUP_MODEL_ID };

  it('4B chosen and installed, 0.6B missing: Turn on uses the 4B with no download', async () => {
    const { store } = downloadingStore(modelStatus(false, true));
    await renderHome(store, chose4b);
    expect(note()).toHaveTextContent('Styles need local cleanup, which is off.');
    await userEvent.setup().click(button('Turn on local cleanup')!);
    expect(current.cleanupOptIn).toBe(true);
    expect(current.cleanupModelId).toBe(QUALITY_CLEANUP_MODEL_ID);
    expect(store.download).not.toHaveBeenCalled();
  });

  it('0.6B chosen and installed, 4B installed too: Turn on keeps the 0.6B', async () => {
    const { store } = downloadingStore(modelStatus(true, true));
    await renderHome(store, { cleanupModelId: CLEANUP_MODEL_ID });
    await userEvent.setup().click(button('Turn on local cleanup')!);
    expect(current.cleanupModelId).toBe(CLEANUP_MODEL_ID);
  });

  it('4B chosen but missing, 0.6B installed: no Home action, cleanup stays off', async () => {
    const { store } = downloadingStore(modelStatus(true, false));
    await renderHome(store, chose4b);
    expect(note()).toHaveTextContent('Styles need local cleanup, which is off.');
    expect(button('Turn on local cleanup')).toBeNull();
    expect(current.cleanupOptIn).not.toBe(true);
    expect(store.download).not.toHaveBeenCalled();
  });

  it('cleanup on with the 4B chosen but missing: no 397 MB download on Home', async () => {
    const { store } = downloadingStore(modelStatus(true, false));
    await renderHome(store, { ...active, cleanupModelId: QUALITY_CLEANUP_MODEL_ID });
    expect(note()).toHaveTextContent('The cleanup model is missing, so styles aren’t applied.');
    expect(button('Download (397 MB)')).toBeNull();
  });
});

describe('homeStyleState', () => {
  const base = {
    active: false, download: { downloading: false, note: null as string | null }, isNative: true, shown: true,
    view: { kind: 'checking' } as CleanupModelView,
  };
  it.each([
    [{ ...base, isNative: false }, 'browser'],
    [{ ...base, shown: false }, 'hidden'],
    [{ ...base, view: { kind: 'checking' as const } }, 'off-unavailable'],
    [{ ...base, view: { kind: 'status' as const, status: { ...ready, runtimeAvailable: false } } }, 'off-unavailable'],
    [{ ...base, active: true, view: { kind: 'checking' as const } }, 'on'],
    [{ ...base, active: true, view: { kind: 'error' as const, message: 'x' } }, 'on'],
    [{ ...base, download: { downloading: true, note: null }, view: { kind: 'status' as const, status: missing } }, 'downloading'],
    [{ ...base, download: { downloading: false, note: 'Download cancelled.' }, view: { kind: 'status' as const, status: missing } }, 'off-missing'],
    [{ ...base, download: { downloading: false, note: 'offline' }, view: { kind: 'status' as const, status: missing } }, 'failed'],
    [{ ...base, savedModelId: QUALITY_CLEANUP_MODEL_ID, view: { kind: 'status' as const, status: modelStatus(false, true) } }, 'off-installed'],
    [{ ...base, savedModelId: QUALITY_CLEANUP_MODEL_ID, view: { kind: 'status' as const, status: modelStatus(true, false) } }, 'off-unavailable'],
    [{ ...base, savedModelId: QUALITY_CLEANUP_MODEL_ID, download: { downloading: false, note: 'offline' }, view: { kind: 'status' as const, status: modelStatus(true, false) } }, 'off-unavailable'],
    [{ ...base, active: true, savedModelId: QUALITY_CLEANUP_MODEL_ID, view: { kind: 'status' as const, status: modelStatus(true, false) } }, 'on-missing'],
    [{ ...base, active: true, savedModelId: QUALITY_CLEANUP_MODEL_ID, view: { kind: 'status' as const, status: modelStatus(false, true) } }, 'on'],
  ])('%j → %s', (input, expected) => {
    expect(homeStyleState(input)).toBe(expected);
  });
});
