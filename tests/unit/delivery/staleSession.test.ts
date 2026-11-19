// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dogfoodTranscribeAndCopy } from '../../../src/services/stt/dogfoodPath';
import { createMockSttEngine } from '../../../src/services/stt/mockStt';
import type { TargetSnapshot } from '../../../src/services/delivery/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
const { createTauriDeliveryAdapter } = await import('../../../src/services/delivery/tauriAdapter');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const completion: TargetSnapshot = {
  appName: 'Editor', appPid: 91, capturedAt: 3, elementId: null, elementRole: null,
  insertable: false, kind: 'unsupported', reason: 'no AX field', sharedPasteToken: 'native-C',
};
const stages = ['delivery_snapshot_target', 'delivery_validate_target', 'delivery_paste_target'] as const;

describe('stale sessions across real adapter and orchestration awaits', () => {
  it.each(['verified', 'unverified', 'terminal', 'safe-reject', 'unknown-reject', 'malformed'] as const)(
    'keeps native AX dispatch facts after supersession: %s, never automatic Copy', async (settle) => {
      invoke.mockReset();
      const clipboard = { copy: vi.fn().mockResolvedValue(undefined) };
      const intended = { ...completion, sharedPasteToken: null, insertable: true, kind: 'insertable' as const };
      const gate = deferred<unknown>();
      const entered = deferred<void>();
      let current = true;
      invoke.mockImplementation(async (command) => {
        if (command === 'delivery_insert_text') { entered.resolve(); return gate.promise; }
        return intended;
      });
      const pending = dogfoodTranscribeAndCopy({
        audio: { duration_ms: 500, id: 'fixture-audio', sample_rate_hz: 16_000 },
        clipboard, deliveryPlatform: createTauriDeliveryAdapter(clipboard),
        createEngine: () => createMockSttEngine({ modelId: 'whisper-tiny.en' }),
        insertOwnField: () => false, modelId: 'whisper-tiny.en', isCurrent: () => current,
      });
      await entered.promise;
      current = false;
      if (settle === 'safe-reject') gate.reject('delivery-safe-refusal: retired');
      else if (settle === 'unknown-reject') gate.reject('unknown error');
      else if (settle === 'malformed') gate.resolve(null);
      else gate.resolve({
        typed: settle === 'terminal', unverified: settle !== 'verified', detail: null,
        ...(settle === 'terminal' ? { terminalDispatch: 'partial' } : {}),
      });
      const result = await pending;
      expect(result.delivery.status).toBe(settle === 'verified' ? 'inserted' : settle === 'safe-reject' ? 'failed' : 'unverified');
      expect(clipboard.copy).not.toHaveBeenCalled();
      expect(invoke.mock.calls.map(([command]) => command)).toEqual([
        'delivery_snapshot_target', 'delivery_validate_target', 'delivery_insert_text',
      ]);
    },
  );

  it.each(stages.flatMap((stage) => ['resolve', 'safe-reject', 'unknown-reject'].map((settle) => ({ stage, settle }))))(
    '$stage $settle never dispatches a later transport or automatic Copy', async ({ stage, settle }) => {
      invoke.mockReset();
      const clipboard = { copy: vi.fn().mockResolvedValue(undefined) };
      const gate = deferred<unknown>();
      const entered = deferred<void>();
      let current = true;
      invoke.mockImplementation(async (command) => {
        if (command === stage) { entered.resolve(); return gate.promise; }
        return completion;
      });
      const pending = dogfoodTranscribeAndCopy({
        audio: { duration_ms: 500, id: 'fixture-audio', sample_rate_hz: 16_000 },
        clipboard, deliveryPlatform: createTauriDeliveryAdapter(clipboard),
        createEngine: () => createMockSttEngine({ modelId: 'whisper-tiny.en' }),
        insertOwnField: () => false, modelId: 'whisper-tiny.en', isCurrent: () => current,
      });
      await entered.promise;
      current = false;
      if (settle === 'resolve') gate.resolve(stage === 'delivery_paste_target'
        ? { clipboardRestored: true, restoreSkippedReason: null } : completion);
      else gate.reject(settle === 'safe-reject' ? 'delivery-safe-refusal: superseded' : new Error('IPC lost'));
      const result = await pending;
      const expectedCommands = stages.slice(0, stages.indexOf(stage) + 1);
      expect(invoke.mock.calls.map(([command]) => command)).toEqual(expectedCommands);
      expect(clipboard.copy).not.toHaveBeenCalled();
      if (stage === 'delivery_paste_target' && settle !== 'safe-reject') {
        expect(result.delivery.status).toBe('unverified');
        if (settle === 'unknown-reject') expect(result.delivery.mayHaveInserted).toBe(true);
      } else {
        expect(result.delivery.status).toBe('failed');
        expect(result.delivery.message).toContain('cancelled or superseded');
      }
    },
  );
});
