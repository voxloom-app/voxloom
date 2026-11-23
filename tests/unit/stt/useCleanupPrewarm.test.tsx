import { StrictMode, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { PREWARM_LAUNCH_DELAY_MS, disarmCleanupPrewarm, prewarmCleanup } from '../../../src/services/cleanup/prewarm';
import { useCleanupPrewarm, type CleanupPrewarmOptions } from '../../../src/services/stt/useCleanupPrewarm';
import { CLEANUP_MODEL_ID, QUALITY_CLEANUP_MODEL_ID } from '../../../src/services/cleanup/types';

const M = CLEANUP_MODEL_ID;
/** Options without `prewarm`; `modelId` defaults to the 0.6B. */
type Props = Omit<CleanupPrewarmOptions, 'prewarm' | 'modelId'> & { modelId?: string | null };

function setup(initial: Props, wrapper?: (props: { children: ReactNode }) => ReactNode) {
  const prewarm = vi.fn<(trigger: string, modelId: string) => Promise<string>>(() => Promise.resolve('started'));
  const disarm = vi.fn(() => Promise.resolve('stopped'));
  const hook = renderHook(
    (props: Props) => useCleanupPrewarm({ modelId: M, ...props, disarm, prewarm }),
    { initialProps: initial, wrapper },
  );
  return { disarm, hook, prewarm };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('cleanup prewarm triggers (BUS-16 3c-2c C2)', () => {
  it('prewarms once, a little after launch, when cleanup is on', () => {
    const { prewarm } = setup({ active: true, ready: true });
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS - 1);
    expect(prewarm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('launch', M);
    vi.advanceTimersByTime(60_000);
    expect(prewarm).toHaveBeenCalledOnce();
  });

  it('does not prewarm at launch when cleanup is off', () => {
    const { prewarm } = setup({ active: false, ready: true });
    vi.advanceTimersByTime(60_000);
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('treats settings that hydrate at boot as the launch state, not a switch-on', () => {
    const { hook, prewarm } = setup({ active: false, ready: false });
    hook.rerender({ active: true, ready: true });
    expect(prewarm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('launch', M);
  });

  it('waits for hydration before deciding anything', () => {
    const { prewarm } = setup({ active: true, ready: false });
    vi.advanceTimersByTime(60_000);
    expect(prewarm).not.toHaveBeenCalled();
  });

  it('prewarms at once on every switch-on', async () => {
    const { hook, prewarm } = setup({ active: false, ready: true });
    hook.rerender({ active: true, ready: true });
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('switch-on', M);
    hook.rerender({ active: true, ready: true });
    hook.rerender({ active: false, ready: true });
    hook.rerender({ active: true, ready: true });
    // After the switch-off's disarm (BUS-121), a microtask later.
    await vi.advanceTimersByTimeAsync(0);
    expect(prewarm.mock.calls).toEqual([['switch-on', M], ['switch-on', M]]);
    vi.advanceTimersByTime(60_000);
    expect(prewarm).toHaveBeenCalledTimes(2);
  });

  it('switching off cancels a pending launch prewarm; switching back on prewarms once', async () => {
    const { hook, prewarm } = setup({ active: true, ready: true });
    vi.advanceTimersByTime(1_000);
    hook.rerender({ active: false, ready: true });
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).not.toHaveBeenCalled();
    hook.rerender({ active: true, ready: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('switch-on', M);
  });

  it('fires the launch prewarm once under StrictMode', () => {
    const { prewarm } = setup({ active: true, ready: true }, StrictMode);
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('launch', M);
  });

  it('fires one switch-on under StrictMode', () => {
    const { hook, prewarm } = setup({ active: false, ready: true }, StrictMode);
    hook.rerender({ active: true, ready: true });
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('switch-on', M);
  });

  it('stops a pending launch prewarm on unmount, and does nothing without native', () => {
    const { hook, prewarm } = setup({ active: true, ready: true });
    hook.unmount();
    vi.advanceTimersByTime(60_000);
    expect(prewarm).not.toHaveBeenCalled();
    const browser = renderHook(() => useCleanupPrewarm({ active: true, modelId: M, ready: true }));
    vi.advanceTimersByTime(60_000);
    browser.unmount();
  });

  it('swallows a failed prewarm', async () => {
    const prewarm = vi.fn(() => Promise.reject(new Error('no worker')));
    renderHook(() => useCleanupPrewarm({ active: true, modelId: M, prewarm, ready: true }));
    await vi.advanceTimersByTimeAsync(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).toHaveBeenCalledOnce();
  });

  it('asks native with the trigger', async () => {
    invoke.mockResolvedValueOnce('low-power');
    await expect(prewarmCleanup('launch', M)).resolves.toBe('low-power');
    expect(invoke).toHaveBeenCalledWith('cleanup_prewarm', { modelId: M, trigger: 'launch' });
  });

  it('asks native to disarm', async () => {
    invoke.mockResolvedValueOnce('stopped');
    await expect(disarmCleanupPrewarm()).resolves.toBe('stopped');
    expect(invoke).toHaveBeenCalledWith('cleanup_prewarm_disarm');
  });
});

describe('switching cleanup off disarms the prewarm (BUS-121)', () => {
  it('disarms once when cleanup is switched off, not when it is switched on', () => {
    const { disarm, hook } = setup({ active: false, ready: true });
    hook.rerender({ active: true, ready: true });
    expect(disarm).not.toHaveBeenCalled();
    hook.rerender({ active: true, ready: true });
    expect(disarm).not.toHaveBeenCalled();
    hook.rerender({ active: false, ready: true });
    expect(disarm).toHaveBeenCalledOnce();
    hook.rerender({ active: false, ready: true });
    expect(disarm).toHaveBeenCalledOnce();
  });

  it('disarms on every switch-off', () => {
    const { disarm, hook } = setup({ active: true, ready: true });
    hook.rerender({ active: false, ready: true });
    hook.rerender({ active: true, ready: true });
    hook.rerender({ active: false, ready: true });
    expect(disarm).toHaveBeenCalledTimes(2);
  });

  it('disarms a prewarm the launch already started', () => {
    const { disarm, hook, prewarm } = setup({ active: true, ready: true });
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).toHaveBeenCalledOnce();
    hook.rerender({ active: false, ready: true });
    expect(disarm).toHaveBeenCalledOnce();
  });

  it('does not disarm at launch or while settings hydrate', () => {
    const off = setup({ active: false, ready: true });
    const on = setup({ active: true, ready: true });
    const hydrating = setup({ active: true, ready: false });
    hydrating.hook.rerender({ active: false, ready: true });
    vi.advanceTimersByTime(60_000);
    expect(off.disarm).not.toHaveBeenCalled();
    expect(on.disarm).not.toHaveBeenCalled();
    expect(hydrating.disarm).not.toHaveBeenCalled();
  });

  it('disarms once under StrictMode', () => {
    const { disarm, hook } = setup({ active: true, ready: true }, StrictMode);
    hook.rerender({ active: false, ready: true });
    expect(disarm).toHaveBeenCalledOnce();
  });

  it('does not disarm on unmount, and does nothing without native', () => {
    const { disarm, hook } = setup({ active: true, ready: true });
    hook.unmount();
    expect(disarm).not.toHaveBeenCalled();
    const browser = renderHook((props: { active: boolean }) => useCleanupPrewarm({ ...props, modelId: M, ready: true }), {
      initialProps: { active: true },
    });
    browser.rerender({ active: false });
    browser.unmount();
  });

  it('swallows a failed disarm', async () => {
    const disarm = vi.fn(() => Promise.reject(new Error('no worker')));
    const prewarm = vi.fn(() => Promise.resolve('started'));
    const hook = renderHook((props: { active: boolean }) => useCleanupPrewarm({ ...props, disarm, modelId: M, prewarm, ready: true }), {
      initialProps: { active: true },
    });
    hook.rerender({ active: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(disarm).toHaveBeenCalledOnce();
    hook.rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('switch-on', M);
  });

  it('starts a switch-on prewarm only after the disarm before it has finished', async () => {
    let finishDisarm: () => void = () => undefined;
    const order: string[] = [];
    const disarm = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishDisarm = () => {
            order.push('disarmed');
            resolve('stopped');
          };
        }),
    );
    const prewarm = vi.fn(() => {
      order.push('prewarm');
      return Promise.resolve('started');
    });
    const hook = renderHook((props: { active: boolean }) => useCleanupPrewarm({ ...props, disarm, modelId: M, prewarm, ready: true }), {
      initialProps: { active: true },
    });
    hook.rerender({ active: false });
    hook.rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(prewarm).not.toHaveBeenCalled();
    finishDisarm();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['disarmed', 'prewarm']);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('switch-on', M);
  });

  it('does not start a switch-on prewarm when cleanup is switched off again before it starts', async () => {
    const { calls, disarm, finish, prewarm } = deferredDisarms();
    const hook = renderHook((props: { active: boolean }) => useCleanupPrewarm({ ...props, disarm, modelId: M, prewarm, ready: true }), {
      initialProps: { active: true },
    });
    hook.rerender({ active: false });
    hook.rerender({ active: true });
    hook.rerender({ active: false });
    finish(0);
    finish(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['disarm', 'disarm']);
    hook.rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['disarm', 'disarm', 'prewarm']);
  });

  it('keeps a switch-on waiting for the latest disarm when an earlier one finishes first', async () => {
    const { calls, disarm, finish, prewarm } = deferredDisarms();
    const hook = renderHook((props: { active: boolean }) => useCleanupPrewarm({ ...props, disarm, modelId: M, prewarm, ready: true }), {
      initialProps: { active: true },
    });
    hook.rerender({ active: false });
    hook.rerender({ active: true });
    hook.rerender({ active: false });
    finish(0);
    await vi.advanceTimersByTimeAsync(0);
    hook.rerender({ active: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['disarm', 'disarm']);
    finish(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['disarm', 'disarm', 'prewarm']);
  });
});

/** Disarms that finish only when the test says so, in any order. */
function deferredDisarms() {
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  const disarm = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        calls.push('disarm');
        pending.push(() => resolve('stopped'));
      }),
  );
  const prewarm = vi.fn(() => {
    calls.push('prewarm');
    return Promise.resolve('started');
  });
  const finish = (index: number) => pending[index]?.();
  return { calls, disarm, finish, prewarm };
}

describe('choosing another model while cleanup is on (BUS-229)', () => {
  it('disarms the old model and warms the new one once that disarm is done', async () => {
    const { disarm, hook, prewarm } = setup({ active: true, ready: true });
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(prewarm).toHaveBeenCalledExactlyOnceWith('launch', M);
    hook.rerender({ active: true, modelId: QUALITY_CLEANUP_MODEL_ID, ready: true });
    expect(disarm).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(prewarm).toHaveBeenLastCalledWith('switch-on', QUALITY_CLEANUP_MODEL_ID);
    expect(prewarm).toHaveBeenCalledTimes(2);
  });

  it('warms the chosen model at launch, and a change before then replaces the launch prewarm', async () => {
    const quality = setup({ active: true, modelId: QUALITY_CLEANUP_MODEL_ID, ready: true });
    vi.advanceTimersByTime(PREWARM_LAUNCH_DELAY_MS);
    expect(quality.prewarm).toHaveBeenCalledExactlyOnceWith('launch', QUALITY_CLEANUP_MODEL_ID);
    const changed = setup({ active: true, ready: true });
    changed.hook.rerender({ active: true, modelId: QUALITY_CLEANUP_MODEL_ID, ready: true });
    await vi.advanceTimersByTimeAsync(PREWARM_LAUNCH_DELAY_MS);
    expect(changed.prewarm.mock.calls).toEqual([['switch-on', QUALITY_CLEANUP_MODEL_ID]]);
  });

  it('does nothing when the model changes while cleanup is off, or with no model', () => {
    const off = setup({ active: false, ready: true });
    off.hook.rerender({ active: false, modelId: QUALITY_CLEANUP_MODEL_ID, ready: true });
    const none = setup({ active: true, modelId: null, ready: true });
    vi.advanceTimersByTime(60_000);
    expect(off.prewarm).not.toHaveBeenCalled();
    expect(off.disarm).not.toHaveBeenCalled();
    expect(none.prewarm).not.toHaveBeenCalled();
  });
});
