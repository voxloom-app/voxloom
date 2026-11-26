import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { isTauriEnv } from '../../services/capture/captureService';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';
import { DictateCard } from './DictateCard';
import { HomeHero } from './HomeHero';
import { LastDictation } from './LastDictation';
import { wovenRecords } from './pickWords';
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
  // The newest dictation when Home opened; anything newer weaves into the sheet.
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
      <div className="stage home-voice" data-phase={phase}>
        <span className="stage__mic"><i aria-hidden="true" />{stageLabel(phase, dogfood.phase)}</span>
        <HomeHero cleanupModelStore={cleanupModelStore} hasWords={last !== null} isNative={isNative} />
        <DictateCard dogfood={dogfood} isNative={isNative} onCopy={(t) => { void copy(t); }} />
        <dl className="stage__meta">
          <div><dt>Model</dt><dd>{state.settings.transcriptionModel}</dd></div>
          <div><dt>Output</dt><dd>{state.settings.clipboardFallback ? 'Insert, fall back to Copy' : 'Insert only'}</dd></div>
        </dl>
      </div>
      <div className="cloth home-paper">
        {last && <LastDictation fresh={last.id !== openedOn} onCopy={(t) => { void copy(t); }} record={last} />}
        <RecentCard earlier={woven.slice(1, 6)} hasWords={last !== null} onCopy={(t) => { void copy(t); }} />
      </div>
    </div>
  );
}
