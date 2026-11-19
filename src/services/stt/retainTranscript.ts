/// Keep a dictation that could not be inserted: History, and the clipboard
/// when the caller asks for it (BUS-255). Never logs the text.

import { createDogfoodRecord } from '../../domain/records';
import type { CleanupProvenance, HistoryStatus, WritingStyle } from '../../domain/types';
import type { ClipboardAdapter } from '../clipboard';
import type { DictationRecord } from '../../domain/types';

export interface RetainTranscriptInput {
  cleanup?: CleanupProvenance;
  clipboard?: ClipboardAdapter;
  /** When false, History only (late results; or Copy fallback is off). */
  copyToClipboard: boolean;
  durationMs: number;
  id: string;
  model?: string | null;
  now: number;
  onHistoryRecord?: (record: DictationRecord) => void;
  rawText?: string;
  style: WritingStyle;
  text: string;
}

/**
 * Write the transcript to History, and to the clipboard when requested.
 * Returns `copied` only when the clipboard write succeeded. Blank text is
 * ignored so History is not polluted with empty rows.
 */
export async function retainTranscript(
  input: RetainTranscriptInput,
): Promise<HistoryStatus> {
  if (!input.text.trim()) return 'failed';
  let copied = false;
  if (input.copyToClipboard && input.clipboard) {
    try {
      await input.clipboard.copy(input.text);
      copied = true;
    } catch {
      copied = false;
    }
  }
  const status: HistoryStatus = copied ? 'copied' : 'failed';
  const record = createDogfoodRecord({
    cleanup: input.cleanup,
    durationMs: input.durationMs,
    id: input.id,
    model: input.model,
    now: input.now,
    rawText: input.rawText,
    status,
    style: input.style,
    text: input.text,
  });
  if (record) input.onHistoryRecord?.(record);
  return status;
}
