import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryStore } from '../../src/services/history/store';
import { createTauriHistoryIo } from '../../src/services/history/tauriIo';
import { tauriBackup } from '../../src/services/storeBackup';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));

beforeEach(() => { invoke.mockReset(); });

describe('history automatic read-error backup bridge', () => {
  it('marks only automatic read failures and keeps a skipped backup write-blocked', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'history_load') throw new Error('synthetic protected-key access failure');
      if (command === 'store_backup') return null;
      throw new Error(`unexpected command: ${command}`);
    });
    const store = createHistoryStore(createTauriHistoryIo());
    const loaded = await store.load('forever', 1);
    expect(invoke.mock.calls).toEqual([
      ['history_load'],
      ['store_backup', { store: 'history', automaticReadError: true }],
    ]);
    expect(loaded).toEqual({
      ok: false,
      error: 'Failed to read history store: synthetic protected-key access failure (backup failed: no file was backed up; file left untouched)',
    });
    expect(invoke.mock.calls.some(([command]) => command === 'history_save')).toBe(false);
  });

  it.each(['{corrupt', '{"version":99,"records":[]}', '{"version":1,"records":[]}'])(
    'keeps parse-error and migration backups explicit for %s', async (raw) => {
      invoke.mockImplementation(async (command: string) => command === 'history_load' ? raw : 'synthetic-backup');
      const loaded = await createHistoryStore(createTauriHistoryIo()).load('forever', 1);
      expect(invoke).toHaveBeenCalledWith('store_backup', { store: 'history' });
      expect(invoke.mock.calls).toHaveLength(2);
      expect(loaded.ok).toBe(raw.includes('"version":1,'));
    },
  );

  it('retains omitted-context semantics for explicit/prune and other store backups', async () => {
    invoke.mockResolvedValue('synthetic-backup');
    expect(await createHistoryStore(createTauriHistoryIo()).backup?.()).toBe('saved');
    await tauriBackup('settings')();
    await tauriBackup('dictionary')();
    expect(invoke.mock.calls).toEqual([
      ['store_backup', { store: 'history' }],
      ['store_backup', { store: 'settings' }],
      ['store_backup', { store: 'dictionary' }],
    ]);
  });
});
