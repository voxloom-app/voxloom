/** BUS-229: which cleanup model dictation uses, given what this build offers. */
import type { CleanupModelEntry, CleanupModelStatus } from '../../services/cleanup/types';
import { QUALITY_CLEANUP_MODEL_ID } from '../../services/cleanup/types';
import type { CleanupModelView } from './cleanupCopy';

/**
 * The saved `cleanupModelId` when this build offers it, else the default
 * (the first entry). New and existing users have the default (or null) saved,
 * so they stay on Qwen3 0.6B until they pick the 4B.
 */
export function chosenCleanupModel(status: CleanupModelStatus, savedId: string | null): CleanupModelEntry {
  return status.models.find((model) => model.id === savedId) ?? status.models[0];
}

/** The optional 4B, when this build offers it (never on Windows, BUS-247). */
export function qualityCleanupModel(status: CleanupModelStatus): CleanupModelEntry | undefined {
  return status.models.find((model) => model.id === QUALITY_CLEANUP_MODEL_ID);
}

/** Cleanup can be turned on only with the chosen model verified and a worker. */
export function chosenModelReady(
  view: CleanupModelView,
  savedId: string | null,
): view is { kind: 'status'; status: CleanupModelStatus } {
  return view.kind === 'status' && view.status.runtimeAvailable
    && chosenCleanupModel(view.status, savedId).available;
}
