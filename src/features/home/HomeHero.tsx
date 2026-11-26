import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import type { DictationRecord } from '../../domain/types';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { useCleanupModel } from '../settings/useCleanupModel';
import { HomeStyle } from './HomeStyle';
import { LastDictation } from './LastDictation';
import { VoiceLoom } from './VoiceLoom';

/**
 * Hero: the shortcut as key caps on the voice loom, then the last pick (your
 * last dictation), then the writing style (H1). Before the first dictation the lede
 * explains the gesture instead; once there are words, the shortcut band steps
 * back to a compact line and your words take the stage.
 */
export function HomeHero({ cleanupModelStore, isNative, pick = null }: {
  /** Test seam: cleanup model status (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
  isNative: boolean;
  /** The newest dictation with words (and whether it landed while Home was open), or null before the first one. */
  pick?: { fresh: boolean; onCopy: (text: string) => void; record: DictationRecord } | null;
}) {
  const { state } = useApp();
  const active = useShortcutActive();
  const cleanupModel = useCleanupModel(isNative, cleanupModelStore);
  return (
    <section aria-labelledby="home-title" className="home-hero" data-words={pick ? '' : undefined}>
      <div className="home-hero__title">
        {active && <VoiceLoom />}
        <h1 id="home-title">
          {active
            ? <>Hold <KeyCombo combo={state.settings.shortcut} /> to dictate</>
            : NO_SHORTCUT_HEADING}
        </h1>
      </div>
      {!active && <p className="home-hero__none">{NO_SHORTCUT_HINT}</p>}
      {pick
        ? <LastDictation fresh={pick.fresh} onCopy={pick.onCopy} record={pick.record} />
        : <p className="home-hero__lede">Speak in any app. Release to type. Transcribed locally with Whisper.</p>}
      <HomeStyle isNative={isNative} model={cleanupModel} />
    </section>
  );
}
