// A consistent `cleanup_model_status` for tests: the default model on top and
// first in `models`, plus the optional 4B when `quality` says whether it is
// installed (absent, as on Windows builds, when it is undefined).
import {
  CLEANUP_MODEL_ID, CLEANUP_MODEL_SHA256, QUALITY_CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_SHA256,
  type CleanupModelEntry, type CleanupModelStatus,
} from '../../src/services/cleanup/types';

export function cleanupStatus(
  { available = true, quality, runtimeAvailable = true }:
  { available?: boolean; quality?: boolean; runtimeAvailable?: boolean } = {},
): CleanupModelStatus {
  const models: CleanupModelEntry[] = [{ available, id: CLEANUP_MODEL_ID, sha256: CLEANUP_MODEL_SHA256 }];
  if (quality !== undefined) {
    models.push({ available: quality, id: QUALITY_CLEANUP_MODEL_ID, sha256: QUALITY_CLEANUP_MODEL_SHA256 });
  }
  return { ...models[0], models, runtimeAvailable };
}
