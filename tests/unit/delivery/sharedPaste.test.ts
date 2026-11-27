// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverTranscript } from '../../../src/services/delivery/deliver';
import type { TargetSnapshot } from '../../../src/services/delivery/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
const { createTauriDeliveryAdapter } = await import('../../../src/services/delivery/tauriAdapter');

function target(overrides: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    appName: 'Unlisted editor', appPid: 91, capturedAt: 3,
    elementId: null, elementRole: null, insertable: false, kind: 'unsupported',
    reason: 'no editable AX field', sharedPasteToken: 'completion-window-C',
    ...overrides,
  } as TargetSnapshot;
}
const cleanPaste = { clipboardRestored: true, restoreSkippedReason: null };
const clipboard = { copy: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => { invoke.mockReset(); clipboard.copy.mockClear(); });

describe('native completion shared paste through adapter and orchestration', () => {
  it('an empty capability cannot borrow legacy paste flags', async () => {
    const intended = target({ sharedPasteToken: '', pasteTerminal: true, pasteApp: '/fixture/editor.app' });
    invoke.mockResolvedValue(intended);
    await deliverTranscript({
      platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'recover',
      pasteBinding: { appPid: 91, pasteApp: '/fixture/editor.app' },
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
  });

  it('never borrows legacy authorization when the completion token is revoked', async () => {
    const intended = target({ pasteTerminal: true, pasteApp: '/fixture/editor.app' });
    invoke.mockResolvedValue({ ...intended, sharedPasteToken: null });
    await deliverTranscript({
      platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'recover',
      pasteBinding: { appPid: 91, pasteApp: '/fixture/editor.app' },
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
  });

  it.each(['secure', 'changed', 'closed'] as const)('never shared-pastes when validation says %s', async (kind) => {
    const intended = target();
    invoke.mockResolvedValue({ ...intended, kind });
    await deliverTranscript({ platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'recover' });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
  });

  it.each([null, '', 'different-token'])(
    'never shared-pastes with missing, empty or changed token %s', async (sharedPasteToken) => {
      const intended = target();
      invoke.mockResolvedValue({ ...intended, sharedPasteToken });
      await deliverTranscript({ platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'recover' });
      expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
    },
  );

  it('Clipboard fallback off preserves the existing AX route even with a paste token', async () => {
    const intended = target({ insertable: true, kind: 'insertable' });
    invoke.mockImplementation(async (command) => command === 'delivery_validate_target' ? intended : { typed: false, unverified: false, detail: null });
    const outcome = await deliverTranscript({ platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: false, text: 'AX' });
    expect(outcome.status).toBe('inserted');
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target', 'delivery_insert_text']);
    expect(clipboard.copy).not.toHaveBeenCalled();
  });

  it.each([
    null, {},
    { kind: 'unsupported', insertable: false, sharedPasteToken: 'completion-window-C' },
    { ...target(), insertable: true },
    { ...target(), appPid: '91' },
    { ...target(), pasteTerminal: 'true' },
    { ...target(), sharedPasteToken: 42 },
  ])('malformed validation reply %j revokes every capability before policy', async (reply) => {
    const intended = target();
    invoke.mockResolvedValue(reply);
    const platform = createTauriDeliveryAdapter(clipboard);
    const validated = await platform.validateTarget(intended);
    expect(validated).toMatchObject({ sharedPasteToken: null, pasteTerminal: false, pasteApp: null, insertable: false, kind: 'unavailable' });
    invoke.mockClear();
    await deliverTranscript({ platform, intended, clipboardFallback: true, text: 'recover' });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
  });

  it('revokes the shared token and all legacy paste flags when native validation throws', async () => {
    const intended = target({ pasteTerminal: true, pasteApp: '/fixture/editor.app' });
    invoke.mockRejectedValue(new Error('validation IPC lost'));
    const platform = createTauriDeliveryAdapter(clipboard);
    const validated = await platform.validateTarget(intended);
    expect(validated).toMatchObject({
      sharedPasteToken: null, pasteTerminal: false, pasteApp: null,
      insertable: false, kind: 'unavailable',
    });
    invoke.mockClear();
    await deliverTranscript({
      platform, intended, clipboardFallback: true, text: 'recover',
      pasteBinding: { appPid: 91, pasteApp: '/fixture/editor.app' },
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(['delivery_validate_target']);
  });

  it.each([new Error('validation failed'), { toString: null }])('also revokes legacy authority if a non-Tauri adapter validation throws %s', async (error) => {
    const intended = target({ pasteTerminal: true, pasteApp: '/fixture/editor.app' });
    const platform = {
      ...createTauriDeliveryAdapter(clipboard),
      validateTarget: vi.fn().mockRejectedValue(error),
    };
    await deliverTranscript({
      platform, intended, clipboardFallback: true, text: 'recover',
      pasteBinding: { appPid: 91, pasteApp: '/fixture/editor.app' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'unavailable', 'insertable'] as const)(
    'uses the completion token with honest AX kind %s, not the recording-start app', async (kind) => {
      const completion = target({ kind, insertable: kind === 'insertable' });
      invoke.mockImplementation(async (command) => command === 'delivery_paste_target' ? cleanPaste : completion);
      const platform = createTauriDeliveryAdapter(clipboard);
      const intended = await platform.snapshotTarget();
      const result = await deliverTranscript({
        platform, intended, clipboardFallback: true, text: 'café 日本語 🙂\nsecond line',
        pasteBinding: { appPid: 7, pasteApp: '/fixture/recording-start.app' },
      });
      expect(invoke.mock.calls.map(([command]) => command)).toEqual([
        'delivery_snapshot_target', 'delivery_validate_target', 'delivery_paste_target',
      ]);
      expect(invoke).toHaveBeenLastCalledWith('delivery_paste_target', { text: result.text, intended });
      expect(intended.kind).toBe(kind);
      expect(result).toMatchObject({ status: 'pasted', message: '', clipboardRestored: true });
      expect(clipboard.copy).not.toHaveBeenCalled();
    },
  );
});

describe('clipboard refusals on the shared route dispatch nothing', () => {
  const unsaved = 'delivery-safe-refusal:clipboard-unsaved:prior clipboard could not be saved';
  const changed = 'delivery-safe-refusal:clipboard-changed:clipboard changed during snapshot — paste skipped';
  const editable = () => target({ insertable: true, kind: 'insertable', elementRole: 'AXTextField' });
  const axRefused = async () => { throw 'delivery-safe-refusal:AX set failed'; };

  function native(pasteError: string, completion: TargetSnapshot, insert: () => Promise<unknown>) {
    invoke.mockImplementation(async (command) => {
      if (command === 'delivery_paste_target') throw pasteError;
      if (command === 'delivery_insert_text') return insert();
      return completion;
    });
  }
  const deliver = (intended: TargetSnapshot) => deliverTranscript({
    platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'hello',
  });
  const commands = () => invoke.mock.calls.map(([command]) => command);

  it.each([unsaved, changed])('an editable field still gets the AX insert, clipboard untouched (%s)', async (error) => {
    const intended = editable();
    native(error, intended, async () => ({ typed: false, unverified: false, detail: null }));
    const outcome = await deliver(intended);
    expect(commands()).toEqual(['delivery_validate_target', 'delivery_paste_target', 'delivery_insert_text']);
    expect(outcome.status).toBe('inserted');
    expect(clipboard.copy).not.toHaveBeenCalled();
  });

  it('a refused AX insert after an unsaved clipboard copies, as on the insert route', async () => {
    const intended = editable();
    native(unsaved, intended, axRefused);
    const outcome = await deliver(intended);
    expect(outcome.status).toBe('copied');
    expect(clipboard.copy).toHaveBeenCalledWith('hello');
  });

  it('an unsaved clipboard without an editable field copies, as before shared paste', async () => {
    native(unsaved, target(), axRefused);
    const outcome = await deliver(target());
    expect(commands()).toEqual(['delivery_validate_target', 'delivery_paste_target']);
    expect(outcome.status).toBe('copied');
    expect(clipboard.copy).toHaveBeenCalledWith('hello');
  });

  it.each([
    ['editable', editable()],
    ['non-editable', target()],
  ] as const)('never copies over a newer clipboard (%s)', async (_, intended) => {
    native(changed, intended, axRefused);
    const outcome = await deliver(intended);
    expect(outcome.status).toBe('failed');
    expect(outcome.mayHaveInserted).toBeUndefined();
    expect(clipboard.copy).not.toHaveBeenCalled();
  });

  it('a may-have-inserted AX failure after a clipboard refusal stays uncertain', async () => {
    const intended = editable();
    native(unsaved, intended, async () => { throw 'AX write raced'; });
    const outcome = await deliver(intended);
    expect(outcome).toMatchObject({ status: 'unverified', mayHaveInserted: true });
    expect(clipboard.copy).not.toHaveBeenCalled();
  });
});

describe('Copy after a refused shared paste', () => {
  const secure = 'delivery-safe-refusal:Secure Keyboard Entry is on — paste skipped';
  async function copied(intended: TargetSnapshot) {
    invoke.mockImplementation(async (command) => {
      if (command === 'delivery_paste_target') throw secure;
      return intended;
    });
    return deliverTranscript({
      platform: createTauriDeliveryAdapter(clipboard), intended, clipboardFallback: true, text: 'hello',
    });
  }

  it('gives a known terminal the ⌘V hint, as the Copy route does', async () => {
    const outcome = await copied(target({ knownTerminal: true }));
    expect(outcome).toMatchObject({ status: 'copied', message: 'Copied. Press ⌘V to paste.' });
  });

  it('says why elsewhere, without the native protocol tag', async () => {
    const outcome = await copied(target());
    expect(outcome.status).toBe('copied');
    expect(outcome.message).toBe('Copied — paste skipped: Secure Keyboard Entry is on — paste skipped');
  });
});
