/// When to prewarm the cleanup model (BUS-16 3c-2c C2): every time cleanup
/// is switched on, and once after launch if it was already on, a little
/// later (PREWARM_LAUNCH_DELAY_MS). Settings that hydrate at boot are the
/// launch state, not a switch-on. Switching off cancels a pending launch
/// prewarm and disarms one that is running (BUS-121). A switch-on right after
/// waits for that disarm, so it can't end the new prewarm, and is dropped if
/// cleanup is switched off again meanwhile. Choosing another model while
/// cleanup is on (BUS-229) disarms the old model's prewarm and warms the new
/// one, as a switch-off then on would. The plan lives in a ref, so
/// StrictMode's effect replay neither loses nor repeats a prewarm.

import { useEffect, useRef } from 'react';
import {
  PREWARM_LAUNCH_DELAY_MS,
  type DisarmPrewarm,
  type Prewarm,
  type PrewarmTrigger,
} from '../cleanup/prewarm';

export interface CleanupPrewarmOptions {
  /** `isCleanupActive(settings)`. */
  active: boolean;
  /** `settings.cleanupModelId`: the model to warm. None, no prewarm. */
  modelId: string | null;
  /** Durable settings have hydrated (bootReady). */
  ready: boolean;
  /** Native only; absent in the browser build. Must be stable. */
  prewarm?: Prewarm;
  /** Native only, like `prewarm`. Must be stable. */
  disarm?: DisarmPrewarm;
}

interface Plan {
  /** Armed (active with a model) when last seen ready; null until launch. */
  seen: boolean | null;
  /** The model last seen ready. */
  seenModel: string | null;
  launchPending: boolean;
}

export function useCleanupPrewarm({ active, disarm, modelId, ready, prewarm }: CleanupPrewarmOptions): void {
  const plan = useRef<Plan>({ launchPending: false, seen: null, seenModel: null });
  /** The disarm in flight, so the next prewarm starts after it. */
  const disarming = useRef<Promise<void> | null>(null);
  /** Counts switch-offs; a prewarm queued behind a disarm checks it. */
  const switchOffs = useRef(0);
  useEffect(() => {
    if (!ready || !prewarm) return undefined;
    const armed = active && modelId !== null;
    const fire = (trigger: PrewarmTrigger) => {
      if (modelId === null) return;
      const pending = disarming.current;
      const queuedAt = switchOffs.current;
      const started = pending
        ? pending.then(() => (switchOffs.current === queuedAt ? prewarm(trigger, modelId) : undefined))
        : prewarm(trigger, modelId);
      void started.catch(() => {
        // Best effort: the first dictation simply loads the model itself.
      });
    };
    const stop = () => {
      switchOffs.current += 1;
      if (!disarm) return;
      // Best effort: a prewarm that outlives the switch ends at its own
      // warm-up reply or timeout, and a dictation never waits on it.
      const done: Promise<void> = disarm()
        .then(() => undefined, () => undefined)
        .finally(() => {
          if (disarming.current === done) disarming.current = null;
        });
      disarming.current = done;
    };
    const current = plan.current;
    if (current.seen === null) {
      current.launchPending = armed;
    } else if (armed !== current.seen) {
      current.launchPending = false;
      if (armed) fire('switch-on');
      else stop();
    } else if (armed && modelId !== current.seenModel) {
      current.launchPending = false;
      stop();
      fire('switch-on');
    }
    current.seen = armed;
    current.seenModel = modelId;
    if (!current.launchPending) return undefined;
    const timer = setTimeout(() => {
      current.launchPending = false;
      fire('launch');
    }, PREWARM_LAUNCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, disarm, modelId, prewarm, ready]);
}
