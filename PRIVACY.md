# Privacy and local data

Voxloom transcribes on your Mac. Nothing you dictate is sent to a remote
service. The only network traffic is a model download from Hugging Face, and
only when you start it: a Whisper model (see `src-tauri/src/stt/catalog.rs`)
or the optional local cleanup model (see
`src-tauri/src/cleanup/model_store/pin.rs`). Each URL is pinned to one
immutable Hugging Face revision, and the app checks the file's exact size and
SHA-256 before saving it; a mismatch saves nothing.

## Transcripts are stored as plain text

The desktop app keeps its data as **unencrypted JSON** in its app data folder:

```text
~/Library/Application Support/com.voxloom.prototype/
├── history.json      final transcript text, raw transcript, cleanup metadata,
│                     status, duration, model, timestamp, delivery outcome
├── *.json.unreadable-*.bak  backups of a store file before an upgrade, or one
│                     Voxloom couldn't read (see below)
├── dictionary.json   your custom words (also given to the on-device cleanup
│                     model in its prompt; nothing is sent over the network)
├── settings.json     preferences
├── models/           downloaded Whisper model files (*.bin), and *.bin.verified
                      markers (pinned SHA-256, size, modified time; no user data)
└── cleanup-models/   the local cleanup model (qwen3-0.6b-q4-k-m.gguf), downloaded
                      (or imported by an earlier version); no user data
```

`history.json` is not encrypted. Any process running as your macOS user, and
anything that copies your home folder (Time Machine, other backup or sync
tools), can read your transcripts. FileVault protects it only while the Mac is
shut down; once you've logged in, a locked screen doesn't keep it from other
processes running as you. Recorded audio is never saved.

Each history row stores the **raw transcript** as well as the final text, even
when they are identical, plus **cleanup metadata**: whether optional local
cleanup ran (cleaned, fallback, skipped or unavailable), the cleanup model's
ID and digest, the prompt version, and a digest of your dictionary words.
The raw transcript is covered by the same retention and delete controls as
the final text.

## Deleting transcripts

- **One transcript:** History → the row's **Delete transcript** (trash) button.
- **All transcripts, and stop keeping them:** Settings → Privacy →
  **Transcript retention → Off**. `history.json` is rewritten with no records
  right away, and new dictations are not stored. Transcripts already loaded
  stay visible in History and Home (in memory only) until you restart Voxloom.
  If Voxloom couldn't load `history.json` (it shows an error banner), Off
  can't rewrite it; quit Voxloom and delete the files manually as below.
- **Keep only recent ones:** **30 days** drops older records on every save
  and on launch. **Forever** keeps everything until you delete it.
- **Everything, manually:** quit Voxloom and delete the folder above, or at
  least these files in it:
  - `history.json`
  - `*.unreadable-*.bak` (upgrade and unreadable-file backups, see below)
  - `history.json.tmp`, a temporary file a crash during save can leave behind.
    Nothing cleans it up automatically, and it may hold transcripts.

  A missing `history.json` is treated as empty history on next launch.
- **Upgrade and unreadable-file backups:** before Voxloom rewrites
  `history.json` or `settings.json` in a newer format, it copies the original
  to `<file>.unreadable-<timestamp>.bak` in the same folder. The first launch
  of a build with optional cleanup makes this **one-time upgrade backup** of
  both files. The same copy is made when a store file can't be read (corrupt,
  or from a different version), and that also applies to `dictionary.json`.
  These copies may hold old transcripts in plain text, and **retention never
  deletes them**. To remove them, quit Voxloom and delete them by hand, for
  example:
  `rm ~/Library/Application\ Support/com.voxloom.prototype/*.unreadable-*.bak`

Deleting a file does not remove copies already captured by backups.

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
