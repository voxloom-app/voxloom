import type { CleanupModelView } from '../settings/cleanupCopy';
import { CLEANUP_DOWNLOAD_CANCELLED } from '../settings/cleanupCopy';
import { chosenCleanupModel, chosenModelReady } from '../settings/cleanupModelChoice';

/**
 * BUS-229: what the Home writing-style picker shows. A style only changes
 * text through local cleanup, so the picker is live only while cleanup is on
 * and its model is there; otherwise it stays visible but disabled, with a
 * note saying why and (when possible) one action that fixes it.
 */
export type HomeStyleState =
  | 'browser'
  | 'hidden'
  | 'on'
  | 'on-missing'
  | 'off-missing'
  | 'off-installed'
  | 'off-unavailable'
  | 'downloading'
  | 'failed';

export function homeStyleState(input: {
  active: boolean;
  download: { downloading: boolean; note: string | null };
  isNative: boolean;
  /** Saved `cleanupModelId`; the chosen model decides ready vs missing. */
  savedModelId?: string | null;
  shown: boolean;
  view: CleanupModelView;
}): HomeStyleState {
  const { active, download, isNative, savedModelId = null, shown, view } = input;
  if (!isNative) return 'browser';
  if (!shown) return 'hidden';
  if (download.downloading) return 'downloading';
  const missing = view.kind === 'status' && !chosenCleanupModel(view.status, savedModelId).available;
  // Home can only download the default model (its note names Qwen3 0.6B):
  // a missing optional 4B is fixed in Settings → Cleanup.
  const homeCanFix = missing && homeDownloadId(view, savedModelId) !== null;
  if (download.note && download.note !== CLEANUP_DOWNLOAD_CANCELLED && homeCanFix) return 'failed';
  // While cleanup is on, only a status that says the model is gone disables
  // styles: a pending or failed status read must not flicker the picker.
  if (active) return missing ? 'on-missing' : 'on';
  if (chosenModelReady(view, savedModelId)) return 'off-installed';
  return homeCanFix ? 'off-missing' : 'off-unavailable';
}

/**
 * BUS-229 PR2: the model Home's download action fetches — the default, and
 * only while it is the chosen one; null when Home has nothing to download.
 */
export function homeDownloadId(view: CleanupModelView, savedModelId: string | null): string | null {
  if (view.kind !== 'status') return null;
  const chosen = chosenCleanupModel(view.status, savedModelId);
  return chosen.id === view.status.id && !chosen.available ? chosen.id : null;
}

export const HOME_STYLE_CAPTION_ON = 'Writing style · local cleanup on';
export const HOME_STYLE_CAPTION = 'Writing style';
export const HOME_STYLE_TURN_ON = 'Turn on local cleanup';
export const HOME_STYLE_TRY_AGAIN = 'Try again';

export function homeStyleNote(state: HomeStyleState, ratio: number): string | null {
  switch (state) {
    case 'off-missing':
      return 'Styles need local cleanup, which runs on this Mac (Qwen3 0.6B, 397 MB).';
    case 'off-installed':
    case 'off-unavailable':
      return 'Styles need local cleanup, which is off.';
    case 'downloading':
      return `Downloading the cleanup model… ${downloadPercent(ratio)}%`;
    case 'failed':
      return 'Couldn’t download the cleanup model. You can also add it in Settings → Cleanup.';
    case 'on-missing':
      return 'The cleanup model is missing, so styles aren’t applied.';
    default:
      return null;
  }
}

/** Whole percent, 0..99 while a download runs (as the Settings button shows). */
export function downloadPercent(ratio: number): number {
  return Math.min(99, Math.max(0, Math.floor(ratio * 100)));
}
