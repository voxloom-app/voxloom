import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseHistoryJson } from '../../src/services/history/format';
import { createHistoryStore } from '../../src/services/history/store';

// Produced by the native Store with a synthetic [7; 32] key. The native test
// verifies it decrypts byte-exactly to the existing history-v2.json fixture.
const envelope = readFileSync('tests/fixtures/history-encrypted-v1.json', 'utf8');

describe('native encrypted history envelope compatibility', () => {
  it('cannot be mistaken for an empty legacy plaintext history document', () => {
    const outer = JSON.parse(envelope) as Record<string, unknown>;
    expect(outer).not.toHaveProperty('version');
    expect(outer).not.toHaveProperty('records');
    expect(parseHistoryJson(envelope).ok).toBe(false);
  });

  it('keeps the existing read-error gate even after a preservation backup', async () => {
    const backup = vi.fn().mockResolvedValue('history.json.unreadable-1.bak');
    const write = vi.fn();
    const store = createHistoryStore({ backup, read: async () => envelope, write });
    const loaded = await store.load('off', Date.now());
    expect(loaded.ok).toBe(false);
    expect(backup).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });
});
