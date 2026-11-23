// BUS-229 (UI/UX option B): the Home writing-style picker stays visible but
// disabled while local cleanup is off, with a note and one action, because a
// style only changes text through cleanup. Saved styles are kept.
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { initialSettings } from '../../src/domain/fixtures';
import type { Settings } from '../../src/domain/types';
import { HomeHero } from '../../src/features/home/HomeHero';
import { homeStyleState } from '../../src/features/home/homeStyleState';
import type { CleanupModelView } from '../../src/features/settings/cleanupCopy';
import type { CleanupModelStore } from '../../src/services/cleanup/contracts';
import { CleanupDownloadError, type CleanupDownloadProgress } from '../../src/services/cleanup/modelDownload';
import { CLEANUP_MODEL_ID, CLEANUP_MODEL_SHA256, type CleanupModelStatus } from '../../src/services/cleanup/types';
import { renderWithApp } from './testUtils';

const ready: CleanupModelStatus = {
  available: true, id: CLEANUP_MODEL_ID, runtimeAvailable: true, sha256: CLEANUP_MODEL_SHA256,
};
const missing: CleanupModelStatus = { ...ready, available: false };
const active = { cleanupEnabled: true, cleanupModelId: CLEANUP_MODEL_ID, cleanupOptIn: true };

function downloadingStore(status: CleanupModelStatus) {
  const pending: { progress: (p: CleanupDownloadProgress) => void; resolve: (s: CleanupModelStatus) => void; reject: (e: unknown) => void }[] = [];
  const store = {
    cancelDownload: vi.fn().mockResolvedValue(true),
    download: vi.fn((onProgress?: (p: CleanupDownloadProgress) => void) =>
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
  renderWithApp(<><Probe settings={settings} /><HomeHero cleanupModelStore={store} isNative /></>);
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
    expect(picker()).toHaveAttribute('aria-describedby', 'home-style-note');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Very Casual' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.setup().click(button('Turn on local cleanup')!);
    expect(store.download).toHaveBeenCalledOnce();
    act(() => { pending[0].progress({ bytesReceived: 42, bytesTotal: 100, ratio: 0.42 }); });
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
      'Couldn’t download the cleanup model. You can also add it in Settings → Capture.',
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
    renderWithApp(<><Probe /><HomeHero isNative={false} /></>);
    expect(screen.getByText('Writing style')).toBeInTheDocument();
    expect(picker()).not.toHaveAttribute('aria-disabled');
    expect(note()).toBeNull();
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
  ])('%j → %s', (input, expected) => {
    expect(homeStyleState(input)).toBe(expected);
  });
});
