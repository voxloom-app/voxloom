import type { DictationState } from '../../domain/types';
import type { DogfoodPhase } from '../../services/stt/dogfoodPhase';

/** What the Home voice stage shows: voice going in, text coming out, or rest. */
export type StagePhase = 'idle' | 'listening' | 'speaking' | 'processing';

/**
 * Combines the real capture path (Home Start and the global gesture) with the
 * dictation machine (browser mock scenarios). Real capture wins when it is
 * active; finished, failed and cancelled runs rest at idle.
 */
export function stagePhase(
  phase: DogfoodPhase,
  captureActive: boolean,
  dictation: DictationState,
): StagePhase {
  if (phase === 'starting' || phase === 'recording' || captureActive) return 'listening';
  if (phase === 'transcribing' || phase === 'cleaning') return 'processing';
  if (dictation.kind === 'listening') return dictation.waveform === 'speaking' ? 'speaking' : 'listening';
  if (dictation.kind === 'processing') return 'processing';
  return 'idle';
}

/** Short readout for the stage's mic indicator. */
export function stageLabel(stage: StagePhase, phase: DogfoodPhase): string {
  if (stage === 'listening' || stage === 'speaking') return 'Listening';
  if (stage === 'processing') return phase === 'cleaning' ? 'Cleaning up' : 'Transcribing';
  return 'Mic off';
}
