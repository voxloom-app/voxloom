import type { Page } from '@playwright/test';

interface HudEvents {
  ready(): boolean;
  emit(name: string, payload: unknown): void;
}

type HudWindow = Window & { __hudTest: HudEvents };

/** Exercise the production overlay through its event boundary, with no audio or native window. */
export async function openOverlay(page: Page) {
  await page.setViewportSize({ width: 190, height: 76 });
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, string>();
    let nextId = 1;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: (callback: (event: unknown) => void) => {
          const id = nextId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (cmd: string, args: { event: string; handler: number; eventId: number }) => {
          if (cmd === 'plugin:event|listen') {
            listeners.set(args.handler, args.event);
            return args.handler;
          }
          if (cmd === 'plugin:event|unlisten') listeners.delete(args.eventId);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_: string, id: number) => listeners.delete(id) },
      __hudTest: {
        ready: () => ['overlay:waveform', 'capture:event'].every((name) => [...listeners.values()].includes(name)),
        emit: (name, payload) => listeners.forEach((event, id) => {
          if (event === name) callbacks.get(id)?.({ event: name, id, payload });
        }),
      } satisfies HudEvents,
    });
  });
  await page.goto('/overlay.html');
  await page.waitForFunction(() => (window as HudWindow).__hudTest.ready());
}

export async function emit(page: Page, name: string, payload: Record<string, unknown>) {
  await page.evaluate(({ name, payload }) => (window as HudWindow).__hudTest.emit(name, payload), { name, payload });
}

export async function levels(page: Page, values: number[], generation = 1) {
  await page.evaluate(({ values, generation }) => {
    for (const level of values) (window as HudWindow).__hudTest.emit('capture:event', {
      generation, kind: 'capture-level', level, request_id: `synthetic-${generation}`,
    });
  }, { values, generation });
}
