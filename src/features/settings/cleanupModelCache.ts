/// One cleanup model status per window (BUS-16 PR 2c). `cleanup_model_status`
/// hashes every installed GGUF it hasn't verified yet in this app session
/// (397 MB, plus 2.5 GB with the optional 4B), so it is read once, on first
/// use, and again only on an explicit action (Check again). A download or a
/// removal applies the status it returns. Remounting Home or switching tabs
/// never re-reads it. Natively, a verified file is remembered by its identity
/// (dev/inode/size/mtime/ctime) for the session, so later reads and runs skip
/// the hash (BUS-229); nothing is persisted across launches.

import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { createTauriCleanupModelStore } from '../../services/cleanup/tauriAdapter';
import type { CleanupModelEntry, CleanupModelStatus } from '../../services/cleanup/types';
import type { CleanupModelView } from './cleanupCopy';

export interface CleanupModelSnapshot {
  /** Transient: checking, an error, or the latest status. */
  view: CleanupModelView;
  /** Last known `runtimeAvailable`; unknown counts as false. */
  workerAvailable: boolean;
}

const message = (reason: unknown): string => {
  // Adapter always wraps native {code, message} in CleanupEngineError.
  if (reason instanceof Error) return reason.message;
  return String(reason);
};

function checkedEntry(entry: CleanupModelEntry | undefined): boolean {
  return typeof entry?.available === 'boolean' && typeof entry.id === 'string';
}

function checkedStatus(status: CleanupModelStatus | undefined): CleanupModelStatus {
  // Native IPC result: check its shape before trusting it. The default model
  // heads `models`, as it does natively.
  if (!checkedEntry(status) || typeof status?.runtimeAvailable !== 'boolean'
    || !Array.isArray(status.models) || !status.models.every(checkedEntry)
    || status.models[0]?.id !== status.id) {
    throw new Error('unexpected status from the app');
  }
  return status;
}

let snapshot: CleanupModelSnapshot = {
  view: { kind: 'checking' }, workerAvailable: false,
};
let generation = 0;
let requested = false;
/** A status has been read or applied at least once in this window. */
let loaded = false;
/** BUS-106: one in-flight status read; overlapping Check again reuses it. */
let reading: Promise<void> | null = null;
/** Generation that owns `reading`; apply/fail bump generation so refresh starts fresh. */
let readingGeneration = 0;
let modelStore: CleanupModelStore | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<CleanupModelSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export const cleanupModelCache = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: (): CleanupModelSnapshot => snapshot,
  /** Test seam: the store to use; defaults to the native one. */
  useStore(store: CleanupModelStore | undefined) {
    if (store) modelStore = store;
  },
  store: (): CleanupModelStore => modelStore ??= createTauriCleanupModelStore(),
  /** First consumer in this window: read the status once. */
  ensureLoaded() {
    if (requested) return;
    requested = true;
    void cleanupModelCache.refresh();
  },
  /**
   * Explicit re-read (Check again). Overlapping calls share one status() only
   * when that read still belongs to the current generation. apply() bumps
   * generation so a cancelled in-flight read is not reused (Codex
   * 4316214003).
   */
  refresh(): Promise<void> {
    if (reading !== null && readingGeneration === generation) return reading;
    requested = true;
    const request = ++generation;
    publish({ view: { kind: 'checking' } });
    // Reserve the slot before calling status(), so a sync throw's finally can
    // clear the same promise we return (finally would otherwise run before a
    // direct `reading = (async () => …)()` assignment).
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => { settle = resolve; });
    reading = pending;
    readingGeneration = request;
    void (async () => {
      try {
        // status() runs synchronously here (before the first await), so
        // overlapping Check again sees the reserved slot; a sync throw lands
        // in the catch below and the finally still clears the slot.
        const status = checkedStatus(await cleanupModelCache.store().status());
        if (request !== generation) return;
        loaded = true;
        publish({ view: { kind: 'status', status }, workerAvailable: status.runtimeAvailable });
      } catch (reason: unknown) {
        if (request !== generation) return;
        // Nothing known yet: let the next consumer (e.g. reopening Capture) retry.
        if (!loaded) requested = false;
        publish({ view: { kind: 'error', message: message(reason) } });
      } finally {
        // Clear only this slot; a newer refresh may already own `reading`.
        if (reading === pending) reading = null;
        settle();
      }
    })();
    return pending;
  },
  /**
   * A status from the download result; supersedes pending reads. A malformed
   * status throws, so the caller reports it as a failed download.
   */
  apply(status: CleanupModelStatus) {
    const checked = checkedStatus(status);
    generation++;
    loaded = true;
    requested = true;
    publish({ view: { kind: 'status', status: checked }, workerAvailable: checked.runtimeAvailable });
  },
};

/** Tests only: forget the cached status and store. */
export function resetCleanupModelCacheForTests() {
  snapshot = { view: { kind: 'checking' }, workerAvailable: false };
  generation++;
  requested = false;
  loaded = false;
  reading = null;
  readingGeneration = 0;
  modelStore = null;
  listeners.clear();
}

if (import.meta.env.MODE === 'test') {
  (globalThis as { __voxloomResetCleanupModelCache?: () => void })
    .__voxloomResetCleanupModelCache = resetCleanupModelCacheForTests;
}
