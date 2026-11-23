/** BUS-181: one-click download of a pinned cleanup model (native side in
 * `cleanup/model_store/download.rs`), and since BUS-229 its removal. Every
 * call names its model. Completion is the invoke resolving with the verified
 * status, never a progress ratio alone. */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CleanupModelStatus } from './types';

export const CLEANUP_DOWNLOAD_PROGRESS_EVENT = 'cleanup:download-progress';

export interface CleanupDownloadProgress {
  modelId: string;
  bytesReceived: number;
  bytesTotal: number;
  /** 0..1; reaches 1 only once the file is verified and installed. */
  ratio: number;
}

export type CleanupDownloadFailure = 'cancelled' | 'checksum' | 'failed';

export class CleanupDownloadError extends Error {
  constructor(readonly kind: CleanupDownloadFailure, message: string) {
    super(message);
    this.name = 'CleanupDownloadError';
  }
}

function downloadError(error: unknown): CleanupDownloadError {
  const native = error as { code?: unknown; message?: unknown } | null;
  const message = typeof native?.message === 'string' ? native.message : String(error);
  if (native?.code === 'cancelled') return new CleanupDownloadError('cancelled', message);
  if (native?.code === 'checksum-mismatch') return new CleanupDownloadError('checksum', message);
  return new CleanupDownloadError('failed', message);
}

export async function downloadCleanupModel(
  modelId: string,
  onProgress?: (progress: CleanupDownloadProgress) => void,
): Promise<CleanupModelStatus> {
  let unlisten: UnlistenFn | undefined;
  try {
    // Subscribe before invoke so early progress events are not missed.
    if (onProgress) {
      unlisten = await listen<CleanupDownloadProgress>(
        CLEANUP_DOWNLOAD_PROGRESS_EVENT, (event) => {
          if (event.payload.modelId === modelId) onProgress(event.payload);
        },
      );
    }
    return await invoke<CleanupModelStatus>('cleanup_download_model', { modelId });
  } catch (error: unknown) {
    throw downloadError(error);
  } finally {
    unlisten?.();
  }
}

/** Resolves false when that model wasn't downloading. */
export async function cancelCleanupDownload(modelId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('cleanup_cancel_download', { modelId });
  } catch (error: unknown) {
    throw downloadError(error);
  }
}

/** Removes an installed model and resolves with the new status. */
export async function deleteCleanupModel(modelId: string): Promise<CleanupModelStatus> {
  try {
    return await invoke<CleanupModelStatus>('cleanup_delete_model', { modelId });
  } catch (error: unknown) {
    const native = error as { message?: unknown } | null;
    throw new Error(typeof native?.message === 'string' ? native.message : String(error), { cause: error });
  }
}
