// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverTranscript } from '../../../src/services/delivery/deliver';
import { InsertError } from '../../../src/services/delivery/types';
import type { TargetSnapshot } from '../../../src/services/delivery/types';
import { toastTone } from '../../../src/components/Toast';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
const { createTauriDeliveryAdapter } = await import('../../../src/services/delivery/tauriAdapter');
const bound = { appPid: 91, pasteApp: '/fixture/editor.app' };
const ax: TargetSnapshot = {
  appName: 'Editor', appPid: 91, capturedAt: 3, elementId: 'E1', elementRole: 'AXTextArea',
  insertable: true, kind: 'insertable', reason: null,
};
const clipboard = { copy: vi.fn().mockResolvedValue(undefined) };
const routes = ['insert', 'legacy-paste', 'shared-paste'] as const;
type Route = typeof routes[number];
function intendedFor(route: Route): TargetSnapshot {
  if (route === 'insert') return ax;
  return { ...ax, insertable: false, kind: 'unsupported',
    ...(route === 'shared-paste' ? { sharedPasteToken: 'native-C' }
      : { pasteTerminal: true, pasteApp: bound.pasteApp }),
  };
}
function run(route: Route, response: () => Promise<unknown>, clipboardFallback = true) {
  const intended = intendedFor(route);
  invoke.mockImplementation((command) => command === 'delivery_validate_target'
    ? Promise.resolve(intended) : response());
  return deliverTranscript({
    intended, clipboardFallback, platform: createTauriDeliveryAdapter(clipboard),
    pasteBinding: bound, text: 'recoverable transcript',
  });
}
beforeEach(() => { invoke.mockReset(); clipboard.copy.mockClear(); });

describe.each(routes)('%s invocation uncertainty', (route) => {
  it.each([
    ['unknown native string', 'AX failed'],
    ['prefix is not at start', 'wrapped delivery-safe-refusal: refused'],
    ['structured lookalike', { message: 'delivery-safe-refusal: refused' }],
    ['non-stringifiable IPC object', { toString: null }],
    ['IPC loss', new Error('channel closed')],
    ['null rejection', null],
  ])('never auto Copies or retries after %s', async (_, error) => {
    const result = await run(route, () => Promise.reject(error));
    expect(result.status).toBe('unverified');
    expect(result.mayHaveInserted).toBe(true);
    expect(result.message).toContain('Inspect before retrying');
    expect(result.message).toContain('manual Copy');
    expect(toastTone(result.message)).toBe('warn');
    expect(result.message).not.toContain('Terminal');
    expect(result.text).toBe('recoverable transcript');
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('only the exact safe-refusal prefix allows current-session Copy', async () => {
    const result = await run(route, () => Promise.reject('delivery-safe-refusal: target changed'));
    expect(result.status).toBe('copied');
    expect(result.mayHaveInserted).toBeUndefined();
    expect(clipboard.copy).toHaveBeenCalledExactlyOnceWith('recoverable transcript');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('native insert with Clipboard fallback off', () => {
  it('keeps IPC loss unverified with manual recovery', async () => {
    const result = await run('insert', () => Promise.reject('unknown'), false);
    expect(result.status).toBe('unverified');
    expect(result.mayHaveInserted).toBe(true);
    expect(clipboard.copy).not.toHaveBeenCalled();
  });

  it('does not copy an explicitly safe refusal', async () => {
    const result = await run('insert', () => Promise.reject('delivery-safe-refusal: no write'), false);
    expect(result.status).toBe('failed');
    expect(result.mayHaveInserted).toBeUndefined();
    expect(clipboard.copy).not.toHaveBeenCalled();
  });
});

describe.each(routes)('%s bridge error evidence', (route) => {
  it.each(['not a tagged refusal', { toString: null }])('unknown rejection %s is an InsertError with writeStarted true', async (error) => {
    invoke.mockRejectedValue(error);
    const platform = createTauriDeliveryAdapter(clipboard);
    const pending = route === 'insert' ? platform.insertText('hi', ax)
      : route === 'shared-paste' ? platform.pasteTarget!('hi', intendedFor(route))
      : platform.pasteText!('hi', bound);
    await expect(pending).rejects.toMatchObject({ name: 'InsertError', writeStarted: true });
    await pending.catch((error) => expect(error).toBeInstanceOf(InsertError));
  });
});

describe.each(routes)('%s non-native adapter evidence', (route) => {
  it.each(['reject', 'object-reject', 'malformed'] as const)('does not trust a %s after the adapter was called', async (mode) => {
    const intended = intendedFor(route);
    const platform = createTauriDeliveryAdapter(clipboard);
    platform.validateTarget = vi.fn().mockResolvedValue(intended);
    const dispatch = vi.fn(() => mode === 'malformed' ? Promise.resolve({})
      : Promise.reject(mode === 'object-reject' ? { toString: null } : new Error('unknown mutation')));
    if (route === 'insert') platform.insertText = dispatch as never;
    else if (route === 'legacy-paste') platform.pasteText = dispatch as never;
    else platform.pasteTarget = dispatch as never;
    const result = await deliverTranscript({ platform, intended, pasteBinding: bound, clipboardFallback: true, text: 'recoverable' });
    expect(result.status).toBe('unverified');
    expect(result.mayHaveInserted).toBe(true);
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

describe('native AX and Terminal report compatibility', () => {
  it.each([true, false])('preserves verified AX/web success with fallback %s', async (clipboardFallback) => {
    for (const typed of [false, true]) {
      const result = await run('insert', () => Promise.resolve({ typed, unverified: false, detail: null }), clipboardFallback);
      expect(result.status).toBe('inserted');
      expect(clipboard.copy).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])('preserves possible AX mutation without Copy with fallback %s', async (clipboardFallback) => {
    const result = await run('insert', () => Promise.resolve({ typed: false, unverified: true, detail: 'read-back unknown' }), clipboardFallback);
    expect(result.status).toBe('unverified');
    expect(result.mayHaveInserted).toBe(true);
    expect(toastTone(result.message)).toBe('warn');
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each(['complete', 'partial'] as const)('keeps Terminal %s dispatch unverified with no clipboard fallback', async (terminalDispatch) => {
    const result = await run('insert', () => Promise.resolve({ typed: true, unverified: true, detail: null, terminalDispatch }));
    expect(result.status).toBe('unverified');
    expect(result.message).toContain('to Terminal');
    expect(result.message).toContain('Inspect before retrying');
    expect(clipboard.copy).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

const malformedInsert = [
  null, undefined, {}, [], 'ok',
  { typed: false, unverified: false },
  { typed: 'false', unverified: false, detail: null },
  { typed: false, unverified: 'false', detail: null },
  { typed: false, unverified: false, detail: {} },
  { typed: true, unverified: false, detail: null, terminalDispatch: 'complete' },
  { typed: false, unverified: true, detail: null, terminalDispatch: 'partial' },
  { typed: true, unverified: true, detail: null, terminalDispatch: 'unknown' },
  { typed: false, unverified: false, detail: null, terminalDispatch: null },
];
const malformedPaste = [
  null, undefined, {}, [], 'ok',
  { clipboardRestored: true },
  { clipboardRestored: 'true', restoreSkippedReason: null },
  { clipboardRestored: false, restoreSkippedReason: {} },
  { clipboardRestored: true, restoreSkippedReason: 'restore failed' },
];

describe.each(routes)('%s malformed native reply', (route) => {
  const replies = route === 'insert' ? malformedInsert : malformedPaste;
  it.each(replies.map((reply, index) => ({ reply, index })))(
    'reply $index remains uncertainty, never Inserted or auto Copy', async ({ reply }) => {
      const result = await run(route, () => Promise.resolve(reply));
      expect(result.status).toBe('unverified');
      expect(result.mayHaveInserted).toBe(true);
      expect(result.message).toContain('Inspect before retrying');
      expect(clipboard.copy).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );
});
