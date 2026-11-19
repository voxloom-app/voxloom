import { beforeEach, expect, it, vi } from 'vitest';
import { createSetupBoundary } from '../../src/features/onboarding/setupBoundary';
const invoke = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ native: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => shell.native }));
beforeEach(() => { shell.native = true; invoke.mockReset(); });
it('queries without requests and sends explicit permission/settings and model IDs to native adapters', async () => {
  invoke.mockResolvedValue({ microphone: 'denied', accessibility: 'not-granted' });
  const io = createSetupBoundary();
  expect((await io.query()).accessibility).toBe('not-granted');
  expect(invoke.mock.calls).toEqual([['setup_query_permissions']]);
  await io.request('microphone');
  expect(invoke).toHaveBeenLastCalledWith('setup_request_permission', { kind: 'microphone' });
  await io.openSettings('accessibility');
  expect(invoke).toHaveBeenLastCalledWith('setup_open_permission_settings', { kind: 'accessibility' });
  await io.readiness('whisper-base.en');
  expect(invoke).toHaveBeenLastCalledWith('setup_model_readiness', { modelId: 'whisper-base.en' });
});

// These strings show only outside the Tauri shell (browser preview); inside the
// desktop app, on any platform, setup always goes to the native commands.
it('uses platform-neutral copy when setup runs outside the desktop app', async () => {
  shell.native = false;
  const io = createSetupBoundary();
  const guided = 'Real guided setup requires the Voxloom desktop app.';
  await expect(io.request('microphone')).rejects.toThrow(guided);
  await expect(io.openSettings('accessibility')).rejects.toThrow(guided);
  expect(await io.readiness('whisper-base.en')).toEqual({
    modelId: 'whisper-base.en',
    ready: false,
    reason: 'Real dictation practice requires the Voxloom desktop app.',
  });
  expect(await io.query()).toEqual({ microphone: 'unsupported', accessibility: 'unsupported' });
  expect(invoke).not.toHaveBeenCalled();
});

it('never shows the browser-only copy inside the desktop app', async () => {
  invoke.mockResolvedValue({ modelId: 'whisper-base.en', ready: true, reason: null });
  const io = createSetupBoundary();
  expect(await io.readiness('whisper-base.en')).toEqual({ modelId: 'whisper-base.en', ready: true, reason: null });
  await io.request('microphone');
  expect(invoke).toHaveBeenCalledTimes(2);
});
