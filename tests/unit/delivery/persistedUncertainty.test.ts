// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDogfoodRecord, canRetry } from '../../../src/domain/records';
import { createHistoryStore } from '../../../src/services/history/store';
import { dogfoodTranscribeAndCopy } from '../../../src/services/stt/dogfoodPath';
import { createMockSttEngine } from '../../../src/services/stt/mockStt';
import type { TargetSnapshot } from '../../../src/services/delivery/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
const { createTauriDeliveryAdapter } = await import('../../../src/services/delivery/tauriAdapter');
const completion: TargetSnapshot = {
  appName: 'Unlisted editor', appPid: 91, capturedAt: 3,
  elementId: null, elementRole: null, insertable: false, kind: 'unavailable',
  reason: 'AX focus missing', sharedPasteToken: 'retained-completion',
};

describe('real delivery → record → persisted History evidence', () => {
  it.each(['forever', 'off'] as const)('preserves uncertainty and explicit manual recovery with retention %s', async (retention) => {
    const clipboard = { copy: vi.fn().mockResolvedValue(undefined) };
    invoke.mockReset();
    invoke.mockImplementation(async (command) => {
      if (command === 'delivery_paste_target') throw new Error('IPC lost after possible dispatch');
      return completion;
    });
    const result = await dogfoodTranscribeAndCopy({
      audio: { duration_ms: 500, id: 'fixture-audio', sample_rate_hz: 16_000 },
      clipboard, deliveryPlatform: createTauriDeliveryAdapter(clipboard),
      createEngine: () => createMockSttEngine({ modelId: 'whisper-tiny.en', transcriptText: 'recoverable text' }),
      insertOwnField: () => false, modelId: 'whisper-tiny.en',
    });
    expect(result.delivery.status).toBe('unverified');
    expect(result.copied).toBe(false);
    expect(result.copyWarning).toBeUndefined();
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'delivery_snapshot_target', 'delivery_validate_target', 'delivery_paste_target',
    ]);
    const record = createDogfoodRecord({
      id: 'uncertain-fixture', now: 10, durationMs: 500, style: 'casual',
      text: result.transcript.text, status: result.delivery.status,
      mayHaveInserted: result.delivery.mayHaveInserted,
    });
    expect(record).toMatchObject({ status: 'unverified', mayHaveInserted: { copied: false } });
    expect(canRetry(record!, 11)).toBe(false);

    // Actual bytes on an isolated test file, reopened via the production store.
    const directory = await mkdtemp(join(tmpdir(), 'voxloom-delivery-history-'));
    const path = join(directory, 'history.json');
    const io = { read: () => readFile(path, 'utf8'), write: (data: string) => writeFile(path, data, 'utf8') };
    try {
      await createHistoryStore(io).save([record!], retention, 10);
      const raw = await readFile(path, 'utf8');
      const loaded = await createHistoryStore(io).load(retention, 11);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error(loaded.error);
      if (retention === 'forever') {
        expect(loaded.records).toEqual([record]);
        expect(raw).toContain('"status": "unverified"');
        expect(raw).toContain('"copied": false');
      } else {
        expect(loaded.records).toEqual([]);
        expect(raw).not.toContain(result.transcript.text);
        expect(result.delivery.text).toBe(result.transcript.text);
      }
      // Only the user's explicit recovery action performs a Copy, exactly once.
      await clipboard.copy(result.delivery.text);
      expect(clipboard.copy).toHaveBeenCalledExactlyOnceWith(result.transcript.text);
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
