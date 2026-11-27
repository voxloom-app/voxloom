/** @vitest-environment jsdom */
// Shared paste binds at completion; the recording-start API remains legacy-only.
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CaptureState } from '../../../src/services/capture/types';
import type { UseCaptureStateResult } from '../../../src/services/capture/useCaptureState';
import type { DeliveryPlatformAdapter, TargetSnapshot } from '../../../src/services/delivery';
import { dogfoodTranscribeAndCopy } from '../../../src/services/stt/dogfoodPath';
import { createMockSttEngine, createMockSttModelStore } from '../../../src/services/stt/mockStt';
import { useDogfoodCapture } from '../../../src/services/stt/useDogfoodCapture';

type App = 'notes' | 'wezterm' | 'ghostty';

const APPS: Record<App, TargetSnapshot> = {
  ghostty: {
    appName: 'Ghostty', appPid: 88, capturedAt: 1, elementId: null, elementRole: null,
    insertable: false, kind: 'unsupported', knownTerminal: true,
    pasteApp: '/Applications/Ghostty.app', pasteTerminal: true, reason: 'no field',
  },
  notes: {
    appName: 'Notes', appPid: 11, capturedAt: 1, elementId: '11:AXTextArea:#1',
    elementRole: 'AXTextArea', insertable: true, kind: 'insertable', pasteApp: null,
    pasteTerminal: false, reason: null,
  },
  wezterm: {
    appName: 'WezTerm', appPid: 77, capturedAt: 1, elementId: null, elementRole: null,
    insertable: false, kind: 'unsupported', knownTerminal: true,
    pasteApp: '/Applications/WezTerm.app', pasteTerminal: true, reason: 'no field',
  },
};

function stubCapture(state: CaptureState): UseCaptureStateResult {
  return {
    cancelActiveCapture: vi.fn(), captureReady: true, captureState: state,
    deviceListError: null, devices: [], devicesLoading: false,
    permissionStatus: 'authorized', prepareDeviceChange: vi.fn().mockResolvedValue(true),
    refreshDevices: vi.fn().mockResolvedValue(undefined), requestMicPermission: vi.fn(),
    runMicTest: vi.fn(), startFullCaptureSession: vi.fn().mockResolvedValue('started'),
    stopFullCapture: vi.fn(), stopMicTest: vi.fn(),
  };
}

/** Dictate with `atStart` in front, switch to `atDelivery` during transcription. */
async function dictate(atStart: App, atDelivery: App, shared = false, afterCleanup?: App) {
  const store = createMockSttModelStore();
  await store.download('whisper-tiny.en');
  let front: App = atStart;
  let board = 'prior';
  const snapshot = () => shared
    ? { ...APPS[front], sharedPasteToken: `completion-${front}`, pasteTerminal: false, pasteApp: null }
    : APPS[front];
  let enterCleanup!: () => void;
  let finishCleanup!: () => void;
  const cleanupEntered = new Promise<void>((resolve) => { enterCleanup = resolve; });
  const cleanupGate = new Promise<void>((resolve) => { finishCleanup = resolve; });
  const pasteBinding = vi.fn(async () => {
    const app = APPS[front];
    return app.pasteTerminal && app.appPid != null && app.pasteApp
      ? { appPid: app.appPid, pasteApp: app.pasteApp }
      : null;
  });
  const platform: DeliveryPlatformAdapter = {
    clipboardRead: vi.fn(async () => ({ ok: true, text: board })),
    clipboardRestore: vi.fn().mockResolvedValue(undefined),
    clipboardWrite: vi.fn(async (text: string) => { board = text; }),
    insertText: vi.fn().mockResolvedValue(undefined),
    pasteBinding,
    pasteText: vi.fn().mockResolvedValue({ clipboardRestored: true, restoreSkippedReason: null }),
    pasteTarget: vi.fn().mockResolvedValue({ clipboardRestored: true, restoreSkippedReason: null }),
    snapshotTarget: vi.fn(async () => snapshot()),
    validateTarget: vi.fn(async () => snapshot()),
  };
  let resolveStt!: (value: { text: string; language: string }) => void;
  const transcribe = vi.fn(() => new Promise<{ text: string; language: string }>((resolve) => {
    resolveStt = resolve;
  }));
  const dogfood: typeof dogfoodTranscribeAndCopy = (options) => dogfoodTranscribeAndCopy({
    ...options,
    createEngine: (modelId) => ({ ...createMockSttEngine({ modelId }), transcribe }),
    ...(afterCleanup ? { cleanup: async (text: string) => {
      enterCleanup();
      await cleanupGate;
      return { status: 'cleaned' as const, finalText: text, reason: null };
    } } : {}),
  });
  const toasts: string[] = [];
  const records: Array<{ status: string }> = [];
  const { result, rerender } = renderHook(({ state }: { state: CaptureState }) => useDogfoodCapture({
    captureApi: stubCapture(state),
    clipboard: { copy: vi.fn().mockResolvedValue(undefined) },
    createModelStore: () => store,
    deliveryPlatform: platform,
    dogfood,
    modelId: 'whisper-tiny.en',
    onHistoryRecord: (record) => records.push(record),
    onToast: (message) => toasts.push(message),
  }), { initialProps: { state: { kind: 'idle' } as CaptureState } });
  await act(async () => { await result.current.start(); });
  await act(async () => { await result.current.stop(); });
  rerender({ state: { kind: 'stopped', audio: { id: 'a1', duration_ms: 700, sample_rate_hz: 16_000 } } });
  await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
  front = atDelivery;
  await act(async () => { resolveStt({ language: 'en', text: 'hello there' }); });
  if (afterCleanup) {
    await cleanupEntered;
    expect(platform.snapshotTarget).not.toHaveBeenCalled();
    front = afterCleanup;
    await act(async () => { finishCleanup(); });
  }
  await waitFor(() => expect(result.current.phase).toBe('success'));
  await waitFor(() => expect(records).toHaveLength(1));
  return { pasteBinding, platform, records, result, toasts };
}

describe('shared completion binding and legacy recording-start compatibility', () => {
  it.each([
    ['notes', 'wezterm'], ['wezterm', 'ghostty'],
  ] as const)('%s at recording start → %s at completion: shared paste, no automatic Copy', async (start, completion) => {
    const { platform, records, result, toasts } = await dictate(start, completion, true);
    expect(platform.pasteTarget).toHaveBeenCalledExactlyOnceWith('hello there', expect.objectContaining({
      appPid: APPS[completion].appPid, sharedPasteToken: `completion-${completion}`,
    }));
    expect(platform.pasteText).not.toHaveBeenCalled();
    expect(platform.insertText).not.toHaveBeenCalled();
    expect(platform.clipboardWrite).not.toHaveBeenCalled();
    expect(records[0].status).toBe('pasted');
    expect(result.current.message).toBeNull();
    expect(toasts.filter((t) => /paste|clipboard|inserted|copied/i.test(t))).toEqual([]);
  });

  it('A at start → B after release → C after cleanup: selects C only at completion', async () => {
    const { platform, records } = await dictate('notes', 'wezterm', true, 'ghostty');
    expect(platform.pasteTarget).toHaveBeenCalledExactlyOnceWith('hello there', expect.objectContaining({
      appPid: APPS.ghostty.appPid, sharedPasteToken: 'completion-ghostty',
    }));
    expect(platform.clipboardWrite).not.toHaveBeenCalled();
    expect(records[0].status).toBe('pasted');
  });

  it('Notes at hold start, WezTerm at delivery: copies, never pastes', async () => {
    const { platform, records } = await dictate('notes', 'wezterm');
    expect(platform.pasteText).not.toHaveBeenCalled();
    expect(records[0].status).toBe('copied');
    expect(platform.clipboardWrite).toHaveBeenCalledWith('hello there');
  });

  it('WezTerm at hold start, Ghostty during transcription: copies, never pastes', async () => {
    const { platform, records } = await dictate('wezterm', 'ghostty');
    expect(platform.pasteText).not.toHaveBeenCalled();
    expect(records[0].status).toBe('copied');
  });

  it('WezTerm throughout: pastes into the terminal captured at hold start, silently', async () => {
    const { pasteBinding, platform, records, result, toasts } = await dictate('wezterm', 'wezterm');
    expect(platform.pasteText).toHaveBeenCalledWith('hello there', { appPid: 77, pasteApp: '/Applications/WezTerm.app' });
    // Looked up once, when the session started: not again at delivery.
    expect(pasteBinding).toHaveBeenCalledTimes(1);
    expect(records[0].status).toBe('pasted');
    // No status line, no toast beyond the progress ones; the HUD stays quiet.
    expect(result.current.message).toBeNull();
    expect(result.current.hudResult).toBeNull();
    expect(toasts.filter((t) => /paste|clipboard|inserted|copied/i.test(t))).toEqual([]);
  });

  it('an adapter with no paste support captures nothing and behaves as before', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    let board = 'prior';
    const platform: DeliveryPlatformAdapter = {
      clipboardRead: vi.fn(async () => ({ ok: true, text: board })),
      clipboardRestore: vi.fn().mockResolvedValue(undefined),
      clipboardWrite: vi.fn(async (text: string) => { board = text; }),
      insertText: vi.fn().mockResolvedValue(undefined),
      snapshotTarget: vi.fn(async () => APPS.wezterm),
      validateTarget: vi.fn(async () => APPS.wezterm),
    };
    const records: Array<{ status: string }> = [];
    const { result, rerender } = renderHook(({ state }: { state: CaptureState }) => useDogfoodCapture({
      captureApi: stubCapture(state), clipboard: { copy: vi.fn().mockResolvedValue(undefined) },
      createModelStore: () => store, deliveryPlatform: platform, modelId: 'whisper-tiny.en',
      onHistoryRecord: (record) => records.push(record),
    }), { initialProps: { state: { kind: 'idle' } as CaptureState } });
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    rerender({ state: { kind: 'stopped', audio: { id: 'a2', duration_ms: 700, sample_rate_hz: 16_000 } } });
    await waitFor(() => expect(records).toHaveLength(1));
    expect(records[0].status).toBe('copied');
  });
});
