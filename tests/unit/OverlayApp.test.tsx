import { act, render, screen, waitFor } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayApp } from '../../src/overlay/OverlayApp';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

function send(event: string, payload: unknown) {
  act(() => handlers.get(event)?.(payload));
}

function meter(): string[] {
  return [...screen.getByRole('img', { name: 'Microphone level' }).querySelectorAll('i')]
    .map(bar => bar.style.transform);
}

beforeEach(() => {
  handlers.clear();
  vi.mocked(listen).mockImplementation(async (eventName, callback) => {
    handlers.set(eventName, (payload) => callback({ payload } as
      Parameters<typeof callback>[0]));
    return () => { handlers.delete(eventName); };
  });
});

describe('OverlayApp', () => {
  it('shows live session levels, ignores stale sessions and resets for a new hold',
    async () => {
      render(<OverlayApp />);
      await waitFor(() => expect(handlers.has('capture:event')).toBe(true));
      send('overlay:waveform', { waveform: 'silent' });
      const silent = meter();

      send('capture:event', {
        generation: 1, kind: 'capture-started', request_id: 'first',
      });
      send('capture:event', {
        generation: 1, kind: 'capture-level', level: 0.1,
        request_id: 'first',
      });
      const live = meter();
      expect(live.slice(0, -1)).toEqual(silent.slice(0, -1));
      expect(live.at(-1)).not.toBe(silent.at(-1));

      send('capture:event', {
        generation: 0, kind: 'capture-level', level: 1,
        request_id: 'stale',
      });
      expect(meter()).toEqual(live);

      send('overlay:waveform', { waveform: 'silent' });
      expect(meter()).toEqual(silent);
      send('capture:event', {
        generation: 2, kind: 'capture-level', level: 1,
        request_id: 'second',
      });
      expect(meter().at(-1)).toBe('scaleY(1)');
    });
});
