// BUS-229: the optional Qwen3 4B row in Settings > Capture > Cleanup.
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import { initialSettings } from '../../src/domain/fixtures';
import type { Settings } from '../../src/domain/types';
import { CleanupSettings } from '../../src/features/settings/CleanupSettings';
import { useCleanupModel } from '../../src/features/settings/useCleanupModel';
import type { CleanupModelStore } from '../../src/services/cleanup/contracts';
import type { CleanupDownloadProgress } from '../../src/services/cleanup/modelDownload';
import {
  CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_ID, type CleanupModelStatus,
} from '../../src/services/cleanup/types';
import { cleanupStatus } from './cleanupStatusFixture';
import { renderWithApp } from './testUtils';

const HELP = 'Qwen3 4B improves Formal rewriting. It\'s a 2.5 GB download, uses about 4 GB of memory while it runs, and the first cleanup after launch is slower.';

let latest: Settings = initialSettings;
function Probe({ start }: { start?: Partial<Settings> }) {
  const { dispatch, state } = useApp();
  useEffect(() => {
    if (start) dispatch({ onboardingComplete: true, settings: { ...initialSettings, ...start }, type: 'hydrate-settings' });
  }, [dispatch, start]);
  latest = state.settings;
  return null;
}

function Harness({ modelStore }: { modelStore: CleanupModelStore }) {
  return <CleanupSettings isNative model={useCleanupModel(true, modelStore)} />;
}

function fullStore(status: CleanupModelStatus) {
  let finish: (s: CleanupModelStatus) => void = () => {};
  let progress: (p: CleanupDownloadProgress) => void = () => {};
  const store = {
    cancelDownload: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(cleanupStatus({ quality: false })),
    download: vi.fn((_id: string, onProgress?: (p: CleanupDownloadProgress) => void) =>
      new Promise<CleanupModelStatus>((resolve) => {
        finish = resolve;
        progress = (p) => onProgress?.(p);
      })),
    status: vi.fn().mockResolvedValue(status),
  } satisfies CleanupModelStore;
  return { finish: (s: CleanupModelStatus) => finish(s), progress: (p: CleanupDownloadProgress) => progress(p), store };
}

function renderRow(status: CleanupModelStatus, start?: Partial<Settings>) {
  const harness = fullStore(status);
  renderWithApp(<><Probe start={start} /><Harness modelStore={harness.store} /></>);
  return harness;
}

const mainSwitch = () => screen.getByRole('switch', { name: 'Clean up transcripts locally' });
const qualitySwitch = () => screen.queryByRole('switch', { name: 'Use the higher quality model' });
const qualityNote = () => document.getElementById('settings-cleanup-quality-note')?.textContent;

describe('Higher quality cleanup model', () => {
  it('is hidden when the build does not offer the 4B (Windows, BUS-247)', async () => {
    renderRow(cleanupStatus());
    await waitFor(() => expect(mainSwitch()).toBeEnabled());
    expect(screen.queryByText('Higher quality model')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download (2.5 GB)' })).toBeNull();
  });

  it('offers a 2.5 GB download when not installed, with the size, memory and speed copy', async () => {
    renderRow(cleanupStatus({ quality: false }));
    await waitFor(() => expect(screen.getByText('Higher quality model')).toBeInTheDocument());
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(qualityNote()).toBe('Not installed.');
    expect(qualitySwitch()).toBeNull();
    expect(screen.getByRole('button', { name: 'Download (2.5 GB)' })).toBeInTheDocument();
    // The default model is installed, so its own row offers no download.
    expect(screen.queryByRole('button', { name: 'Download (397 MB)' })).toBeNull();
  });

  it('downloads and cancels the 4B by id, showing progress only on its own row', async () => {
    const user = userEvent.setup();
    const { finish, progress, store } = renderRow(cleanupStatus({ quality: false }));
    await user.click(await screen.findByRole('button', { name: 'Download (2.5 GB)' }));
    expect(store.download).toHaveBeenCalledWith(QUALITY_CLEANUP_MODEL_ID, expect.any(Function));
    act(() => { progress({ bytesReceived: 1, bytesTotal: 4, modelId: QUALITY_CLEANUP_MODEL_ID, ratio: 0.25 }); });
    expect(screen.getByRole('button', { name: 'Downloading… 25%' })).toHaveAttribute('aria-disabled', 'true');
    expect(document.getElementById('settings-cleanup-model-note')?.textContent).toBe('Qwen3 0.6B is installed.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.cancelDownload).toHaveBeenCalledWith(QUALITY_CLEANUP_MODEL_ID);
    await act(async () => { finish(cleanupStatus({ quality: true })); });
    expect(qualityNote()).toBe('Qwen3 4B is installed.');
    expect(qualitySwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('choosing it writes cleanupModelId, and cleanup turns on with the 4B', async () => {
    const user = userEvent.setup();
    renderRow(cleanupStatus({ quality: true }));
    await waitFor(() => expect(qualitySwitch()).toBeEnabled());
    await user.click(qualitySwitch()!);
    expect(latest.cleanupModelId).toBe(QUALITY_CLEANUP_MODEL_ID);
    expect(qualityNote()).toBe('Qwen3 4B is in use.');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(mainSwitch());
    expect(latest).toMatchObject({ cleanupModelId: QUALITY_CLEANUP_MODEL_ID, cleanupOptIn: true });
    await user.click(qualitySwitch()!);
    expect(latest.cleanupModelId).toBe(CLEANUP_MODEL_ID);
  });

  it.each([[null], [CLEANUP_MODEL_ID]])('saved model %s stays on Qwen3 0.6B', async (saved) => {
    const user = userEvent.setup();
    renderRow(cleanupStatus({ quality: true }), { cleanupModelId: saved });
    await waitFor(() => expect(qualitySwitch()).toHaveAttribute('aria-checked', 'false'));
    await user.click(mainSwitch());
    expect(latest).toMatchObject({ cleanupModelId: CLEANUP_MODEL_ID, cleanupOptIn: true });
  });

  it('a chosen 4B that went missing blocks turning cleanup on, but can be switched back', async () => {
    const user = userEvent.setup();
    renderRow(cleanupStatus({ quality: false }), { cleanupModelId: QUALITY_CLEANUP_MODEL_ID });
    await waitFor(() => expect(qualityNote()).toBe('Not installed. Download it again, or turn it off to use Qwen3 0.6B.'));
    expect(mainSwitch()).toBeDisabled();
    await user.click(qualitySwitch()!);
    expect(latest.cleanupModelId).toBe(CLEANUP_MODEL_ID);
    expect(mainSwitch()).toBeEnabled();
  });

  it('removes an installed, unchosen 4B and reports a failure', async () => {
    const user = userEvent.setup();
    const { store } = renderRow(cleanupStatus({ quality: true }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(store.delete).toHaveBeenCalledWith(QUALITY_CLEANUP_MODEL_ID);
    await waitFor(() => expect(qualityNote()).toBe('Not installed.'));
    store.delete.mockRejectedValueOnce(new Error('cleanup model is in use'));
    store.download.mockImplementation(async () => cleanupStatus({ quality: true }));
    await user.click(screen.getByRole('button', { name: 'Download (2.5 GB)' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(qualityNote()).toBe('Qwen3 4B is installed. Couldn\'t remove the model: cleanup model is in use.'));
  });
});
