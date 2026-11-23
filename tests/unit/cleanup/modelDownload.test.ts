// BUS-181: the native download adapter subscribes before invoking, unsubscribes
// afterwards, and maps native error codes to download failure kinds.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen, unlisten, handlers } = vi.hoisted(() => {
  const handlers: ((event: { payload: unknown }) => void)[] = [];
  const unlisten = vi.fn();
  return {
    handlers,
    invoke: vi.fn(),
    listen: vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.push(handler);
      return unlisten;
    }),
    unlisten,
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

import {
  CLEANUP_DOWNLOAD_PROGRESS_EVENT, CleanupDownloadError, cancelCleanupDownload, deleteCleanupModel,
  downloadCleanupModel,
} from '../../../src/services/cleanup/modelDownload';
import { createTauriCleanupModelStore } from '../../../src/services/cleanup/tauriAdapter';
import { CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_ID } from '../../../src/services/cleanup/types';
import { cleanupStatus } from '../cleanupStatusFixture';

const status = cleanupStatus();
const M = CLEANUP_MODEL_ID;

beforeEach(() => {
  handlers.length = 0;
  invoke.mockReset();
  listen.mockClear();
  unlisten.mockClear();
});

describe('downloadCleanupModel', () => {
  it('listens before invoking, forwards that model\'s progress, and resolves with the status', async () => {
    const seen: number[] = [];
    invoke.mockImplementation(async () => {
      expect(listen).toHaveBeenCalledWith(CLEANUP_DOWNLOAD_PROGRESS_EVENT, expect.any(Function));
      handlers[0]({ payload: { bytesReceived: 1, bytesTotal: 2, modelId: M, ratio: 0.5 } });
      handlers[0]({ payload: { bytesReceived: 1, bytesTotal: 4, modelId: QUALITY_CLEANUP_MODEL_ID, ratio: 0.25 } });
      return status;
    });
    await expect(downloadCleanupModel(M, (p) => seen.push(p.ratio))).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith('cleanup_download_model', { modelId: M });
    expect(seen).toEqual([0.5]);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['checksum-mismatch', 'checksum'],
    ['runtime-error', 'failed'],
    ['something-new', 'failed'],
  ])('maps native code %s to %s and still unsubscribes', async (code, kind) => {
    invoke.mockRejectedValue({ code, message: 'why' });
    const error = await downloadCleanupModel(M, () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CleanupDownloadError);
    expect(error).toMatchObject({ kind, message: 'why' });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('cancel invokes the native cancel for that model and reports whether it was running', async () => {
    invoke.mockResolvedValue(true);
    await expect(cancelCleanupDownload(QUALITY_CLEANUP_MODEL_ID)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('cleanup_cancel_download', { modelId: QUALITY_CLEANUP_MODEL_ID });
  });

  it('delete removes that model and resolves with the new status, or rejects with the reason', async () => {
    invoke.mockResolvedValueOnce(status);
    await expect(deleteCleanupModel(QUALITY_CLEANUP_MODEL_ID)).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith('cleanup_delete_model', { modelId: QUALITY_CLEANUP_MODEL_ID });
    invoke.mockRejectedValueOnce({ code: 'runtime-error', message: 'cleanup model is in use' });
    await expect(deleteCleanupModel(QUALITY_CLEANUP_MODEL_ID)).rejects.toThrow('cleanup model is in use');
  });

  it('the native model store offers download, cancel and delete', () => {
    const store = createTauriCleanupModelStore();
    expect(store.download).toBe(downloadCleanupModel);
    expect(store.cancelDownload).toBe(cancelCleanupDownload);
    expect(store.delete).toBe(deleteCleanupModel);
  });
});
