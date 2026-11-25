import { useApp } from '../../app/AppContext';
import { AppTile } from '../../components/AppTile';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { useCleanupModel } from '../settings/useCleanupModel';
import { HomeStyle } from './HomeStyle';

/** Hero: shortcut key caps + writing-style segmented control (H1). */
export function HomeHero({ cleanupModelStore, isNative }: {
  /** Test seam: cleanup model status (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
  isNative: boolean;
}) {
  const { state } = useApp();
  const active = useShortcutActive();
  const cleanupModel = useCleanupModel(isNative, cleanupModelStore);
  return (
    <section aria-labelledby="home-title" className="home-hero">
      <span className="home-hero__orb"><AppTile size="lg" /></span>
      <div>
        <h1 id="home-title">
          {active
            ? <>Hold <KeyCombo combo={state.settings.shortcut} /> to dictate</>
            : NO_SHORTCUT_HEADING}
        </h1>
        {!active && <p className="home-hero__none">{NO_SHORTCUT_HINT}</p>}
        <p>Speak in any app. Release to type. Transcribed locally with Whisper.</p>
        <HomeStyle isNative={isNative} model={cleanupModel} />
      </div>
    </section>
  );
}
