# Privacy and local data

Voxloom transcribes on your Mac. Nothing you dictate is sent to a remote
service. The only network traffic is a model download from Hugging Face, and
only when you start it: a Whisper model (see `src-tauri/src/stt/catalog.rs`)
or the optional local cleanup model (see
`src-tauri/src/cleanup/model_store/pin.rs`). Each URL is pinned to one
immutable Hugging Face revision, and the app checks the file's exact size and
SHA-256 before saving it; a mismatch saves nothing.

## Transcript encryption on macOS and Windows

The macOS and Windows desktop apps encrypt the **whole durable history document** with
AES-256-GCM, including final and raw transcript text, cleanup provenance,
status, duration, model, timestamps and delivery outcomes. Recorded audio is
never saved. History, Home, Copy and retention still operate on decrypted data
in the running app's memory.

The app data folder contains the files below. On macOS it is
`~/Library/Application Support/com.voxloom.prototype/`; on Windows, use the
application's app-data directory under your user profile (not the install folder).

```text
~/Library/Application Support/com.voxloom.prototype/
├── history.json      authenticated encrypted history envelope
├── history.key.dpapi  Windows only: versioned current-user DPAPI-protected key
├── history.json.unreadable-*.bak  preserved history originals (see below)
├── history.json.encrypted-*.tmp   ciphertext-only staging, if interrupted
├── history.lock      transaction lock; no transcript/key content
├── dictionary.json   unencrypted custom words (also used by local cleanup)
├── settings.json     unencrypted preferences
├── *.json.unreadable-*.bak  settings/dictionary backups remain unencrypted
├── models/           downloaded Whisper files and verification markers
└── cleanup-models/   downloaded local cleanup model; no user data
```

**Linux retains its existing unencrypted JSON History storage.** This change
does not protect Linux transcripts. Settings, dictionary words and their
backups remain plaintext on all platforms. Other
processes running as your user, or tools copying your home folder, can read
those unencrypted files.

### Key protection and limits

On macOS, the random history key is kept in a dedicated generic-password item in the
user's default **file-based macOS Keychain**, with the ordinary creating-app
access policy. It is not synchronized by Voxloom. macOS may request approval
when a different app build tries to access it. Voxloom never replaces an
existing key on a duplicate-create race, deletes it for retention, or falls
back to writing plaintext when key access fails.

This is Keychain-protected storage at rest, **not** biometric protection, a
Secure Enclave/nonexportable key, or a guarantee of confidentiality while the
screen is locked. It does not protect against a compromised running app or
all same-user malware. Decrypted transcripts remain in app memory; text you
copy or insert into another app is outside this storage boundary. Signing and
upgrade identity can affect Keychain approval behavior.

On Windows, a separate random 256-bit key per app-data directory is stored
only as a versioned **current-user DPAPI-protected blob** beside history. The
raw key is never written to a file. Provisioning is add-only and the persisted
winner is read back and validated before any history ciphertext is written.
There are no prompts, machine-wide protection, plaintext fallback or automatic
replacement of a lost/corrupt key while encrypted artifacts remain.

DPAPI protects at rest under your Windows account, **not exclusively for this
app**: another process already running as your user can unprotect the key.
This is not protection from same-user malware, biometric protection, or a
cross-machine/roaming recovery promise. Copying encrypted files to another
machine/account is not an export/import feature. Keep the protected key blob
with recoverable files; restoring it still requires a usable original DPAPI
user environment. Neither platform offers a general encrypted-history export.

A missing, inaccessible or invalid key, failed authentication, unsafe file,
or unknown encrypted format blocks durable history loading/writing. Existing
frontend settings/read-error gates remain in force, so dictations can remain
memory-only while storage is unavailable. Files are preserved; there is no
automatic reset or archive restoration. **Recovery needs the original usable
protected key** (the macOS Keychain item or Windows DPAPI blob and user
environment). History-file backups alone are not sufficient. Do not delete or
replace the key as a troubleshooting step. Keep recoverable files and seek
help if access cannot be restored.

### Upgrade and archival backups

Supported old plaintext history (versions 1 and 2) remains readable. Before
rewriting it, Voxloom preserves its **original bytes** in an encrypted backup,
including fields that a later schema migration might discard. The active
file becomes encrypted on the normal safe save; settings/history errors that
block saving also defer that active conversion. Older app versions cannot
read the encrypted format and should refuse it rather than overwrite it.

Owned old `history.json.unreadable-<timestamp>[-N].bak` files are encrypted in
place, preserving even corrupt or non-UTF8 bytes. Legacy `history.json.tmp`
is preserved in an encrypted quarantine backup and removed only after that
backup is durable. It is **never restored as active history**, even if the
primary is missing. Empty or authenticated encrypted staging files are removed,
never restored. Recognizable damaged current-format staging is preserved
byte-for-byte inside an encrypted quarantine before removal; ambiguous short
headers, plaintext staging and unknown/future formats still block storage and
remain untouched. Recognized encrypted envelopes and identifiable current-writer
truncations can be preserved as opaque copies, without claiming authentication.
Encryption-marker words alone do not prove a file is ciphertext. Ambiguous
originals need an existing usable key for exact-byte encrypted preservation;
otherwise backup is refused and the original stays in place. Suspected ciphertext
never authorizes creating a replacement key. Existing ambiguous archives remain
fail-closed rather than being accepted as encrypted duplicates.
Migration is restartable per file, not atomic across the whole folder. An
unreadable, unknown or unsafe artifact causes an error/incomplete protection;
its original stays in place and may still be plaintext. No automatic process
can retroactively encrypt external backups or old sync copies.

If a side file stops history loading or saving, the error identifies its type
and its generated filename when safe to display. Unrecognized names are redacted;
file contents, keys and the full folder path are not included. Quit Voxloom,
back up the history folder, and seek recovery help before changing anything.
Do not delete suspect files or reset the protected key. An error does not mean
the whole folder was rolled back: earlier per-file migrations may have completed.

Windows uses same-directory native rename plus explicit file-data/metadata
flushes, including when reusing a previously published archive or key. Flush
failures stop migration rather than authorizing source removal. This is not a
portable directory-fsync or whole-volume power-loss guarantee: an interrupted
legacy temporary-file deletion may reappear and require migration again.
No storage backend can promise physical media persistence if the device or
filesystem does not honor flushes; actual power-loss behavior is not tested.

History archives can contain raw and final text, metadata, deleted rows and
expired transcripts. **Retention and row deletion do not prune archives.**
History read failures do not trigger another automatic backup or protected-key
access attempt. The active file stays in place and history writes remain blocked;
the error reports an intentional skip, not a failed backup or successful recovery.
Frontend parse errors, explicit backups and preservation before a supported
migration retain their own backup gates, subject to the ambiguity rules above.
Settings/dictionary upgrade and unreadable-file backups are still byte-exact
plaintext copies, separate from these history rules.

## Deleting transcripts

- **One transcript:** History → the row's **Delete transcript** (trash) button.
- **Clear active history, and stop keeping new transcripts:** Settings → Privacy →
  **Transcript retention → Off** rewrites the active history with no records
  (encrypted on macOS and Windows). Already-loaded transcripts remain visible in History
  and Home, in memory only, until restart. Off does not delete the history key
  or archives. If settings/history cannot be read, the existing error gate
  prevents this rewrite; it must not erase unavailable history.
- **Keep only recent ones:** **30 days** drops older active records on every
  save and launch. **Forever** keeps active records until you delete them.
- **Remove local history files manually:** quit Voxloom first, then remove
  `history.json`, its `history.json.unreadable-*.bak` archives and any legacy
  `history.json.tmp` or `history.json.encrypted-*.tmp` files from the folder
  above. A missing primary is empty history, never an invitation to restore an
  archive; encrypted artifacts still require their original key. Preserve any
  files you want to recover before manual removal. Deleting the entire folder
  also removes settings, dictionary words and downloaded models.

File removal does not erase copies captured by Time Machine, other backup or
sync tools, nor promise forensic erasure on SSDs. Encryption cannot retract
transcripts already copied or inserted elsewhere. For the format and recovery
invariants, see [Contributing](CONTRIBUTING.md#history-encryption-and-recovery).

## Accessibility

With Accessibility permission, Voxloom inserts the transcript into the focused
field by writing it as the field's selected text. To do that safely it reads:

- the focused app's name, and the focused element's role, subrole and whether
  it has a DOM identifier, to find the right field;
- the focused element's value, to check the text was inserted;
- the window title, the document path (`AXDocument`) and, in browsers, the
  page URL (`AXURL`), to notice when the target has changed.

None of this is saved. With clipboard fallback on (the default), Voxloom
usually inserts by pasting through the clipboard instead; see Clipboard below.
With fallback off, it inserts through Accessibility only and never touches the
clipboard.

The same permission lets Voxloom watch for its own keys: Esc while you
dictate, a single-key shortcut (such as right ⌥ or F13), and the key release
that ends a hold-to-talk. Voxloom only compares each key event with its
shortcut, then passes it on to your apps unchanged; the one exception is Esc,
which is held back only to cancel a dictation in progress. A single-key
shortcut also notes mouse clicks, so a key held for a click (such as ⌥-click)
isn't taken for the shortcut; it doesn't record where or what you clicked, and
passes the click on unchanged. No keystrokes or clicks are saved or sent
anywhere. Voxloom does not use the Input Monitoring permission.

## Clipboard

Clipboard fallback is on by default. Turn it off in Settings if the details
below matter to you.

**Paste is the default route.** With fallback on, Voxloom inserts your
dictation by pasting it into the app that was in front when you finished
speaking, in any app, before it tries writing through Accessibility. To do
that it:

1. puts the transcript on the clipboard,
2. presses ⌘V, and
3. after about 1.5 seconds (`CLIPBOARD_RESTORE_DELAY_MS`, 1500 ms), puts your
   previous clipboard back (every item and type), unless you copied something
   in the meantime.

If Voxloom can't paste safely, it copies the transcript to the clipboard
instead, where other apps and clipboard managers can read it, and you press
⌘V yourself.

**Clipboard privacy.**
- While the transcript is on the clipboard, any app or clipboard manager that
  is watching it can read it. Voxloom marks it Transient, Concealed and
  AutoGenerated and keeps it on this Mac only (it doesn't sync through
  Universal Clipboard). Those markers are advisory: managers that honor them
  skip the transcript, but some may still record it.
- Your restored clipboard is also kept on this Mac only, so it doesn't sync
  through Universal Clipboard either.

**Limits.**
- Voxloom doesn't paste into fields that macOS marks as secure. Some password
  fields in browsers and other apps aren't marked secure, and Voxloom may paste
  into them. Turn fallback off, or don't dictate into those fields.
- If you press ⌘V yourself during the 1.5 seconds, you paste the dictation. A
  very slow app may paste your restored clipboard instead of the dictation.
- The only key press Voxloom sends for a paste is ⌘V; it never presses Return or Send.

If clipboard fallback is off, the paste route doesn't run: nothing touches
the clipboard and the text stays in History.

## macOS private API (`macOSPrivateApi`)

`src-tauri/tauri.conf.json` sets `app.macOSPrivateApi: true` (and Cargo
enables Tauri's `macos-private-api` feature).

- **Why:** the floating dictation waveform (`src-tauri/src/overlay.rs`) is a
  transparent, non-focusable window. On macOS, Tauri can only make a webview
  window transparent through non-public AppKit/WebKit APIs, which this flag
  turns on. It is still needed while the overlay is transparent.
- **Implications:**
  - Voxloom **can't be distributed through the Mac App Store**; App Review
    rejects apps that use private APIs. Direct download (Developer ID signed
    and notarized) is unaffected.
  - Private APIs can change or break in a macOS update without notice, so the
    overlay's transparency should be re-checked on each new macOS release.
  - It does not grant extra permissions. Microphone and Accessibility access
    still go through the normal macOS privacy prompts.
- **To drop it:** make the overlay an opaque window (or a native panel), then
  remove the flag and the Cargo feature.
