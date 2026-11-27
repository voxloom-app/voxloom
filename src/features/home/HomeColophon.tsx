import { useApp } from '../../app/AppContext';
import type { CleanupModelStore } from '../../services/cleanup/contracts';
import { speechModel } from '../settings/pathStops';
import { useCleanupModel } from '../settings/useCleanupModel';
import { HomeStyle } from './HomeStyle';

/**
 * How your words are made, as the page's colophon (ui-iter-29): the model, the output and
 * the writing style rest at the foot of Home instead of between your last words and the
 * earlier ones. They are set once and rarely changed, so they sit where a printed page
 * says how it was made.
 */
export function HomeColophon({ cleanupModelStore, isNative }: {
  /** Test seam: cleanup model status (defaults to native). */
  cleanupModelStore?: CleanupModelStore;
  isNative: boolean;
}) {
  const { state } = useApp();
  const cleanupModel = useCleanupModel(isNative, cleanupModelStore);
  const output = state.settings.clipboardFallback ? 'Insert, fall back to Copy' : 'Insert only';
  return (
    <div className="home-colophon">
      <p className="home-colophon__setup">
        <span><span className="sr-only">Model </span>{speechModel(state.settings.transcriptionModel).name}</span>
        <span><span className="sr-only">Output </span>{output}</span>
      </p>
      <HomeStyle isNative={isNative} model={cleanupModel} />
    </div>
  );
}
