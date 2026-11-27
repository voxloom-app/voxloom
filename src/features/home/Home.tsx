import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { isTauriEnv } from '../../services/capture/captureService';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import type { UseDogfoodCaptureResult } from '../../services/stt/useDogfoodCapture';
import { wovenRecords } from './pickWords';
import { HomeHero } from './HomeHero';
import { RecentCard } from './RecentCard';
import { stagePhase } from './stagePhase';

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
  // The run's own transcript, for manual recovery when History didn't keep it
  // (retention Off). When it is already the last dictation, the stage shows it once.
  const transcript = dogfood.transcript?.text;
  const recovery = transcript && transcript !== last?.text ? transcript : null;
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
      {/* The voice stage: one dark instrument in both themes, alive while you dictate.
          Dictating from the window starts on its weft, beside Copy (ui-iter-21). The mic
          readout is gone (ui-iter-25): the Start capsule and the rail already say it. */}
      <div className="stage" data-phase={phase}>
        <HomeHero
          capture={{ dogfood, isNative, onCopy: (t) => { void copy(t); } }}
          cleanupModelStore={cleanupModelStore}
          isNative={isNative}
          pick={last && { fresh: last.id !== openedOn, onCopy: (t) => { void copy(t); }, record: last }}
        />
        {recovery && (
          <section aria-labelledby="recovery-title" aria-live="polite" className="dogfood-transcript stage__recovery">
            <div>
              <h2 className="dogfood-transcript__label" id="recovery-title">Last transcript</h2>
              <p>{recovery}</p>
              <p className="fine">Available for manual recovery even when History retention is Off.</p>
            </div>
            <button className="btn" onClick={() => { void copy(recovery); }} type="button">
              <Icon name="copy" /> Copy last transcript
            </button>
          </section>
        )}
      </div>
      {/* The cloth: what the loom wove before the last pick, on the window's one sheet (frame.css). */}
      <div className="cloth">
        <RecentCard earlier={woven.slice(1, 6)} hasWords={last !== null} onCopy={(t) => { void copy(t); }} />
      </div>
    </div>
  );
}
