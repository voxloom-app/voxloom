import { StrictMode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../../src/app/AppContext';
import type { DictationRecord } from '../../src/domain/types';
import {
  createHistoryStore,
  createMemoryHistoryIo,
  serializeHistoryFile,
  type HistoryStore,
} from '../../src/services/history';

const NOW = 1_800_000_000_000;
const clock = () => NOW;
const row = (id: string): DictationRecord => ({
  createdAt: NOW,
  durationSeconds: 1,
  id,
  model: null,
  recoveryExpiresAt: null,
  status: 'copied',
  style: 'formal',
  text: `synthetic ${id}`,
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, reject, resolve };
}

// Deliberately accepts overlapping calls and commits only when released, like
// independently scheduled native workers. No ordering is supplied by this store.
function controlledHistory(records = [row('a'), row('b'), row('c')]) {
  const io = createMemoryHistoryIo(serializeHistoryFile(records));
  const durable = createHistoryStore(io);
  const calls: {
    ids: string[];
    retention: Parameters<HistoryStore['save']>[1];
    succeed: () => Promise<void>;
    fail: (message: string) => Promise<void>;
  }[] = [];
  let active = 0;
  let maxActive = 0;
  const store: HistoryStore = {
    load: vi.fn(durable.load),
    save: vi.fn(async (...[snapshot, retention, now]: Parameters<HistoryStore['save']>) => {
      const gate = deferred();
      active += 1;
      maxActive = Math.max(maxActive, active);
      const committed = gate.promise.then(() => durable.save(snapshot, retention, now));
      calls.push({
        fail: async (message) => {
          gate.reject(new Error(message));
          await committed.catch(() => {});
        },
        ids: snapshot.map(({ id }) => id),
        retention,
        succeed: async () => {
          gate.resolve();
          await committed;
        },
      });
      try {
        await committed;
      } finally {
        active -= 1;
      }
    }),
  };
  return { calls, maxActive: () => maxActive, store };
}

type Api = ReturnType<typeof useApp>;
function mount(store: HistoryStore, strict = false) {
  let api!: Api;
  function Probe() {
    api = useApp();
    return null;
  }
  const provider = (persistence: { enabled: boolean; store: HistoryStore }) => (
    <AppProvider clock={clock} historyPersistence={persistence}>
      <Probe />
    </AppProvider>
  );
  const renderProvider = (persistence: { enabled: boolean; store: HistoryStore }) => {
    const element = provider(persistence);
    return strict ? <StrictMode>{element}</StrictMode> : element;
  };
  const view = render(renderProvider({ enabled: true, store }));
  return {
    ...view,
    api: () => api,
    replace: (next: HistoryStore, enabled = true) => view.rerender(renderProvider({ enabled, store: next })),
  };
}

async function diskIds(store: HistoryStore) {
  const loaded = await store.load('forever', NOW);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.records.map(({ id }) => id);
}

describe('AppProvider history save ordering', () => {
  it('an older held save cannot resurrect multiple rapidly deleted rows', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(view.api().bootReady).toBe(true));
    expect(h.calls).toHaveLength(1);

    act(() => view.api().history.delete('a'));
    act(() => view.api().history.delete('b'));
    expect(view.api().state.records.map(({ id }) => id)).toEqual(['c']);

    // Broken provider permits newer commits before the old write is released.
    // Fixed provider has nothing to release yet: only one save may be active.
    for (const call of h.calls.slice(1)) await act(() => call.succeed());
    await act(() => h.calls[0].succeed());
    for (const call of h.calls.slice(1)) await act(() => call.succeed());

    expect(await diskIds(h.store)).toEqual(['c']);
    expect(h.maxActive()).toBe(1);
    expect(h.calls.map(({ ids }) => ids)).toEqual([['a', 'b', 'c'], ['c']]);
  });

  it('record completion followed by deletion persists only the newest snapshot', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().dispatch({ record: row('new'), type: 'append-record' }));
    act(() => view.api().history.delete('a'));
    expect(h.calls).toHaveLength(1);
    await act(() => h.calls[0].succeed());
    expect(h.calls[1].ids).toEqual(['new', 'b', 'c']);
    await act(() => h.calls[1].succeed());
    expect(await diskIds(h.store)).toEqual(['new', 'b', 'c']);
    expect(h.maxActive()).toBe(1);
  });

  it('retention Off waits for an older save then leaves no durable records', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().dispatch({ record: row('new'), type: 'append-record' }));
    act(() => view.api().settings.update({ key: 'transcriptRetention', value: 'off' }));
    // If writes overlap, allow Off to commit first, then release the older
    // snapshot: that schedule must still end with empty durable history.
    for (const call of h.calls.slice(1)) await act(() => call.succeed());
    await act(() => h.calls[0].succeed());
    for (const call of h.calls.slice(1)) await act(() => call.succeed());
    expect(await diskIds(h.store)).toEqual([]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].retention).toBe('off');
    expect(view.api().state.records.map(({ id }) => id)).toEqual(['new', 'a', 'b', 'c']);
    expect(h.maxActive()).toBe(1);
  });

  it('a rejected save does not poison later writes or automatically retry', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    await act(() => h.calls[0].fail('first write failed'));
    expect(view.api().state.historyError).toBe('Failed to save history: first write failed');
    expect(h.calls).toHaveLength(1);
    act(() => view.api().history.delete('a'));
    await waitFor(() => expect(h.calls).toHaveLength(2));
    expect(view.api().state.historyError).toBe('Failed to save history: first write failed');
    await act(() => h.calls[1].succeed());
    expect(view.api().state.historyError).toBeNull();
    expect(await diskIds(h.store)).toEqual(['b', 'c']);
    expect(h.maxActive()).toBe(1);
  });

  it('a rejected issued save drains only the newest pending request after settling', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().history.delete('a'));
    act(() => view.api().history.delete('b'));
    expect(h.calls).toHaveLength(1);
    await act(() => h.calls[0].fail('uncertain issued write'));
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].ids).toEqual(['c']);
    await act(() => h.calls[1].fail('latest write failed'));
    expect(view.api().state.historyError).toBe('Failed to save history: latest write failed');
    act(() => view.api().history.delete('c'));
    await waitFor(() => expect(h.calls).toHaveLength(3));
    await act(() => h.calls[2].succeed());
    expect(view.api().state.historyError).toBeNull();
    expect(await diskIds(h.store)).toEqual([]);
    expect(h.maxActive()).toBe(1);
  });

  it('an obsolete successful snapshot cannot clear an error owned by a newer pending request', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().history.delete('a'));
    act(() => view.api().dispatch({ message: 'newer history error', type: 'set-history-error' }));
    await act(() => h.calls[0].succeed());
    expect(view.api().state.historyError).toBe('newer history error');
    await act(() => h.calls[1].fail('newest failure'));
    expect(view.api().state.historyError).toBe('Failed to save history: newest failure');
  });

  it.each([false, true])('reset while saving preserves the existing wipe=%s policy', async (wipeHistory) => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().dispatch({ record: row('new'), type: 'append-record' }));
    act(() => view.api().dispatch({ now: NOW, persistHistory: true, type: 'reset', wipeHistory }));
    const expected = wipeHistory ? [] : ['new', 'a', 'b', 'c'];
    expect(view.api().state.records.map(({ id }) => id)).toEqual(expected);
    await act(() => h.calls[0].succeed());
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].ids).toEqual(expected);
    await act(() => h.calls[1].succeed());
    expect(await diskIds(h.store)).toEqual(expected);
    expect(h.maxActive()).toBe(1);
  });

  it.each(['success', 'failure'])('unmount drops pending writes while an issued write settles with %s', async (outcome) => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().history.delete('a'));
    view.unmount();
    await act(() => outcome === 'success' ? h.calls[0].succeed() : h.calls[0].fail('unmounted'));
    expect(h.calls).toHaveLength(1);
  });

  it('disabling persistence drops pending writes without racing an issued write', async () => {
    const h = controlledHistory();
    const view = mount(h.store);
    await waitFor(() => expect(h.calls).toHaveLength(1));
    act(() => view.api().history.delete('a'));
    view.replace(h.store, false);
    expect(view.api().historyDurable).toBe(false);
    await act(() => h.calls[0].succeed());
    expect(h.calls).toHaveLength(1);
    expect(view.api().state.historyError).toBeNull();
  });

  it('StrictMode boot replay admits only the current hydration snapshot', async () => {
    const h = controlledHistory();
    const view = mount(h.store, true);
    await waitFor(() => expect(view.api().bootReady).toBe(true));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].ids).toEqual(['a', 'b', 'c']);
    await act(() => h.calls[0].succeed());
    expect(h.calls).toHaveLength(1);
    expect(h.maxActive()).toBe(1);
  });

  it('a synchronously throwing custom store can save the next requested snapshot', async () => {
    const h = controlledHistory();
    let first = true;
    const custom: HistoryStore = {
      ...h.store,
      save: (...args) => {
        if (first) {
          first = false;
          throw new Error('synchronous custom failure');
        }
        return h.store.save(...args);
      },
    };
    const view = mount(custom);
    await waitFor(() => expect(view.api().state.historyError).toBe('Failed to save history: synchronous custom failure'));
    expect(h.calls).toHaveLength(0);
    act(() => view.api().history.delete('a'));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    await act(() => h.calls[0].succeed());
    expect(view.api().state.historyError).toBeNull();
    expect(await diskIds(h.store)).toEqual(['b', 'c']);
  });

  it('a superseded load cannot overwrite replacement records or its newer save error', async () => {
    const old = controlledHistory();
    const oldLoadGate = deferred();
    const oldStore: HistoryStore = {
      ...old.store,
      load: vi.fn(async (...args: Parameters<HistoryStore['load']>) => {
        await oldLoadGate.promise;
        return old.store.load(...args);
      }),
    };
    const view = mount(oldStore);
    expect(old.calls).toHaveLength(0);
    const replacement = controlledHistory([row('replacement')]);
    view.replace(replacement.store);
    await waitFor(() => expect(replacement.calls).toHaveLength(1));
    await act(() => replacement.calls[0].fail('current owner failure'));
    await act(async () => oldLoadGate.resolve());
    expect(view.api().state.records.map(({ id }) => id)).toEqual(['replacement']);
    expect(view.api().state.historyError).toBe('Failed to save history: current owner failure');
    expect(old.calls).toHaveLength(0);
  });

  it('an old write completion cannot clear a replacement-generation error during load', async () => {
    const old = controlledHistory();
    const view = mount(old.store);
    await waitFor(() => expect(old.calls).toHaveLength(1));
    const loadGate = deferred();
    const next: HistoryStore = {
      load: async () => {
        await loadGate.promise;
        return { error: 'replacement is read-only', ok: false };
      },
      save: vi.fn(),
    };
    view.replace(next);
    act(() => view.api().dispatch({ message: 'new generation error', sticky: true, type: 'set-history-error' }));
    await act(() => old.calls[0].succeed());
    expect(view.api().state.historyError).toBe('new generation error');
    await act(async () => loadGate.resolve());
    expect(view.api().state.historyError).toBe('replacement is read-only');
    act(() => view.api().dispatch({ record: row('memory-only'), type: 'append-record' }));
    expect(view.api().state.historyError).toBe('replacement is read-only');
    expect(next.save).not.toHaveBeenCalled();
  });

  it('replacement retires pending snapshots and waits for an issued write before loading', async () => {
    const old = controlledHistory();
    const view = mount(old.store);
    await waitFor(() => expect(old.calls).toHaveLength(1));
    act(() => view.api().history.delete('a'));

    const loadGate = deferred();
    const replacement = controlledHistory([row('replacement')]);
    const nextStore: HistoryStore = {
      ...replacement.store,
      load: vi.fn(async (...args: Parameters<HistoryStore['load']>) => {
        await loadGate.promise;
        return replacement.store.load(...args);
      }),
    };
    view.replace(nextStore);
    expect(view.api().bootReady).toBe(false);
    expect(nextStore.load).not.toHaveBeenCalled();
    expect(replacement.calls).toHaveLength(0);

    await act(() => old.calls[0].fail('obsolete write failed'));
    expect(old.calls).toHaveLength(1);
    expect(view.api().state.historyError).toBeNull();
    expect(nextStore.load).toHaveBeenCalledTimes(1);
    expect(replacement.calls).toHaveLength(0);
    await act(async () => loadGate.resolve());
    await waitFor(() => expect(view.api().bootReady).toBe(true));
    expect(replacement.calls.map(({ ids }) => ids)).toEqual([['replacement']]);
    await act(() => replacement.calls[0].succeed());
    expect(await diskIds(replacement.store)).toEqual(['replacement']);
  });
});
