import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import type { DictationRecord } from '../../domain/types';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import { LastDictation } from './LastDictation';
import { VoiceLoom } from './VoiceLoom';

/** The newest dictation with words, whether it landed while Home was open, and how to copy it. */
export type StagePick = { fresh: boolean; onCopy: (text: string) => void; record: DictationRecord };

/**
 * Hero (ui-iter-33): your shortcut is the stage's instrument. People dictate by holding it in
 * any app, so the keys sit on the stage's one loom, where the Start and Copy capsule used to
 * be (ui-iter-21): lime threads gather into "Hold <keys>" (your voice going in) and cyan
 * threads leave "to dictate" (text coming out). Hold the keys anywhere and they sink and glow
 * here while the threads carry the light. Your last words follow, with a quiet Copy beside
 * their time. Starting, stopping and cancelling from the window live at the rail's foot on
 * every page (RailRun). The earlier dictations hang under the stage, and how your words are
 * made is the page's colophon (HomeColophon, ui-iter-29).
 */
export function HomeHero({ pick = null }: {
  /** The newest dictation with words, or null before the first one. */
  pick?: StagePick | null;
}) {
  const { state } = useApp();
  const active = useShortcutActive();
  return (
    <section aria-labelledby="home-title" className="home-hero" data-words={pick ? '' : undefined}>
      <div className="home-hero__title loom-bar">
        <VoiceLoom side="in" />
        <h1 id="home-title">
          {active
            ? <>Hold <KeyCombo combo={state.settings.shortcut} /> to dictate</>
            : NO_SHORTCUT_HEADING}
        </h1>
        <VoiceLoom side="out" />
      </div>
      {!active && <p className="home-hero__none">{NO_SHORTCUT_HINT}</p>}
      {pick
        ? <LastDictation fresh={pick.fresh} onCopy={pick.onCopy} record={pick.record} />
        : <p className="home-hero__lede">Speak in any app. Release to type. Transcribed locally with Whisper.</p>}
    </section>
  );
}
