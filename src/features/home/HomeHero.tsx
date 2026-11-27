import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import { speechModel } from '../settings/pathStops';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { useCleanupModel } from '../settings/useCleanupModel';
import type { CaptureProps } from './captureRun';
import { HomeStyle } from './HomeStyle';
import { LastDictation } from './LastDictation';
import { LoomBar, type StagePick } from './LoomBar';

/**
 * Hero: the shortcut, then the last pick (your last dictation), the weft with Start and
 * Copy, then how your words are made. Before the first dictation the shortcut is the
 * headline and the lede explains the gesture; once there are words, the shortcut steps
 * back to one quiet line of keys and your words take the stage (ui-iter-25). The stage's
 * loom lives on the weft alone, and model, output and writing style share one foot line.
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
  const output = state.settings.clipboardFallback ? 'Insert, fall back to Copy' : 'Insert only';
  return (
    <section aria-labelledby="home-title" className="home-hero" data-words={pick ? '' : undefined}>
      <div className="home-hero__title">
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
      <div className="home-hero__foot">
        <p className="home-hero__setup">
          <span><span className="sr-only">Model </span>{speechModel(state.settings.transcriptionModel).name}</span>
          <span><span className="sr-only">Output </span>{output}</span>
        </p>
        <HomeStyle isNative={isNative} model={cleanupModel} />
      </div>
    </section>
  );
}
