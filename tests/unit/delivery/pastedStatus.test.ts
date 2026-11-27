// A clean posted paste (clipboard + ⌘V, prior clipboard restored) is the
// normal success path since #195. It is recorded "pasted", not
// "unverified": posting is still not an insertion receipt, but History
// should not warn on every ordinary dictation. Unverified stays for genuine
// uncertainty.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDogfoodRecord } from '../../../src/domain/records';
import { statusLabel } from '../../../src/services/delivery/messages';
import { pastedOutcome } from '../../../src/services/delivery/paste';
import { hudResultFor } from '../../../src/services/stt/dogfoodPhase';
import { parseHistoryJson, serializeHistoryFile } from '../../../src/services/history';

const clean = { clipboardRestored: true, restoreSkippedReason: null } as const;

function record(status: 'pasted' | 'unverified', mayHaveInserted?: boolean) {
  const row = createDogfoodRecord({
    durationMs: 1_000, id: 'r', mayHaveInserted, now: 1, status,
    style: 'formal', text: 'hello',
  });
  if (!row) throw new Error('expected a record');
  return row;
}

describe('clean posted paste', () => {
  it('is Pasted, silent, and never a HUD result', () => {
    const outcome = pastedOutcome('hello', clean);
    expect(outcome).toMatchObject({ message: '', status: 'pasted' });
    expect(outcome.mayHaveInserted).toBeUndefined();
    expect(statusLabel(outcome.status)).toBe('Pasted');
    expect(hudResultFor(outcome)).toBeNull();
  });

  it('keeps a paste whose clipboard was not restored Unverified', () => {
    const outcome = pastedOutcome('hello', {
      clipboardRestored: false, restoreSkippedReason: 'clipboard changed',
    });
    expect(outcome.status).toBe('unverified');
    expect(outcome.message).toBe('Paste sent (clipboard not restored: clipboard changed)');
  });

  it('records a Pasted History row without the uncertainty flag', () => {
    const row = record('pasted');
    expect(row.status).toBe('pasted');
    expect(row.mayHaveInserted).toBeUndefined();
  });

  it('lets may-have-inserted override Pasted to Unverified', () => {
    expect(record('pasted', true)).toMatchObject({
      mayHaveInserted: { copied: false }, status: 'unverified',
    });
  });
});

describe('persisted History rows', () => {
  it('round-trips a Pasted row', () => {
    const row = record('pasted');
    const parsed = parseHistoryJson(serializeHistoryFile([row]));
    expect(parsed).toMatchObject({ ok: true, file: { records: [{ id: 'r', status: 'pasted' }] } });
  });

  it('keeps legacy Unverified rows Unverified, flagged or not', () => {
    // Before this change a clean paste and an Apple Terminal Unicode dispatch
    // were both stored as unflagged "unverified"; nothing on the row tells
    // them apart, so neither is relabeled.
    const legacy = record('unverified');
    const parsed = parseHistoryJson(serializeHistoryFile([legacy]));
    expect(parsed).toMatchObject({ ok: true, file: { records: [{ status: 'unverified' }] } });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.file.records[0].mayHaveInserted).toBeUndefined();

    const v1 = readFileSync(join(__dirname, '../../fixtures/history-v1.json'), 'utf8');
    const old = parseHistoryJson(v1);
    if (!old.ok) throw new Error(old.error);
    expect(old.file.records.find((r) => r.id === 'v1-unverified'))
      .toMatchObject({ mayHaveInserted: { copied: true }, status: 'unverified' });
    expect(old.file.records.some((r) => r.status === 'pasted')).toBe(false);
  });
});
