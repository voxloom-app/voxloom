import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { useCleanupModel } from '../settings/useCleanupModel';
import type { CaptureProps } from './captureRun';
import { HomeStyle } from './HomeStyle';
import { LastDictation } from './LastDictation';
import { LoomBar, type StagePick } from './LoomBar';
import { VoiceLoom } from './VoiceLoom';

/**
 * Hero: the shortcut as key caps on the voice loom, then the last pick (your
 * last dictation), the weft with Start and Copy, then the writing style (H1). Before
 * the first dictation the lede explains the gesture instead; once there are words,
 * the shortcut band steps back to a compact line and your words take the stage.
 */
export function HomeHero({ capture, cleanupModelStore, isNative, pick = null }: {
  /** Dictating from the window: the Start capsule on the weft (ui-iter-21). */
  capture?: CaptureProps;
  /** Test seam: cleanup model status (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
  isNative: boolean;
  /** The newest dictation with words (and whether it landed while Home was open), or null before the first one. */
  pick?: StagePick | null;
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
        ? <LastDictation fresh={pick.fresh} record={pick.record} />
        : <p className="home-hero__lede">Speak in any app. Release to type. Transcribed locally with Whisper.</p>}
      <LoomBar capture={capture} pick={pick} />
      <HomeStyle isNative={isNative} model={cleanupModel} />
    </section>
  );
}
