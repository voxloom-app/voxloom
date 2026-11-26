import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { useCleanupModel } from '../settings/useCleanupModel';
import { HomeStyle } from './HomeStyle';
import { VoiceLoom } from './VoiceLoom';

/** The shortcut and writing style on the voice panel. */
export function HomeHero({ cleanupModelStore, hasWords = false, isNative }: {
  /** Test seam: cleanup model status (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
  hasWords?: boolean;
  isNative: boolean;
}) {
  const { state } = useApp();
  const active = useShortcutActive();
  const cleanupModel = useCleanupModel(isNative, cleanupModelStore);
  return (
    <section aria-labelledby="home-title" className="home-hero">
      <h1 id="home-title">{active ? 'Hold to dictate' : NO_SHORTCUT_HEADING}</h1>
      {active && (
        <div className="home-hero__shortcut">
          <VoiceLoom />
          <KeyCombo combo={state.settings.shortcut} />
        </div>
      )}
      {!active && <p className="home-hero__none">{NO_SHORTCUT_HINT}</p>}
      {!hasWords && <p className="home-hero__lede">Speak in any app. Release to type. Transcribed locally with Whisper.</p>}
      <HomeStyle isNative={isNative} model={cleanupModel} />
    </section>
  );
}
