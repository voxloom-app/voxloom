// Shared helpers for the cleanupModelCache unit tests.
import { vi } from 'vitest';
import { cleanupModelCache } from '../../src/features/settings/cleanupModelCache';
import type { CleanupModelStore } from '../../src/services/cleanup/contracts';
import type { CleanupModelStatus } from '../../src/services/cleanup/types';
import { cleanupStatus } from './cleanupStatusFixture';

export const ready: CleanupModelStatus = cleanupStatus();
export const noWorker: CleanupModelStatus = { ...ready, runtimeAvailable: false };

/** A store whose status calls each wait for the test to answer them. */
export function deferredStore() {
  const answers: { reject: (error: Error) => void; resolve: (status: CleanupModelStatus) => void }[] = [];
  const store: CleanupModelStore = {
    
    status: vi.fn(() => new Promise<CleanupModelStatus>((resolve, reject) => { answers.push({ reject, resolve }); })),
  };
  cleanupModelCache.useStore(store);
  return { answers, store };
}

export const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
export const view = () => cleanupModelCache.snapshot().view;
export const worker = () => cleanupModelCache.snapshot().workerAvailable;
