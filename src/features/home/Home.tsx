import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { isTauriEnv } from '../../services/capture/captureService';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';
import { DictateCard } from './DictateCard';
import { wovenRecords } from './pickWords';
import { HomeHero } from './HomeHero';
import { RecentCard } from './RecentCard';
import { stageLabel, stagePhase } from './stagePhase';

interface HomeProps {
  /** Shared App-level dogfood capture (also driven by global gesture). */
  dogfood: UseDogfoodCaptureResult;
  /** Test seam: cleanup model status for the hero caption. */
  cleanupModelStore?: CleanupModelStore;
  onToast: (message: string) => void;
}

export function Home({ cleanupModelStore, dogfood, onToast }: HomeProps) {
  const { clipboard, state } = useApp();
  const isNative = isTauriEnv();
  const phase = stagePhase(dogfood.phase, dogfood.captureState.kind === 'active', state.dictation);
  const woven = wovenRecords(state.records);
  const last = woven[0] ?? null;
  // The newest dictation when Home opened; anything newer weaves in on the stage.
  const [openedOn] = useState(() => last?.id ?? null);

  async function copy(text: string) {
    try {
      await clipboard.copy(text);
      onToast('Copied to clipboard');
    } catch {
      onToast('Copy failed');
    }
  }

  return (
    <div className="home">
      {/* The voice stage: one dark instrument in both themes, alive while you dictate. */}
      <div className="stage" data-phase={phase}>
        <div className="stage__readout">
          <span className="stage__mic"><i aria-hidden="true" />{stageLabel(phase, dogfood.phase)}</span>
          <span className="stage__meta">
            <span>Model <b>{state.settings.transcriptionModel}</b></span>
            <span>Output <b>{state.settings.clipboardFallback ? 'Insert, fall back to Copy' : 'Insert only'}</b></span>
          </span>
        </div>
        <HomeHero
          cleanupModelStore={cleanupModelStore}
          isNative={isNative}
          pick={last && { fresh: last.id !== openedOn, onCopy: (t) => { void copy(t); }, record: last }}
        />
        <DictateCard dogfood={dogfood} isNative={isNative} onCopy={(t) => { void copy(t); }} />
      </div>
      {/* The cloth: what the loom wove before the last pick, on the window's one sheet (frame.css). */}
      <div className="cloth">
        <RecentCard earlier={woven.slice(1, 6)} hasWords={last !== null} onCopy={(t) => { void copy(t); }} />
      </div>
    </div>
  );
}
