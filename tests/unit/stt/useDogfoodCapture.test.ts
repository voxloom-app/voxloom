/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClipboardAdapter } from '../../../src/services/clipboard';
import type { DeliveryPlatformAdapter, TargetSnapshot } from
  '../../../src/services/delivery';
import type { CaptureState } from '../../../src/services/capture/types';
import type { UseCaptureStateResult } from
  '../../../src/services/capture/useCaptureState';
import { dogfoodTranscribeAndCopy } from '../../../src/services/stt/dogfoodPath';
import { createStubDeliveryAdapter } from '../../../src/services/delivery';
import type { DogfoodResult } from '../../../src/services/stt/dogfoodPath';
import {
  createMockSttEngine,
  createMockSttModelStore,
} from '../../../src/services/stt/mockStt';
import { useDogfoodCapture } from
  '../../../src/services/stt/useDogfoodCapture';
import * as cancelScopeModule from '../../../src/services/shortcut/cancelScope';
import type { CleanupEngine } from '../../../src/services/cleanup/contracts';
import { CLEANUP_MODEL_ID } from '../../../src/services/cleanup/types';
import {
  CAPTURE_CANCELLED_NOTHING,
  STOP_BUDGET_MS,
  STOP_CANCELLED_PENDING,
  STOP_CANCELLED_SAVED,
  STOP_LATE_NOTHING_SAVED,
  STOP_LATE_SAVED,
  STOP_TAKING_LONGER_PENDING,
  STOP_TAKING_LONGER_SAVED,
  STOP_TAKING_LONGER_SAVED_HISTORY,
} from '../../../src/services/stt/stopBudget';

function clipboard(): ClipboardAdapter {
  return { copy: vi.fn().mockResolvedValue(undefined) };
}

function deliveryOutcome(
  status: 'inserted' | 'copied' | 'failed',
  text: string,
  message?: string,
) {
  return {
    clipboardRestored: false,
    detail: status === 'failed' ? 'NotAllowedError' : null,
    message: message
      ?? (status === 'copied'
        ? 'Copied — test'
        : status === 'inserted'
        ? 'Inserted'
        : 'Failed — NotAllowedError'),
    restoreSkippedReason: null,
    status,
    text,
  };
}


function stubCapture(state: CaptureState): UseCaptureStateResult {
  return {
    cancelActiveCapture: vi.fn(),
    captureReady: true,
    captureState: state,
    deviceListError: null,
    devices: [],
    devicesLoading: false,
    permissionStatus: 'authorized',
    prepareDeviceChange: vi.fn().mockResolvedValue(true),
    refreshDevices: vi.fn().mockResolvedValue(undefined),
    requestMicPermission: vi.fn(),
    runMicTest: vi.fn(),
    startFullCaptureSession: vi.fn().mockResolvedValue('started'),
    stopFullCapture: vi.fn(),
    stopMicTest: vi.fn(),
  };
}

async function mockDogfoodSuccess(
  { modelId, audio }: { modelId: string; audio: { duration_ms: number; id: string; sample_rate_hz: number } },
): Promise<DogfoodResult> {
  const engine = createMockSttEngine({ modelId });
  const transcript = await engine.transcribe({
    durationMs: audio.duration_ms,
    id: audio.id,
    sampleRateHz: audio.sample_rate_hz,
  });
  return {
    copied: true,
    delivery: {
      clipboardRestored: false,
      detail: 'test',
      message: 'Copied — test',
      restoreSkippedReason: null,
      status: 'copied' as const,
      text: transcript.text,
    },
    transcript,
  };
}

describe('useDogfoodCapture', () => {
  it.each([
    ['A', 'B', 'B', false, true, 'inserted'],
    ['A', 'auto', 'C', false, true, 'inserted'],
    ['A', 'race', 'C', false, true, 'copied'],
    ['A', 'race', 'C', false, false, 'failed'],
    ['A', 'B', 'C', false, true, 'inserted'],
    ['A', 'B', 'C', false, false, 'inserted'],
    ['A', 'A', 'A', false, true, 'inserted'],
    ['A', 'B', 'B', true, true, 'copied'],
    ['A', 'B', 'C', true, false, 'failed'],
  ] as const)('completion target %s→%s→%s secure=%s fallback=%s yields %s',
    async (startField, stopField, finalField, secure, fallback, status) => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      let focus = startField as string;
      const inserted = vi.fn().mockResolvedValue(undefined);
      const snapshot = vi.fn(async (): Promise<TargetSnapshot> => ({
        appName: 'Notes', appPid: 42, capturedAt: 1,
        elementId: focus, elementRole: 'AXTextArea',
        insertable: !secure, kind: secure ? 'secure' : 'insertable', reason: null,
      }));
      const platform = createStubDeliveryAdapter({
        clipboard: clip, snapshot, insert: inserted,
        validate: async (intended) => intended.elementId === (stopField === 'race' ? 'D' : focus)
          ? intended : { ...intended, insertable: false, kind: 'changed', reason: 'focus changed' },
      });
      let resolveStt!: (value: { text: string; language: string }) => void;
      const transcribe = vi.fn(() => new Promise<{ text: string; language: string }>((resolve) => {
        resolveStt = resolve;
      }));
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => dogfoodTranscribeAndCopy({
        ...options,
        createEngine: (modelId) => ({ ...createMockSttEngine({ modelId }), transcribe }),
      });
      const { result, rerender } = renderHook(({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: stubCapture(state), clipboard: clip, clipboardFallback: fallback,
        createModelStore: () => store, deliveryPlatform: platform, dogfood,
        modelId: 'whisper-tiny.en',
      }), { initialProps: { state: { kind: 'idle' } as CaptureState } });
      await act(async () => { await result.current.start(); });
      focus = stopField;
      if (stopField !== 'auto') await act(async () => { await result.current.stop(); });
      expect(snapshot).not.toHaveBeenCalled();
      expect(result.current.intendedTarget).toBeNull();
      rerender({ state: { kind: 'stopped', audio: {
        id: 'release-audio', duration_ms: 700, sample_rate_hz: 16_000,
      } } });
      await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      expect(snapshot).not.toHaveBeenCalled();
      focus = finalField;
      await act(async () => { resolveStt({ text: 'release transcript', language: 'en' }); });
      await waitFor(() => expect(result.current.phase).toBe('success'));
      expect(result.current.message?.toLowerCase()).toMatch(new RegExp(`^${status}`));
      expect(inserted).toHaveBeenCalledTimes(status === 'inserted' ? 1 : 0);
      if (status === 'inserted') expect(inserted).toHaveBeenCalledWith(
        'release transcript', expect.objectContaining({ elementId: finalField }),
      );
      expect(clip.copy).toHaveBeenCalledTimes(status === 'copied' ? 1 : 0);
      expect(snapshot).toHaveBeenCalledOnce();
      expect(result.current.intendedTarget?.elementId).toBe(finalField);
    });

  it.each(['stt', 'snapshot', 'validate', 'cancel'] as const)(
    'superseding during %s prevents stale delivery and preserves the newer phase', async (stage) => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const target: TargetSnapshot = {
        appName: 'Notes', appPid: 42, capturedAt: 1, elementId: 'C',
        elementRole: 'AXTextArea', insertable: true, kind: 'insertable', reason: null,
      };
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => { resume = resolve; });
      const insert = vi.fn();
      const snapshot = vi.fn(async () => { if (stage === 'snapshot') await gate; return target; });
      const validate = vi.fn(async () => { if (stage === 'validate') await gate; return target; });
      const transcribe = vi.fn(async () => {
        if (stage === 'stt' || stage === 'cancel') await gate;
        return { text: 'old transcript', language: 'en' };
      });
      const history = vi.fn();
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => dogfoodTranscribeAndCopy({
        ...options, createEngine: (modelId) => ({ ...createMockSttEngine({ modelId }), transcribe }),
      });
      const { result, rerender } = renderHook(({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: stubCapture(state), clipboard: clip,
        createModelStore: () => store, modelId: 'whisper-tiny.en', dogfood,
        onHistoryRecord: history,
        deliveryPlatform: createStubDeliveryAdapter({ clipboard: clip, snapshot, validate, insert }),
      }), { initialProps: { state: { kind: 'idle' } as CaptureState } });
      await act(async () => { await result.current.start(); await result.current.stop(); });
      rerender({ state: { kind: 'stopped', audio: {
        id: 'old-audio', duration_ms: 700, sample_rate_hz: 16_000,
      } } });
      await waitFor(() => expect(stage === 'stt' || stage === 'cancel' ? transcribe : stage === 'snapshot' ? snapshot : validate).toHaveBeenCalledOnce());
      rerender({ state: { kind: 'idle' } });
      await act(async () => {
        if (stage === 'cancel') result.current.cancel();
        else await result.current.start();
        resume(); });
      await waitFor(() => expect(history).toHaveBeenCalledOnce());
      expect(insert).not.toHaveBeenCalled();
      expect(clip.copy).not.toHaveBeenCalled();
      if (stage === 'stt') expect(snapshot).not.toHaveBeenCalled();
      expect(result.current.intendedTarget).toBeNull();
      expect(result.current.phase).toBe(stage === 'cancel' ? 'cancelled' : 'recording');
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'old transcript',
      }));
    });

  it('cancel suppresses a late transcription rejection and allows the next session', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    let reject!: (error: Error) => void;
    const dogfood = vi.fn(() => new Promise<DogfoodResult>((_, fail) => { reject = fail; }));
    const toast = vi.fn();
    const history = vi.fn();
    const { result, rerender } = renderHook(({ state }: { state: CaptureState }) => useDogfoodCapture({
      captureApi: stubCapture(state), clipboard: clipboard(), createModelStore: () => store,
      dogfood, modelId: 'whisper-tiny.en', onToast: toast, onHistoryRecord: history,
    }), { initialProps: { state: { kind: 'stopped', audio: {
      id: 'late-error', duration_ms: 700, sample_rate_hz: 16_000,
    } } as CaptureState } });
    await waitFor(() => expect(dogfood).toHaveBeenCalledOnce());
    act(() => result.current.cancel());
    expect(result.current.message).toBe(STOP_CANCELLED_PENDING);
    toast.mockClear();
    await act(async () => { reject(new Error('late failure')); });
    expect(toast).toHaveBeenCalledWith(STOP_LATE_NOTHING_SAVED);
    expect(history).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('cancelled');
    rerender({ state: { kind: 'idle' } });
    await act(async () => { await result.current.start(); });
    expect(result.current.phase).toBe('recording');
  });

  it('Escape cancels pending capture startup, ignores idle Escape, and can restart', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    let acquired!: (value: 'started') => void;
    const capture = stubCapture({ kind: 'idle' });
    capture.startFullCaptureSession = vi.fn(() => new Promise<'started'>((resolve) => { acquired = resolve; }));
    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: capture, clipboard: clipboard(), createModelStore: () => store, modelId: 'whisper-tiny.en',
    }));
    const idle = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    document.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    let start!: Promise<void>;
    act(() => { start = result.current.start(); });
    await waitFor(() => expect(capture.startFullCaptureSession).toHaveBeenCalledOnce());
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => { document.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(capture.cancelActiveCapture).toHaveBeenCalledOnce();
    await act(async () => { acquired('started'); await start; });
    expect(result.current.phase).toBe('cancelled');
    vi.mocked(capture.startFullCaptureSession).mockResolvedValue('started');
    await act(async () => { await result.current.start(); });
    expect(result.current.phase).toBe('recording');
  });

  it('does not claim recording when capture is still owned by a previous hold', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const toast = vi.fn();
    const startFullCaptureSession = vi.fn().mockResolvedValue('busy');
    const stopFullCapture = vi.fn();
    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: {
        ...stubCapture({ kind: 'idle' }),
        startFullCaptureSession,
        stopFullCapture,
      },
      clipboard: clipboard(),
      createModelStore: () => store,
      modelId: 'whisper-tiny.en',
      onToast: toast,
    }));

    await act(async () => { await result.current.start(); });
    expect(result.current.phase).toBe('error');
    expect(result.current.message).toMatch(/already active/i);
    expect(stopFullCapture).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/already active/i));
  });

  it('waits for acquisition and honors a stop requested during start', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    let acquired!: (status: 'started') => void;
    const startFullCaptureSession = vi.fn(() => new Promise<'started'>((resolve) => {
      acquired = resolve;
    }));
    const stopFullCapture = vi.fn().mockResolvedValue(undefined);
    let focus = 'A';
    const snapshot = vi.fn(async (): Promise<TargetSnapshot> => ({
      appName: 'Notes', appPid: 42, capturedAt: 1, elementId: focus,
      elementRole: 'AXTextField', insertable: true, kind: 'insertable', reason: null,
    }));
    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: {
        ...stubCapture({ kind: 'idle' }),
        startFullCaptureSession,
        stopFullCapture,
      },
      clipboard: clipboard(),
      createModelStore: () => store,
      deliveryPlatform: createStubDeliveryAdapter({ clipboard: clipboard(), snapshot }),
      modelId: 'whisper-tiny.en',
    }));

    let start!: Promise<void>;
    act(() => { start = result.current.start(); });
    await waitFor(() => expect(startFullCaptureSession).toHaveBeenCalledOnce());
    expect(result.current.phase).not.toBe('recording');
    focus = 'B';
    await act(async () => { await result.current.stop(); });
    focus = 'C';
    acquired('started');
    await act(async () => { await start; });
    expect(stopFullCapture).toHaveBeenCalledTimes(2);
    expect(snapshot).not.toHaveBeenCalled();
    expect(result.current.intendedTarget).toBeNull();
  });

  it('keeps dictating without Escape-cancel when the cancel tap cannot arm', async () => {
    const arm = vi.spyOn(cancelScopeModule, 'beginCancelScope')
      .mockRejectedValueOnce(new Error('Escape cancellation unavailable [cancel-tap-create-failed].'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const dogfood = vi.fn(mockDogfoodSuccess);
    let captureState: CaptureState = { kind: 'idle' };
    const { result, rerender } = renderHook(
      ({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: {
          ...stubCapture(state),
          startFullCaptureSession: async () => {
            captureState = { device: 'Mic', generation: 1, kind: 'active', request_id: 'full-1' };
            return 'started';
          },
          stopFullCapture: async () => {
            captureState = {
              audio: { duration_ms: 900, id: 'pcm-notap-1', sample_rate_hz: 16_000 },
              kind: 'stopped',
            };
          },
        },
        clipboard: clipboard(),
        createModelStore: () => store,
        dogfood: dogfood as never,
        modelId: 'whisper-tiny.en',
      }),
      { initialProps: { state: captureState } },
    );
    try {
      await act(async () => { await result.current.start(); });
      rerender({ state: captureState });
      expect(result.current.phase).toBe('recording');
      expect(result.current.scopeReady).toBe(false);
      // The HUD (waveform) still shows; only Escape-cancel is unavailable.
      expect(result.current.hudReady).toBe(true);
      expect(warn).toHaveBeenCalled();
      await act(async () => { await result.current.stop(); });
      rerender({ state: captureState });
      await waitFor(() => expect(result.current.phase).toBe('success'));
      expect(dogfood).toHaveBeenCalledOnce();
    } finally {
      arm.mockRestore();
      warn.mockRestore();
    }
  });

  it('auto-runs dogfoodTranscribeAndCopy after clean stop with audio', async () => {
    const clip = clipboard();
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');

    const dogfood = vi.fn(mockDogfoodSuccess);

    let captureState: CaptureState = { kind: 'idle' };
    const startFullCaptureSession = vi.fn(async () => {
      captureState = {
        device: 'Mic',
        generation: 1,
        kind: 'active',
        request_id: 'full-1',
      };
    });
    const stopFullCapture = vi.fn(async () => {
      captureState = {
        audio: {
          duration_ms: 900,
          id: 'pcm-dogfood-1',
          sample_rate_hz: 16_000,
        },
        kind: 'stopped',
      };
    });

    const { result, rerender } = renderHook(
      ({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: {
          ...stubCapture(state),
          startFullCaptureSession: async () => {
            await startFullCaptureSession();
            return 'started';
          },
          stopFullCapture: async () => {
            await stopFullCapture();
          },
        },
        clipboard: clip,
        createModelStore: () => store,
        dogfood: dogfood as never,
        modelId: 'whisper-tiny.en',
      }),
      { initialProps: { state: captureState } },
    );

    await act(async () => {
      await result.current.start();
    });
    rerender({ state: captureState });
    expect(result.current.phase).toBe('recording');
    expect(startFullCaptureSession).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.stop();
    });
    rerender({ state: captureState });

    await waitFor(() => expect(dogfood).toHaveBeenCalledOnce());
    expect(dogfood).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ id: 'pcm-dogfood-1' }),
        modelId: 'whisper-tiny.en',
      }),
    );
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(result.current.transcript?.text).toBeTruthy();
    expect(result.current.message).toMatch(/^Copied/i);
  });

  it('surfaces transcript + warning toast when Copy soft-fails', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const toast = vi.fn();

    const dogfood = vi.fn(async (): Promise<DogfoodResult> => ({
      copied: false,
      copyWarning: 'NotAllowedError',
      delivery: deliveryOutcome('failed', 'still here', 'Failed — NotAllowedError'),
      transcript: { language: 'en', text: 'still here' },
    }));

    const captureState: CaptureState = {
      audio: {
        duration_ms: 500,
        id: 'pcm-copy-fail',
        sample_rate_hz: 16_000,
      },
      kind: 'stopped',
    };

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture(captureState),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onToast: toast,
    }));

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(result.current.transcript?.text).toBe('still here');
    expect(result.current.message).toMatch(/^Failed/i);
    expect(result.current.message).toMatch(/NotAllowedError/);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/^Failed/i),
    );
  });

  it('errors clearly when the selected model is not downloaded', async () => {
    const store = createMockSttModelStore();
    const dogfood = vi.fn();
    const toast = vi.fn();

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture({ kind: 'idle' }),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onToast: toast,
    }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('error');
    const expected =
      'Model “whisper-tiny.en” is not downloaded (status: missing). '
      + 'Download the selected model in Settings first.';
    expect(result.current.message).toBe(expected);
    expect(toast).toHaveBeenCalledWith(expected);
    expect(dogfood).not.toHaveBeenCalled();
  });

  it('says the selected model is damaged, once, when its status is failed', async () => {
    const store = createMockSttModelStore();
    const real = store.status.bind(store);
    vi.spyOn(store, 'status').mockImplementation(async (id) => {
      const info = await real(id);
      return info ? { ...info, status: 'failed' as const } : info;
    });
    const dogfood = vi.fn();
    const toast = vi.fn();

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture({ kind: 'idle' }),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onToast: toast,
    }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.phase).toBe('error');
    const expected = 'Model file is damaged. Download it again in Settings.';
    expect(result.current.message).toBe(expected);
    expect(toast).toHaveBeenCalledWith(expected);
    expect(dogfood).not.toHaveBeenCalled();
  });

  it.each([
    ['unreadable', 'Couldn\'t open the model file. Try again, or download it again if this keeps happening.'],
    ['read-failed', 'Couldn\'t read the model file. Download it again in Settings.'],
  ] as const)('says why the model file failed when its status is failed (%s)', async (reason, expected) => {
    const store = createMockSttModelStore();
    const real = store.status.bind(store);
    vi.spyOn(store, 'status').mockImplementation(async (id) => {
      const info = await real(id);
      return info ? { ...info, status: 'failed' as const, failureReason: reason } : info;
    });
    const dogfood = vi.fn();
    const toast = vi.fn();

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture({ kind: 'idle' }),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onToast: toast,
    }));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.message).toBe(expected);
    expect(toast).toHaveBeenCalledWith(expected);
    expect(dogfood).not.toHaveBeenCalled();
  });

  it('stops audio without any target lookup', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const order: string[] = [];
    const status = store.status.bind(store);
    store.status = vi.fn(async (id: string) => {
      order.push('model');
      return status(id);
    }) as typeof store.status;
    const intended: TargetSnapshot = {
      appName: 'Brave',
      appPid: 7,
      capturedAt: 1,
      elementId: '7:AXTextField:',
      elementRole: 'AXTextField',
      insertable: true,
      kind: 'insertable',
      reason: null,
    };
    const platform: DeliveryPlatformAdapter = {
      clipboardRead: vi.fn().mockResolvedValue({ ok: true, text: '' }),
      clipboardRestore: vi.fn(),
      clipboardWrite: vi.fn(),
      insertText: vi.fn(),
      snapshotTarget: vi.fn(async () => {
        order.push('snapshot');
        return intended;
      }),
      validateTarget: vi.fn().mockResolvedValue(intended),
    };
    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture({ kind: 'idle' }),
      clipboard: clipboard(),
      createModelStore: () => store,
      deliveryPlatform: platform,
      dogfood: vi.fn() as never,
      modelId: 'whisper-tiny.en',
    }));
    await act(async () => {
      await result.current.start();
    });
    expect(order).toEqual(['model']);
    expect(result.current.intendedTarget).toBeNull();
    const targetB = { ...intended, elementId: 'field-B' };
    vi.mocked(platform.snapshotTarget).mockImplementation(async () => {
      order.push('snapshot-B');
      return targetB;
    });
    await act(async () => { await result.current.stop(); });
    expect(order).toEqual(['model']);
    expect(result.current.intendedTarget).toBeNull();
  });

  it('cancel discards without calling dogfood STT', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const dogfood = vi.fn();
    let captureState: CaptureState = { kind: 'idle' };
    const cancelActiveCapture = vi.fn(() => {
      captureState = { kind: 'cancelled' };
    });
    const startFullCaptureSession = vi.fn(async () => {
      captureState = {
        device: 'Mic',
        generation: 1,
        kind: 'active',
        request_id: 'full-2',
      };
      return 'started' as const;
    });

    const { result, rerender } = renderHook(
      ({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: {
          ...stubCapture(state),
          cancelActiveCapture,
          startFullCaptureSession,
        },
        clipboard: clipboard(),
        createModelStore: () => store,
        dogfood: dogfood as never,
        modelId: 'whisper-tiny.en',
      }),
      { initialProps: { state: captureState } },
    );

    await act(async () => {
      await result.current.start();
    });
    rerender({ state: captureState });

    act(() => {
      result.current.cancel();
    });
    rerender({ state: captureState });

    expect(cancelActiveCapture).toHaveBeenCalledOnce();
    expect(dogfood).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('cancelled');
  });

  it('a stale session\'s STT completion does not clobber a newer session\'s phase', async () => {
    // Hold 1 stops → transcribing (slow). User starts hold 2 before STT
    // resolves. Session 1's completion may still record delivery evidence
    // but must not flip phase "recording" → "success" mid-session-2.
    const clip = clipboard();
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    let resolveDogfood: ((r: DogfoodResult) => void) | null = null;
    const dogfood = vi.fn(() => new Promise<DogfoodResult>((resolve) => {
      resolveDogfood = resolve;
    }));
    const onHistoryRecord = vi.fn();
    const onToast = vi.fn();

    let captureState: CaptureState = { kind: 'idle' };
    let generation = 0;
    const startFullCaptureSession = vi.fn(async () => {
      generation += 1;
      captureState = {
        device: 'Mic',
        generation,
        kind: 'active',
        request_id: `full-${generation}`,
      };
      return 'started' as const;
    });
    const stopFullCapture = vi.fn(async () => {
      captureState = {
        audio: {
          duration_ms: 900,
          id: `pcm-${generation}`,
          sample_rate_hz: 16_000,
        },
        kind: 'stopped',
      };
    });

    const { result, rerender } = renderHook(
      ({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: {
          ...stubCapture(state),
          startFullCaptureSession,
          stopFullCapture,
        },
        clipboard: clip,
        createModelStore: () => store,
        dogfood: dogfood as never,
        modelId: 'whisper-tiny.en',
        onHistoryRecord,
        onToast,
      }),
      { initialProps: { state: captureState } },
    );

    // Session 1: start → stop → transcribing (dogfood pending).
    await act(async () => {
      await result.current.start();
    });
    rerender({ state: captureState });
    await act(async () => {
      await result.current.stop();
    });
    rerender({ state: captureState });
    await waitFor(() => expect(dogfood).toHaveBeenCalledOnce());
    expect(result.current.phase).toBe('transcribing');

    // Session 2 starts while session 1 STT is still in flight.
    await act(async () => {
      await result.current.start();
    });
    rerender({ state: captureState });
    expect(result.current.phase).toBe('recording');

    // Session 1 completes late.
    const late = await mockDogfoodSuccess({
      audio: { duration_ms: 900, id: 'pcm-1', sample_rate_hz: 16_000 },
      modelId: 'whisper-tiny.en',
    });
    await act(async () => {
      resolveDogfood?.(late);
      await Promise.resolve();
    });
    rerender({ state: captureState });

    // Still recording session 2; delivery evidence still surfaced.
    expect(result.current.phase).toBe('recording');
    expect(onHistoryRecord).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith(late.delivery.message);
  });

  it('appends a copied history record after successful dogfood', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const onHistoryRecord = vi.fn();
    const dogfood = vi.fn(mockDogfoodSuccess);

    const captureState: CaptureState = {
      audio: {
        duration_ms: 2_400,
        id: 'pcm-hist-ok',
        sample_rate_hz: 16_000,
      },
      kind: 'stopped',
    };

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture(captureState),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      now: () => 42_000,
      onHistoryRecord,
      style: 'casual',
    }));

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(onHistoryRecord).toHaveBeenCalledOnce();
    expect(onHistoryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 2,
        id: 'dogfood-pcm-hist-ok',
        model: 'whisper-tiny.en',
        status: 'copied',
        style: 'casual',
        text: expect.any(String),
      }),
    );
    expect(onHistoryRecord.mock.calls[0][0].text.trim().length).toBeGreaterThan(0);
  });

  it('appends failed history when Copy soft-fails with transcript text', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const onHistoryRecord = vi.fn();

    const dogfood = vi.fn(async (): Promise<DogfoodResult> => ({
      copied: false,
      copyWarning: 'NotAllowedError',
      delivery: deliveryOutcome('failed', 'soft fail text', 'Failed — NotAllowedError'),
      transcript: { language: 'en', text: 'soft fail text' },
    }));

    const captureState: CaptureState = {
      audio: {
        duration_ms: 800,
        id: 'pcm-hist-soft',
        sample_rate_hz: 16_000,
      },
      kind: 'stopped',
    };

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture(captureState),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      now: () => 99_000,
      onHistoryRecord,
      style: 'formal',
    }));

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(onHistoryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dogfood-pcm-hist-soft',
        status: 'failed',
        text: 'soft fail text',
      }),
    );
  });

  it('does not append history for blank transcripts', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const onHistoryRecord = vi.fn();

    const dogfood = vi.fn(async (): Promise<DogfoodResult> => ({
      copied: true,
      delivery: deliveryOutcome('copied', '   '),
      transcript: { language: 'en', text: '   ' },
    }));

    const captureState: CaptureState = {
      audio: {
        duration_ms: 100,
        id: 'pcm-hist-blank',
        sample_rate_hz: 16_000,
      },
      kind: 'stopped',
    };

    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture(captureState),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onHistoryRecord,
    }));

    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(onHistoryRecord).not.toHaveBeenCalled();
  });

  it('does not append history on cancel', async () => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const onHistoryRecord = vi.fn();
    const dogfood = vi.fn();
    let captureState: CaptureState = { kind: 'idle' };
    const cancelActiveCapture = vi.fn(() => {
      captureState = { kind: 'cancelled' };
    });
    const startFullCaptureSession = vi.fn(async () => {
      captureState = {
        device: 'Mic',
        generation: 1,
        kind: 'active',
        request_id: 'full-hist-cancel',
      };
      return 'started' as const;
    });

    const { result, rerender } = renderHook(
      ({ state }: { state: CaptureState }) => useDogfoodCapture({
        captureApi: {
          ...stubCapture(state),
          cancelActiveCapture,
          startFullCaptureSession,
        },
        clipboard: clipboard(),
        createModelStore: () => store,
        dogfood: dogfood as never,
        modelId: 'whisper-tiny.en',
        onHistoryRecord,
      }),
      { initialProps: { state: captureState } },
    );

    await act(async () => {
      await result.current.start();
    });
    rerender({ state: captureState });

    act(() => {
      result.current.cancel();
    });
    rerender({ state: captureState });

    expect(result.current.phase).toBe('cancelled');
    expect(onHistoryRecord).not.toHaveBeenCalled();
    expect(dogfood).not.toHaveBeenCalled();
  });




  it.each([
    ['failed', false],
    ['copied', true],
  ] as const)('records a may-have-inserted %s delivery as Unverified, not Failed/Copied (Review #44)', async (status, copied) => {
    const store = createMockSttModelStore();
    await store.download('whisper-tiny.en');
    const onHistoryRecord = vi.fn();
    const dogfood = vi.fn(async (): Promise<DogfoodResult> => ({
      copied,
      delivery: { ...deliveryOutcome(status, 'maybe here'), mayHaveInserted: true },
      transcript: { language: 'en', text: 'maybe here' },
    }));
    const { result } = renderHook(() => useDogfoodCapture({
      captureApi: stubCapture({ audio: { duration_ms: 500, id: `pcm-maybe-${status}`, sample_rate_hz: 16_000 }, kind: 'stopped' }),
      clipboard: clipboard(),
      createModelStore: () => store,
      dogfood: dogfood as never,
      modelId: 'whisper-tiny.en',
      onHistoryRecord,
    }));
    await waitFor(() => expect(result.current.phase).toBe('success'));
    expect(onHistoryRecord).toHaveBeenCalledWith(expect.objectContaining({
      mayHaveInserted: { copied },
      status: 'unverified',
    }));
  });


  describe('stop safety net', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function flush() {
      await act(async () => {
        await Promise.resolve();
      });
    }

    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it('shows a plain pending note when the safety net fires before any text, then saves a late transcript to History', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let resolve!: (value: DogfoodResult) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((ok) => { resolve = ok; }));
      const toast = vi.fn();
      const history = vi.fn();
      const clip = clipboard();
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 60_000, id: 'pcm-cap-pending', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
        onToast: toast,
      }));
      await flush();
      expect(dogfood).toHaveBeenCalledOnce();
      expect(result.current.phase).toBe('transcribing');
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_PENDING);
      expect(result.current.phase).toBe('success');
      expect(result.current.hudResult).toBeNull();
      expect(history).not.toHaveBeenCalled();
      expect(result.current.message).not.toMatch(/fail|error/i);
      expect(result.current.message).not.toBe(CAPTURE_CANCELLED_NOTHING);
      await act(async () => {
        resolve({
          copied: false,
          delivery: deliveryOutcome('failed', 'late words'),
          transcript: { language: 'en', text: 'late words' },
        });
      });
      await flush();
      expect(history).toHaveBeenCalledOnce();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'late words',
      }));
      expect(toast).toHaveBeenCalledWith(STOP_LATE_SAVED);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('success');
    });

    it('saves existing text to History and the clipboard when the safety net fires, with a plain note rather than an error', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => {
        options.onTranscript?.({ language: 'en', text: 'partial words' });
        return new Promise<DogfoodResult>(() => {});
      };
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 60_000, id: 'pcm-cap-saved', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_SAVED);
      expect(result.current.phase).toBe('success');
      expect(result.current.hudResult).toBe('copied');
      expect(result.current.transcript?.text).toBe('partial words');
      expect(clip.copy).toHaveBeenCalledWith('partial words');
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'copied',
        text: 'partial words',
      }));
      expect(result.current.message).not.toMatch(/fail|error/i);
    });

    it('saves existing text to History only when the safety net fires and Copy fallback is off', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => {
        options.onTranscript?.({ language: 'en', text: 'partial words' });
        return new Promise<DogfoodResult>(() => {});
      };
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 60_000, id: 'pcm-cap-hist', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        clipboardFallback: false,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_SAVED_HISTORY);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'partial words',
      }));
      expect(result.current.phase).toBe('success');
    });

    it('saves existing text on Escape during transcription, and does not say nothing was transcribed', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      const dogfood = vi.fn((options: Parameters<typeof dogfoodTranscribeAndCopy>[0]) => {
        options.onTranscript?.({ language: 'en', text: 'heard you' });
        return new Promise<DogfoodResult>(() => {});
      });
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 8_000, id: 'pcm-esc-saved', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      expect(dogfood).toHaveBeenCalledOnce();
      act(() => result.current.cancel());
      await flush();
      expect(result.current.message).toBe(STOP_CANCELLED_SAVED);
      expect(result.current.phase).toBe('cancelled');
      expect(result.current.message).not.toBe(CAPTURE_CANCELLED_NOTHING);
      expect(clip.copy).toHaveBeenCalledWith('heard you');
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'copied',
        text: 'heard you',
      }));
    });

    it('keeps a pending note on Escape before any text, then saves a late transcript to History', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let resolve!: (value: DogfoodResult) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((ok) => { resolve = ok; }));
      const toast = vi.fn();
      const history = vi.fn();
      const clip = clipboard();
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 8_000, id: 'pcm-esc-pending', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
        onToast: toast,
      }));
      await flush();
      expect(dogfood).toHaveBeenCalledOnce();
      act(() => result.current.cancel());
      await flush();
      expect(result.current.message).toBe(STOP_CANCELLED_PENDING);
      expect(result.current.phase).toBe('cancelled');
      expect(history).not.toHaveBeenCalled();
      await act(async () => {
        resolve({
          copied: false,
          delivery: deliveryOutcome('failed', 'late words'),
          transcript: { language: 'en', text: 'late words' },
        });
      });
      await flush();
      expect(history).toHaveBeenCalledOnce();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'late words',
      }));
      expect(toast).toHaveBeenCalledWith(STOP_LATE_SAVED);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('cancelled');
    });

    it('does not start Transcribing after Escape in the stop-to-stopped gap', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let resolve!: (value: DogfoodResult) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((ok) => { resolve = ok; }));
      const toast = vi.fn();
      const history = vi.fn();
      const clip = clipboard();
      const { result, rerender } = renderHook(
        ({ state }: { state: CaptureState }) => useDogfoodCapture({
          captureApi: stubCapture(state),
          clipboard: clip,
          createModelStore: () => store,
          dogfood,
          modelId: 'whisper-tiny.en',
          onHistoryRecord: history,
          onToast: toast,
        }),
        { initialProps: { state: { kind: 'idle' } as CaptureState } },
      );
      await act(async () => { await result.current.start(); });
      await act(async () => { await result.current.stop(); });
      act(() => { result.current.cancel(); });
      expect(result.current.phase).toBe('cancelled');
      rerender({
        state: {
          audio: { duration_ms: 8_000, id: 'pcm-gap', sample_rate_hz: 16_000 },
          kind: 'stopped',
        },
      });
      await flush();
      expect(dogfood).toHaveBeenCalledOnce();
      expect(result.current.phase).toBe('cancelled');
      expect(result.current.message).toBe(STOP_CANCELLED_PENDING);
      expect(result.current.message).not.toMatch(/Transcribing/i);
      await act(async () => {
        resolve({
          copied: false,
          delivery: deliveryOutcome('failed', 'gap words'),
          transcript: { language: 'en', text: 'gap words' },
        });
      });
      await flush();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'gap words',
      }));
      expect(toast).toHaveBeenCalledWith(STOP_LATE_SAVED);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('cancelled');
    });

    it('treats Escape after the cap as a cancel-pending note, then saves a late result to History', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let resolve!: (value: DogfoodResult) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((ok) => { resolve = ok; }));
      const toast = vi.fn();
      const history = vi.fn();
      const clip = clipboard();
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 8_000, id: 'pcm-esc-after-cap', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
        onToast: toast,
      }));
      await flush();
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_PENDING);
      act(() => result.current.cancel());
      await flush();
      expect(result.current.phase).toBe('cancelled');
      expect(result.current.message).toBe(STOP_CANCELLED_PENDING);
      await act(async () => {
        resolve({
          copied: false,
          delivery: deliveryOutcome('failed', 'after cap'),
          transcript: { language: 'en', text: 'after cap' },
        });
      });
      await flush();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        text: 'after cap',
        status: 'failed',
      }));
      expect(toast).toHaveBeenCalledWith(STOP_LATE_SAVED);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('cancelled');
    });

    it('keeps a late result on History only when a new session has started', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let resolve!: (value: DogfoodResult) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((ok) => { resolve = ok; }));
      const toast = vi.fn();
      const history = vi.fn();
      const clip = clipboard();
      const { result, rerender } = renderHook(
        ({ state }: { state: CaptureState }) => useDogfoodCapture({
          captureApi: stubCapture(state),
          clipboard: clip,
          createModelStore: () => store,
          dogfood,
          modelId: 'whisper-tiny.en',
          onHistoryRecord: history,
          onToast: toast,
        }),
        { initialProps: { state: {
          audio: { duration_ms: 8_000, id: 'pcm-late-new', sample_rate_hz: 16_000 },
          kind: 'stopped',
        } as CaptureState } },
      );
      await flush();
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_PENDING);
      rerender({ state: { kind: 'idle' } });
      await act(async () => { await result.current.start(); });
      expect(result.current.phase).toBe('recording');
      const messageAfterStart = result.current.message;
      await act(async () => {
        resolve({
          copied: true,
          delivery: deliveryOutcome('copied', 'stale words'),
          transcript: { language: 'en', text: 'stale words' },
        });
      });
      await flush();
      expect(history).toHaveBeenCalledWith(expect.objectContaining({
        status: 'failed',
        text: 'stale words',
      }));
      expect(toast).toHaveBeenCalledWith(STOP_LATE_SAVED);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('recording');
      expect(result.current.message).toBe(messageAfterStart);
    });

    it('times cleanup out with the delivery margin so raw text is inserted before the cap', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      const insert = vi.fn().mockResolvedValue(undefined);
      const target: TargetSnapshot = {
        appName: 'Notes', appPid: 42, capturedAt: 1, elementId: 'A',
        elementRole: 'AXTextArea', insertable: true, kind: 'insertable', reason: null,
      };
      const platform = createStubDeliveryAdapter({
        clipboard: clip,
        insert,
        snapshot: async () => target,
        validate: async () => target,
      });
      const cleanupEngine = {
        acquire: vi.fn().mockResolvedValue(undefined),
        cancel: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockResolvedValue(undefined),
        run: vi.fn(() => new Promise<string>(() => {})),
      } satisfies CleanupEngine;
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => dogfoodTranscribeAndCopy({
        ...options,
        createEngine: (modelId) => ({
          ...createMockSttEngine({ modelId }),
          transcribe: () => new Promise((resolve) => {
            setTimeout(() => resolve({ language: 'en', text: 'raw words' }), 14_000);
          }),
        }),
      });
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 2_000, id: 'pcm-cleanup-margin', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        cleanupActive: true,
        cleanupEngine,
        cleanupModelId: CLEANUP_MODEL_ID,
        clipboard: clip,
        createModelStore: () => store,
        deliveryPlatform: platform,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      await advance(14_000);
      await flush();
      expect(cleanupEngine.run).toHaveBeenCalled();
      await advance(50);
      expect(result.current.phase).toBe('success');
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_SAVED);
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_PENDING);
      expect(insert).toHaveBeenCalledOnce();
      expect(insert).toHaveBeenCalledWith('raw words', expect.objectContaining({ elementId: 'A' }));
      expect(clip.copy).not.toHaveBeenCalled();
      await advance(STOP_BUDGET_MS);
      expect(insert).toHaveBeenCalledOnce();
      expect(history).toHaveBeenCalledOnce();
    });

    it('clears the cap timer on normal completion so a later tick does not retain again', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      const dogfood = vi.fn(async (): Promise<DogfoodResult> => ({
        copied: true,
        delivery: deliveryOutcome('copied', 'done quickly', 'Copied — test'),
        transcript: { language: 'en', text: 'done quickly' },
      }));
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 1_000, id: 'pcm-timer-cleared', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      expect(result.current.phase).toBe('success');
      expect(history).toHaveBeenCalledOnce();
      await advance(STOP_BUDGET_MS + 1_000);
      expect(history).toHaveBeenCalledOnce();
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_SAVED);
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_PENDING);
      expect(clip.copy).not.toHaveBeenCalled();
    });

    it('toasts when a pending late result fails and nothing was saved', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      let reject!: (error: Error) => void;
      const dogfood = vi.fn(() => new Promise<DogfoodResult>((_, no) => { reject = no; }));
      const toast = vi.fn();
      const history = vi.fn();
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 8_000, id: 'pcm-late-fail', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clipboard(),
        createModelStore: () => store,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
        onToast: toast,
      }));
      await flush();
      await advance(STOP_BUDGET_MS);
      expect(result.current.message).toBe(STOP_TAKING_LONGER_PENDING);
      await act(async () => { reject(new Error('native stt hung')); });
      await flush();
      expect(toast).toHaveBeenCalledWith(STOP_LATE_NOTHING_SAVED);
      expect(history).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('success');
      expect(result.current.message).toBe(STOP_TAKING_LONGER_PENDING);
    });

    it('does not copy or deliver twice when the cap fires during an in-flight insert', async () => {
      const store = createMockSttModelStore();
      await store.download('whisper-tiny.en');
      const clip = clipboard();
      const history = vi.fn();
      let finishInsert!: () => void;
      const insert = vi.fn(() => new Promise<void>((ok) => { finishInsert = ok; }));
      const target: TargetSnapshot = {
        appName: 'Notes', appPid: 42, capturedAt: 1, elementId: 'A',
        elementRole: 'AXTextArea', insertable: true, kind: 'insertable', reason: null,
      };
      const platform = createStubDeliveryAdapter({
        clipboard: clip,
        insert,
        snapshot: async () => target,
        validate: async () => target,
      });
      const dogfood: typeof dogfoodTranscribeAndCopy = (options) => dogfoodTranscribeAndCopy({
        ...options,
        createEngine: (modelId) => ({
          ...createMockSttEngine({ modelId }),
          transcribe: async () => ({ language: 'en', text: 'typed once' }),
        }),
      });
      const { result } = renderHook(() => useDogfoodCapture({
        captureApi: stubCapture({
          audio: { duration_ms: 2_000, id: 'pcm-cap-insert', sample_rate_hz: 16_000 },
          kind: 'stopped',
        }),
        clipboard: clip,
        createModelStore: () => store,
        deliveryPlatform: platform,
        dogfood,
        modelId: 'whisper-tiny.en',
        onHistoryRecord: history,
      }));
      await flush();
      expect(insert).toHaveBeenCalledOnce();
      await advance(STOP_BUDGET_MS);
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_SAVED);
      expect(result.current.message).not.toBe(STOP_TAKING_LONGER_PENDING);
      expect(insert).toHaveBeenCalledOnce();
      await act(async () => { finishInsert(); });
      await flush();
      expect(insert).toHaveBeenCalledOnce();
      expect(clip.copy).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('success');
      expect(history).toHaveBeenCalledOnce();
    });
  });

});
