/**
 * BUS-14 delivery types — ADR native-shortcut-cancel-focus §§4–6.
 * Platform adapters produce completion evidence; policy selects a route before mutation.
 */

/** Why a target is or is not insertable. */
export type TargetKind =
  | 'insertable'
  | 'secure'
  | 'unsupported'
  | 'changed'
  | 'closed'
  | 'unavailable';

/**
 * Transcription-completion-time snapshot of the intended insertion target
 * (frontmost app + honest AX classification + optional native retained paste authority).
 */
export interface TargetSnapshot {
  /** Frontmost application name when known. */
  appName: string | null;
  /** Process id when known (identity check before insertion). */
  appPid: number | null;
  /** Opaque element identity for change detection (role + pid + optional id). */
  elementId: string | null;
  /** AX / accessibility role when known. */
  elementRole: string | null;
  /** True only when the element looked safely insertable at snapshot time. */
  insertable: boolean;
  kind: TargetKind;
  /**
   * Frontmost app is a known terminal or Messages (decided natively). Display only: it
   * picks the Copy message and never allows an insert. Absent means false.
   */
  knownTerminal?: boolean;
  /**
   * Frontmost app takes the clipboard paste route (WezTerm, Alacritty, kitty,
   * Ghostty, iTerm2, Apple Messages; never Terminal.app). Decided natively
   * by bundle name (Messages: exact system path); the name predates Messages; the native paste re-checks the frontmost app. Absent
   * means false.
   */
  pasteTerminal?: boolean;
  /**
   * App bundle path of the paste-route app (set iff `pasteTerminal`). With
   * `appPid` it identifies the app (the binding itself is `PasteBinding`).
   */
  pasteApp?: string | null;
  /** Native retained completion app/window + observable element authority. */
  sharedPasteToken?: string | null;
  /** Human-readable limitation or refusal reason (never empty for refusals). */
  reason: string | null;
  /** Epoch ms when the snapshot was taken. */
  capturedAt: number;
}

/** Evidence-backed delivery result — never claim Inserted/Copied/Failed without it. */
export type DeliveryStatus = 'inserted' | 'pasted' | 'copied' | 'failed' | 'unverified';

export interface DeliveryOutcome {
  /** Clipboard restore ran successfully after a temporary paste path. */
  clipboardRestored: boolean;
  /** Extra context for logs / history (secure, closed, conflict, …). */
  detail: string | null;
  /** Truthful toast / status line. */
  message: string;
  /** Present when restore was skipped (conflict, no snapshot, write fail). */
  restoreSkippedReason: string | null;
  status: DeliveryStatus;
  /**
   * A native write may have happened but could not be confirmed. The transcript
   * stays Unverified with manual recovery, never automatic Copy or retry.
   * Consumers read this evidence flag, never infer it from the message.
   */
  mayHaveInserted?: boolean;
  /** Always the transcript text for manual recovery (even if history is off). */
  text: string;
}

/**
 * Exceptions after invocation are uncertain unless an adapter explicitly
 * supplies InsertError(writeStarted=false), backed by native safe refusal
 * evidence or a known pre-invoke failure. Never infer no mutation from an
 * arbitrary error string or an absent/malformed native report.
 */
export class InsertError extends Error {
  readonly writeStarted: boolean;
  /**
   * Native refused while saving the user's clipboard, before writing it:
   * `unsaved` (concealed or too large) or `changed` (a newer copy exists).
   */
  readonly clipboard: 'unsaved' | 'changed' | null;
  constructor(message: string, writeStarted: boolean, clipboard: 'unsaved' | 'changed' | null = null) {
    super(message);
    this.name = 'InsertError';
    this.writeStarted = writeStarted;
    this.clipboard = clipboard;
  }
}

/** Structured native insert result (macOS). */
export interface InsertReport {
  /** Events posted to Terminal, never proof of input-buffer contents. */
  terminalDispatch?: 'complete' | 'partial';
  /** Unicode events posted; not alone proof of input-buffer delivery. */
  typed: boolean;
  /**
   * A mutation happened but read-back could not prove the full transcript
   * landed — text may be (partially) in the field. Treated as not inserted.
   */
  unverified: boolean;
  /** Diagnostic detail. */
  detail: string | null;
}

/**
 * Native paste result (macOS paste route). ⌘V was posted; whether the
 * app took it is unknown, so this is never proof of delivery.
 */
export interface PasteReport {
  /** The user's prior clipboard is back after the paste. */
  clipboardRestored: boolean;
  /** Why it is not (changed meanwhile, could not be saved, restore did not complete). */
  restoreSkippedReason: string | null;
}

/**
 * The paste-route app that was in front when dictation started (recording
 * start, not completion): its pid and app bundle path. A paste goes out only
 * if the app in front at delivery is this same process and app.
 */
export interface PasteBinding {
  appPid: number;
  pasteApp: string;
}

export interface ClipboardSnapshot {
  /** Plain text when read succeeded; null when unavailable / non-text. */
  text: string | null;
  ok: boolean;
}

/**
 * Replaceable platform boundary (macOS first; Windows later).
 * Implementations must never synthesize Enter / Tab / command chords
 * except a single paste when that is the documented insert method.
 */
export interface DeliveryPlatformAdapter {
  /** Read current clipboard plain text (for restore / conflict checks). */
  clipboardRead(): Promise<ClipboardSnapshot>;
  /** Restore prior clipboard text; fails loudly — caller decides toast. */
  clipboardRestore(prior: string): Promise<void>;
  /** Write plain text to the clipboard. */
  clipboardWrite(text: string): Promise<void>;
  /**
   * Insert plain text into the intended target (macOS: AX selected-text only;
   * no full-field value replacement).
   * Must refuse rather than insert into a different app.
   * Void is only the explicit legacy mock/stub contract; native replies must
   * contain a validated report. Refusals must use InsertError(false).
   */
  insertText(
    text: string,
    intended: TargetSnapshot,
  ): Promise<InsertReport | void>;
  /**
   * The paste-route app in front right now, or null when the frontmost app is
   * not one (or this platform has no paste route). Called when dictation
   * starts; cheap, never activates anything.
   */
  pasteBinding?(): Promise<PasteBinding | null>;
  /**
   * Paste into the app that was in front when you started dictating, via
   * the clipboard + ⌘V, then restore the clipboard (macOS only; absent
   * elsewhere). Rejects when nothing was pasted, including when the app in front is not `bound`.
   */
  pasteText?(text: string, bound: PasteBinding): Promise<PasteReport>;
  /** Paste only into the native-retained completion destination; never retarget. */
  pasteTarget?(text: string, intended: TargetSnapshot): Promise<PasteReport>;
  /** Snapshot frontmost app + focused element insertability. */
  snapshotTarget(): Promise<TargetSnapshot>;
  /**
   * Re-check completion snapshot before insertion: still present, same identity,
   * still insertable — or classify unavailable / secure / changed / unsupported.
   * Closure must not be inferred from unavailable AX focus alone.
   */
  validateTarget(intended: TargetSnapshot): Promise<TargetSnapshot>;
}

export interface DeliverOptions {
  /** Session lease, checked after awaits and before dispatching writes. */
  isCurrent?: () => boolean;
  /** Settings `clipboardFallback` — default-on per fixtures / ADR. */
  clipboardFallback: boolean;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Platform adapter (macOS AX / stub / test double). */
  platform: DeliveryPlatformAdapter;
  /** Completion-time snapshot; null means none taken (treat as unavailable). */
  intended: TargetSnapshot | null;
  /**
   * The paste-route app in front when dictation started. Without it (dictation
   * started elsewhere, or it was not captured) the legacy route cannot paste.
   * Shared paste uses completion-time authority instead.
   */
  pasteBinding?: PasteBinding | null;
  /** Transcript text to deliver. */
  text: string;
}
