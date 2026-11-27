# Privacy and local data

Voxloom transcribes on your Mac. Nothing you dictate is sent to a remote
service. The only network traffic is a model download from Hugging Face, and
only when you start it: a Whisper model (see `src-tauri/src/stt/catalog.rs`)
or the optional local cleanup model (see
`src-tauri/src/cleanup/model_store/pin.rs`). Each URL is pinned to one
immutable Hugging Face revision, and the app checks the file's exact size and
SHA-256 before saving it; a mismatch saves nothing.

## Transcript encryption on macOS and Windows

The macOS and Windows apps encrypt the **whole saved history** with
AES-256-GCM: final and raw transcript text, cleanup details, status, duration,
model, timestamps and delivery outcomes. Recorded audio is never saved. While
the app runs, History, Home, Copy and retention work on decrypted data in
memory.

The app data folder is `~/Library/Application Support/com.voxloom.prototype/`
on macOS. On Windows it is the app's data folder under your user profile, not
the install folder. It contains:

```text
history.json                   encrypted history
history.key.dpapi              Windows only: the protected history key
history.json.unreadable-*.bak  encrypted backups of earlier history files
history.json.encrypted-*.tmp   encrypted leftovers of an interrupted save
history.lock                   transaction lock; no transcripts or keys
dictionary.json                custom words, not encrypted
settings.json                  preferences, not encrypted
*.json.unreadable-*.bak        settings/dictionary backups, not encrypted
models/                        downloaded Whisper models
cleanup-models/                downloaded cleanup model; no user data
```

**Linux history is not encrypted.** Settings, dictionary words and their
backups stay plaintext on every platform. Other processes running as your
user, or tools copying your home folder, can read those files.

### Key protection and limits

On macOS, the random history key is kept in a dedicated item in your default
file-based Keychain. Voxloom doesn't sync it. macOS may ask for approval when a
different build of the app tries to read it, depending on how it is signed. On
Windows, each app data folder gets its own random key, stored only as a
current-user DPAPI-protected file beside history; Windows doesn't prompt.

Both protect history at rest under your user account. They are not biometric
or hardware-bound protection, and they don't protect against a compromised app
or other software running as you; on Windows, any process running as you can
unprotect the key. Text you copy or insert into another app is outside this
protection. Encrypted history can't be exported, and copying it to another
machine or account doesn't make it readable there.

Voxloom never replaces an existing key, deletes it for retention, or falls back
to writing plaintext when the key can't be used. If the key is missing while
encrypted history exists, the key is inaccessible or invalid, a file fails
authentication, or a file is unsafe or in an unknown format, History stops
loading and saving and the files are left as they are. Dictation can continue, but new transcripts stay in memory only.
History backups alone can't restore history: they need the original key (the
macOS Keychain item, or on Windows the key file and the same Windows account).
Don't delete or replace the key to troubleshoot.

### If the history key is lost

If History reports that the original protected key is required and you can't
restore it, that history can't be decrypted. To start a new, empty history
without deleting anything:

1. Quit Voxloom.
2. Create a folder outside the app data folder, such as `voxloom-old-history`
   in your Documents folder.
3. Move every file whose name starts with `history` into it. On Windows this
   includes `history.key.dpapi`.
4. Start Voxloom. It saves new transcripts to a new, empty history.

Keep the moved files together. They become readable again only if the
original key is restored.

### Upgrade and archival backups

Earlier unencrypted history (versions 1 and 2) still loads. Before rewriting
it, Voxloom saves the original bytes in an encrypted backup, then encrypts the
active file on the next successful save. Older Voxloom versions can't read
encrypted history and should refuse it rather than overwrite it.

Existing `history.json.unreadable-*.bak` backups and any leftover
`history.json.tmp` are encrypted during the upgrade; a leftover file is never
restored as active history. The upgrade works one file at a time and resumes
after an interruption. A file that can't be read or has an unknown format
stays where it is, may still be unencrypted, and blocks History until it's
resolved. Encryption can't reach copies in external backups or sync folders.

If a side file blocks History, the error names its type and, when safe, its
filename, but never its contents, keys or the full folder path. Quit Voxloom,
back up the history folder and get recovery help before changing anything. An
error doesn't mean earlier per-file upgrades were undone.

History backups can contain raw and final text, metadata, deleted rows and
expired transcripts. **Retention and row deletion don't remove backups.** A
history read error doesn't create another backup; the file stays in place and
saving stays blocked. Settings and dictionary backups are plain copies,
separate from these rules.

For the storage format and recovery rules, see
[Contributing](CONTRIBUTING.md#history-encryption-and-recovery).

## Deleting transcripts

- **One transcript:** History → the row's **Delete transcript** (trash) button.
- **Clear active history, and stop keeping new transcripts:** Settings → Transcripts →
  **Transcript retention → Off** rewrites the active history with no records
  (encrypted on macOS and Windows). Already-loaded transcripts remain visible in History
  and Home, in memory only, until restart. Off does not delete the history key
  or backups. If settings or history can't be read, Voxloom doesn't do this
  rewrite, so unavailable history is never erased.
- **Keep only recent ones:** **30 days** drops older active records on every
  save and launch. **Forever** keeps active records until you delete them.
- **Remove local history files manually:** quit Voxloom first, then remove
  `history.json`, its `history.json.unreadable-*.bak` backups and any
  `history.json.tmp` or `history.json.encrypted-*.tmp` files from the folder
  above. A missing `history.json` starts an empty history; Voxloom never
  restores it from a backup. Keep any files you might want back. Deleting the
  entire folder also removes settings, dictionary words and downloaded models.

File removal does not erase copies captured by Time Machine, other backup or
sync tools, nor promise forensic erasure on SSDs. Encryption cannot retract
transcripts already copied or inserted elsewhere.

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
