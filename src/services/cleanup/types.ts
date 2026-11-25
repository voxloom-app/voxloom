import type { WritingStyle } from '../../domain/types';

/** The default cleanup model, Qwen3 0.6B (native `model_store/pin.rs`). */
export const CLEANUP_MODEL_ID = 'qwen3-0.6b-q4-k-m' as const;
export const CLEANUP_MODEL_SHA256 =
  'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a';
/** BUS-229: the optional Qwen3-4B-Instruct-2507 (native `pin_4b.rs`). */
export const QUALITY_CLEANUP_MODEL_ID = 'qwen3-4b-instruct-2507-q4-k-m' as const;
export const QUALITY_CLEANUP_MODEL_SHA256 =
  '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597';

/** The pinned digest of each model this app knows, for attempt evidence. */
export const CLEANUP_MODEL_DIGESTS: Readonly<Record<string, string>> = {
  [CLEANUP_MODEL_ID]: CLEANUP_MODEL_SHA256,
  [QUALITY_CLEANUP_MODEL_ID]: QUALITY_CLEANUP_MODEL_SHA256,
};

export const CLEANUP_REASONS = [
  'cancelled', 'context-overflow', 'invalid-output', 'model-missing',
  'runtime-error', 'timeout',
] as const;
export type CleanupReason = typeof CLEANUP_REASONS[number];

export interface CleanupAttempt {
  modelDigest: string;
  modelId: string;
}

export interface CleanupResult {
  attempt: CleanupAttempt;
  text: string;
}

export class CleanupEngineError extends Error {
  constructor(
    readonly code: CleanupReason,
    message: string,
    readonly attempt?: CleanupAttempt,
  ) {
    super(message);
    this.name = 'CleanupEngineError';
  }
}

export interface CleanupSnapshot {
  dictionary: readonly string[];
  enabled: boolean;
  modelId: string | null;
  style: WritingStyle;
}

export type CleanupOutcome = (
  | { finalText: string; status: 'cleaned' }
  | { finalText: string; reason: CleanupReason; status: 'fallback' }
  | { finalText: string; status: 'skipped' }
  | { reason: 'cancelled'; status: 'cancelled' }
) & { attempt?: CleanupAttempt };

export interface CleanupRequest {
  dictionary: readonly string[];
  modelId: string;
  prompt: string;
  rawText: string;
  requestId: string;
  style: WritingStyle;
  /** Milliseconds left of the cleanup budget when the run starts. */
  timeLeftMs?: number;
}

/** One model this build offers, and whether it is installed and verified. */
export interface CleanupModelEntry {
  available: boolean;
  id: string;
  sha256: string;
}

/**
 * `cleanup_model_status`: the default model at the top level, and every
 * model this build offers in `models`, default first. Windows builds never
 * list the 4B (BUS-247).
 */
export interface CleanupModelStatus extends CleanupModelEntry {
  models: CleanupModelEntry[];
  runtimeAvailable: boolean;
}
