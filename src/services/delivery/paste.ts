/**
 * Outcome of shared or legacy paste (clipboard + ⌘V). Posting is not an
 * insertion receipt: a clean paste (prior clipboard restored) is recorded
 * `pasted`, a neutral "⌘V was posted" result, never `inserted`. It is
 * silent: its message is empty, so no status line and no toast, and the HUD
 * shows nothing (as for any successful insert). A paste whose clipboard was
 * not restored says so and stays `unverified`.
 */

import { copyFallback, failOutcome, mayHaveInserted } from './fallback';
import { restoreSkippedSuffix, TERMINAL_PASTE_MESSAGE } from './messages';
import { InsertError } from './types';
import { isPasteReport } from './reports';
import { deliveryErrorDetail } from './errors';
import type { DeliverOptions, DeliveryOutcome, PasteBinding, PasteReport, TargetSnapshot } from './types';

export function pastedOutcome(text: string, report: PasteReport): DeliveryOutcome {
  const skipped = report.clipboardRestored
    ? null
    : report.restoreSkippedReason ?? 'prior clipboard not restored';
  return {
    clipboardRestored: report.clipboardRestored,
    detail: 'Pasted with ⌘V through the clipboard; input not verified',
    message: skipped ? TERMINAL_PASTE_MESSAGE + restoreSkippedSuffix(skipped) : '',
    restoreSkippedReason: skipped,
    status: skipped ? 'unverified' : 'pasted',
    text,
  };
}

/**
 * Paste into the terminal (or Messages) that was in front when you started
 * dictating, then let native put the user's clipboard back. `bound` is that app's pid and
 * app path, captured at recording start: native re-checks both against the app
 * in front right now. Only
 * reached with Clipboard fallback on (`planDelivery`). A refusal before ⌘V
 * (Secure Keyboard Entry, control characters, the app changed, permissions)
 * copies with the "Press ⌘V" hint. After ⌘V went out nothing is retried or
 * copied: the clipboard was just restored on purpose.
 */
export async function pasteInTerminal(
  options: DeliverOptions,
  bound: PasteBinding,
  current: () => boolean,
  stale: () => DeliveryOutcome,
): Promise<DeliveryOutcome> {
  return pasteWith(options, () => {
    if (!options.platform.pasteText) throw new InsertError('paste unavailable on this platform', false);
    return options.platform.pasteText(options.text, bound);
  }, current, stale, true);
}

/** Insert through the verified AX route; `copyAllowed` gates its Copy recovery. */
export type InsertFallback = (copyAllowed: boolean) => Promise<DeliveryOutcome>;

/**
 * Generic route: completion authority is independent of AX editability/start binding.
 * `insertFallback` (editable fields only) runs when native refused while saving
 * the clipboard: nothing was written, and AX insertion leaves the clipboard alone.
 */
export async function pasteInTarget(
  options: DeliverOptions,
  intended: TargetSnapshot,
  current: () => boolean,
  stale: () => DeliveryOutcome,
  insertFallback?: InsertFallback,
): Promise<DeliveryOutcome> {
  return pasteWith(options, () => {
    if (!options.platform.pasteTarget) throw new InsertError('paste unavailable on this platform', false);
    return options.platform.pasteTarget(options.text, intended);
  }, current, stale, intended.knownTerminal === true, insertFallback);
}

async function pasteWith(
  options: DeliverOptions,
  dispatch: () => Promise<PasteReport>,
  current: () => boolean,
  stale: () => DeliveryOutcome,
  terminal: boolean,
  insertFallback?: InsertFallback,
): Promise<DeliveryOutcome> {
  const { platform, text } = options;
  try {
    const report = await dispatch();
    if (!isPasteReport(report)) throw new InsertError('adapter paste reply malformed or contradictory', true);
    return pastedOutcome(text, report);
  } catch (error: unknown) {
    const detail = deliveryErrorDetail(error);
    if (!(error instanceof InsertError) || error.writeStarted) {
      // The IPC died after dispatch: ⌘V may have gone out.
      const report = { detail: `paste error after dispatch: ${detail}`, typed: false, unverified: true };
      return mayHaveInserted(text, report);
    }
    if (!current()) return stale();
    // Never Copy over a newer clipboard (`changed`).
    if (error.clipboard && insertFallback) return insertFallback(error.clipboard === 'unsaved');
    if (error.clipboard === 'changed') return failOutcome(text, `paste skipped: ${detail}`);
    return copyFallback(platform, text, `paste skipped: ${detail}`, terminal);
  }
}
