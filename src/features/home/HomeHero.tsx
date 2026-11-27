import { useApp } from '../../app/AppContext';
import { KeyCombo } from '../../components/KeyCombo';
import { useShortcutActive } from '../../services/shortcut/activeShortcut';
import { NO_SHORTCUT_HEADING, NO_SHORTCUT_HINT } from '../settings/shortcutCopy';
import type { CaptureProps } from './captureRun';
import { LastDictation } from './LastDictation';
import { LoomBar, type StagePick } from './LoomBar';

/**
 * Hero: the shortcut, then the last pick (your last dictation) and the weft with Start and
 * Copy. Before the first dictation the shortcut is the headline and the lede explains the
 * gesture; once there are words, the shortcut steps back to one quiet line of keys and your
 * words take the stage (ui-iter-25). The stage's loom lives on the weft alone. The earlier
 * dictations hang straight under the weft, and how your words are made is the page's
 * colophon (HomeColophon, ui-iter-29).
 */
export function HomeHero({ capture, pick = null }: {
  /** Dictating from the window: the Start capsule on the weft (ui-iter-21). */
  capture?: CaptureProps;
  /** The newest dictation with words (and whether it landed while Home was open), or null before the first one. */
  pick?: (StagePick & { onRead: (id: string, opener: HTMLButtonElement) => void }) | null;
}) {
  const { state } = useApp();
  const active = useShortcutActive();
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
        ? <LastDictation fresh={pick.fresh} onRead={pick.onRead} record={pick.record} />
        : <p className="home-hero__lede">Speak in any app. Release to type. Transcribed locally with Whisper.</p>}
      <LoomBar capture={capture} pick={pick} />
    </section>
  );
}
