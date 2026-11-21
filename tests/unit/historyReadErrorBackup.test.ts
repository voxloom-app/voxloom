import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryStore } from '../../src/services/history/store';
import { createTauriHistoryIo } from '../../src/services/history/tauriIo';
import { describeBackup, runBackup, tauriBackup } from '../../src/services/storeBackup';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));

beforeEach(() => { invoke.mockReset(); });

describe('history automatic read-error backup bridge', () => {
  it.each([
    'synthetic protected-key access failure',
    'History protected key is invalid; files preserved',
    'Cannot inventory history artifacts',
    'Cannot read history artifact; files preserved',
    'History authentication failed; files preserved; original protected key required',
  ])('does not retry protected IO or report a false backup failure after %s', async (message) => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'history_load') throw new Error(message);
      if (command === 'store_backup') return null;
      throw new Error(`unexpected command: ${command}`);
    });
    const store = createHistoryStore(createTauriHistoryIo());
    const loaded = await store.load('forever', 1);
    expect(invoke.mock.calls).toEqual([['history_load']]);
    expect(loaded).toEqual({
      ok: false,
      error: `Failed to read history store: ${message} (automatic backup skipped; file left untouched)`,
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

  it('keeps the legacy automatic null result distinct from backup success and real failures', async () => {
    invoke.mockResolvedValue(null);
    const skipped = await runBackup(tauriBackup('history'), { automaticReadError: true });
    expect(skipped).toEqual({ ok: false, skipped: true });
    expect(describeBackup(skipped)).toBe(' (automatic backup skipped; file left untouched)');
    expect(invoke).toHaveBeenCalledWith('store_backup', { store: 'history', automaticReadError: true });
    const explicit = await runBackup(tauriBackup('history'));
    expect(explicit).toEqual({ ok: false, error: 'no file was backed up' });
    expect(describeBackup(explicit)).toContain('backup failed');
    invoke.mockRejectedValue(new Error('Cannot inventory history artifacts'));
    const failed = await runBackup(tauriBackup('history'), { automaticReadError: true });
    expect(failed).toEqual({ ok: false, error: 'Cannot inventory history artifacts' });
    expect(describeBackup(failed)).toContain('backup failed');
  });

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
