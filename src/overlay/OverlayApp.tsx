import { useEffect, useState } from 'react';
import { toDisplayLevel, WAVEFORM_SAMPLES } from '../components/Waveform';
import type { CaptureEvent } from '../services/capture/types';
import type { OverlayResult, OverlayWaveform } from '../services/shortcut/overlayVisibility';
import { OverlayWaveformView } from './OverlayWaveformView';

const emptyLevels = () => Array<number>(WAVEFORM_SAMPLES).fill(0);

/** Separate, non-focusable Tauri window. Only level metadata crosses IPC. */
export function OverlayApp() {
  const [waveform, setWaveform] = useState<OverlayWaveform>('silent');
  const [result, setResult] = useState<OverlayResult | null>(null);
  const [levels, setLevels] = useState(emptyLevels);

  useEffect(() => {
    let disposed = false;
    let phase: OverlayWaveform = 'silent';
    let session: { generation: number; requestId: string } | null = null;
    let trail = emptyLevels();
    // A trailing pause can drain the live meter. Keep just the latest window
    // ending in activity for the printed trace; never store audio or words.
    let imprint = trail;
    const unlisteners: (() => void)[] = [];
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const overlayUnlisten = await listen<{ result?: OverlayResult; waveform: OverlayWaveform }>(
          'overlay:waveform',
          (event) => {
            phase = event.payload.waveform;
            setWaveform(phase);
            setResult(event.payload.result ?? null);
            if (phase === 'processing') setLevels(imprint);
            if (phase === 'silent' || phase.startsWith('result-')) {
              session = null;
              trail = imprint = emptyLevels();
              setLevels(trail);
            }
          },
        );
        if (disposed) overlayUnlisten();
        else unlisteners.push(overlayUnlisten);

        const captureUnlisten = await listen<CaptureEvent>('capture:event', (event) => {
          const capture = event.payload;
          const listening = phase === 'silent' || phase === 'speaking';
          if (capture.kind === 'capture-started') {
            session = { generation: capture.generation, requestId: capture.request_id };
            trail = imprint = emptyLevels();
            if (listening) setLevels(trail);
            return;
          }
          if (!listening || capture.kind !== 'capture-level') return;
          if (session && (session.generation !== capture.generation || session.requestId !== capture.request_id)) return;
          session ??= { generation: capture.generation, requestId: capture.request_id };
          const level = toDisplayLevel(capture.level);
          trail = [...trail.slice(1), level];
          if (level > 0) imprint = trail;
          setLevels(trail);
        });
        if (disposed) captureUnlisten();
        else unlisteners.push(captureUnlisten);
      } catch {
        // Browser preview of overlay.html — stay on the idle display.
      }
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  return <OverlayWaveformView levels={levels} result={result} waveform={waveform} />;
}
