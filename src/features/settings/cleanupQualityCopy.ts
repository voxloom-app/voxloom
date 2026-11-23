/** BUS-229: Settings copy for the optional Qwen3 4B cleanup model (pending UI/UX review). */
import type { CleanupModelEntry } from '../../services/cleanup/types';
import { endSentence } from './cleanupCopy';

export const QUALITY_LABEL = 'Higher quality model';
/** The size is the pinned file's (2,497,281,120 B); RAM is the measured M5 peak (4117 MiB). */
export const QUALITY_HELP =
  'Qwen3 4B improves Formal rewriting. It\'s a 2.5 GB download, uses about 4 GB of memory while it runs, and the first cleanup after launch is slower.';
export const QUALITY_DOWNLOAD = 'Download (2.5 GB)';
export const QUALITY_SWITCH = 'Use the higher quality model';
export const QUALITY_REMOVE = 'Remove';
export const QUALITY_REMOVING = 'Removing…';

export function qualityModelNote(model: CleanupModelEntry, chosen: boolean): string {
  if (!model.available) {
    return chosen ? 'Not installed. Download it again, or turn it off to use Qwen3 0.6B.' : 'Not installed.';
  }
  return chosen ? 'Qwen3 4B is in use.' : 'Qwen3 4B is installed.';
}

export function qualityRemoveFailedNote(reason: string): string {
  return `Couldn't remove the model: ${endSentence(reason)}`;
}
