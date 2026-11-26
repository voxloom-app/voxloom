import { act, render, screen, waitFor } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WEAVE } from '../../src/components/Waveform';
import { OverlayApp } from '../../src/overlay/OverlayApp';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();

function send(event: string, payload: unknown) {
  act(() => handlers.get(event)?.(payload));
}

/** The braid as drawn: every strand path inside the microphone meter. */
function meter(): string[] {
  return [...screen.getByRole('img', { name: 'Microphone level' }).querySelectorAll('.wave__strand')]
    .map((path) => path.getAttribute('d') ?? '');
}

/** Largest swing from the centre line on the voice side, where the newest level enters. */
function voiceSideSwing(): number {
  const voiceSide = WEAVE.x0 + (WEAVE.x1 - WEAVE.x0) / 4;
  return Math.max(...meter().flatMap((d) => d.slice(1).split(/[LM]/).map((pair) => pair.split(' ').map(Number))
    .filter(([x]) => x <= voiceSide).map(([, y]) => Math.abs(y - WEAVE.mid))));
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
      expect(voiceSideSwing()).toBeLessThanOrEqual(WEAVE.restAmp);

      send('capture:event', {
        generation: 1, kind: 'capture-started', request_id: 'first',
      });
      send('capture:event', {
        generation: 1, kind: 'capture-level', level: 0.1,
        request_id: 'first',
      });
      expect(voiceSideSwing()).toBeGreaterThan(WEAVE.restAmp);
      const live = meter();

      send('capture:event', {
        generation: 0, kind: 'capture-level', level: 1,
        request_id: 'stale',
      });
      expect(meter()).toEqual(live);

      send('overlay:waveform', { waveform: 'silent' });
      expect(voiceSideSwing()).toBeLessThanOrEqual(WEAVE.restAmp);
      send('capture:event', {
        generation: 2, kind: 'capture-level', level: 1,
        request_id: 'second',
      });
      expect(voiceSideSwing()).toBeGreaterThan(5);
    });
});
