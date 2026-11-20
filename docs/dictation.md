# Dictation and insertion

[Back to Voxloom](../README.md)

## Choose the destination

Focus the desired field when the final text is ready, after transcription and
optional cleanup. You can start recording in one app, stop in another, then
move to a third while processing: the completion-time destination is the one
Voxloom attempts to use. Stop ends audio capture without waiting for a target.
Automatic recording stops follow the same policy.

Once Voxloom observes that destination, keep it focused. If the app, window or
observable field changes before delivery, Voxloom refuses insertion rather
than redirecting it. It never restores focus, brings an app forward or presses
Return/Send. Clicking Stop in Voxloom can leave focus there; switch to your
destination before processing finishes.

The observation is not an atomic timestamp. Chromium/Electron apps may need a
brief Accessibility warmup (up to about 2.4 seconds) before their field is
available. Switching apps during that wait refuses delivery. Cancellation or
supersession prevents new delivery, but cannot undo input already dispatched.

## Clipboard fallback on (default)

Voxloom usually inserts with a clipboard paste into the completion-time app.
This is a generic route, not an allowlist of terminals or messaging apps.
Native checks retain the app, window and observable focused element. Apps that
don't expose a field can still accept paste, but Voxloom cannot detect every
caret or pane change inside the same window.

The transcript temporarily replaces the clipboard. After about 1.5 seconds,
Voxloom restores the previous contents unless the clipboard has changed in the
meantime. Clipboard managers can still observe the text; privacy markers do
not force them to ignore it. A slow app may read the restored clipboard
instead. See [Clipboard privacy](../PRIVACY.md#clipboard).

When paste cannot safely start, an editable field may still use direct
Accessibility insertion, or Voxloom may Copy the text for manual recovery.
It does not automatically try another route after input may have been sent.
A newer clipboard copy is left alone.

## Clipboard fallback off

Shared paste and automatic Copy are disabled. Voxloom can still attempt direct
Accessibility insertion into a supported editable field, or the guarded
Apple Terminal route described below. Otherwise it reports failure; a saved
transcript can be recovered from History when retention is enabled.

## Results and recovery

| Result | Meaning | What to do |
| --- | --- | --- |
| Inserted | The insertion route reported verified success. | Continue normally. |
| Copied | Text is on the clipboard rather than inserted. | Focus the destination and paste it yourself. |
| Unverified | Input may have been sent, but Voxloom could not confirm the destination contents. | Inspect the destination before copying or retrying. |
| Failed | Delivery did not complete. | Check permissions/focus and recover from History if the transcript was retained. |

A successful paste does not prove that the destination consumed the text.
Unverified is intentional, including when native communication is lost or a
write's outcome is uncertain. Do not treat it as an instruction to retry.

## Password fields and terminals

Voxloom refuses insertion into fields macOS identifies as secure, and guards
against Secure Keyboard Entry. Some browser password fields and terminal
password prompts do not expose those signals. Do not rely on Voxloom to detect
them all.

The system Apple Terminal app uses guarded Unicode events rather than the
clipboard. Complete or partial dispatch is Unverified, with no automatic Copy
or retry after events have been posted. Terminal and non-editable-target
routes reject control characters and line separators; ordinary editable
fields can accept multiline text. Printable input can still trigger actions
in shells or terminal interfaces without Return.

## Implementation references

For current routing and authorization, start with
[`policy.ts`](../src/services/delivery/policy.ts),
[`deliver.ts`](../src/services/delivery/deliver.ts) and
[`shared_target.rs`](../src-tauri/src/delivery/decide/shared_target.rs).

The [Apple Terminal](decisions/apple-terminal-delivery.md),
[terminal paste](decisions/terminal-paste-delivery.md) and
[web Accessibility](decisions/web-ax-reenable.md) records explain the earlier
routes and design rationale. Their recording-start binding and terminal
allowlist descriptions do not describe the current generic shared-paste route.
