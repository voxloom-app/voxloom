import type { CleanupProvenance, Settings } from './types';

/**
 * Prompt contract version recorded on every new history row (BUS-16). The
 * cleanup service and skipped dogfood rows share it so one build never
 * writes two versions for the same prompt.
 */
export const CLEANUP_PROMPT_VERSION = 'cleanup-v5';

/**
 * The prompt built with no dictionary words. BUS-188 kept it byte-identical
 * to cleanup-v2 (and cleanup-v3 for some words); BUS-229's per-style rules
 * changed both, so they are cleanup-v4 (no words) and cleanup-v5 (some).
 */
export const CLEANUP_PROMPT_VERSION_NO_DICTIONARY = 'cleanup-v4';

/** The version of the prompt text built for these (already snapshotted) words. */
export function cleanupPromptVersion(dictionary: readonly string[]): string {
  return dictionary.length > 0
    ? CLEANUP_PROMPT_VERSION
    : CLEANUP_PROMPT_VERSION_NO_DICTIONARY;
}

/**
 * Provenance for a row whose transcript did not go through model cleanup. No
 * prompt was built and no dictionary is known here, so it records the build's
 * current version.
 */
export function skippedCleanupProvenance(): CleanupProvenance {
  return {
    dictionaryDigest: null,
    dictionaryVersion: 1,
    modelDigest: null,
    modelId: null,
    promptVersion: CLEANUP_PROMPT_VERSION,
    reason: null,
    status: 'skipped',
  };
}

/**
 * Cleanup runs only when the explicit opt-in that the Settings UI writes is
 * set (Sophie's single-key call). `cleanupEnabled` is a legacy key: still
 * loaded and saved, but ignored here, so a #24-era file that has it without
 * the opt-in stays off.
 */
export function isCleanupActive(settings: Pick<Settings, 'cleanupOptIn'>): boolean {
  return settings.cleanupOptIn === true;
}
