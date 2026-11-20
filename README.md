# Voxloom

Local dictation for macOS. Speak with a keyboard shortcut and put the text into
the app you're using, without sending your audio to a cloud transcription service.

[Download for macOS](https://github.com/voxloom-app/voxloom/releases/latest)
· [Release notes](https://github.com/voxloom-app/voxloom/releases)
· [Privacy](PRIVACY.md)
· [Contributing](CONTRIBUTING.md)

## What it does

- Hold your shortcut to talk, or double-tap for hands-free dictation.
- Transcribe on your Mac with Whisper, or optional Parakeet models on supported Macs.
- Insert text into other apps, with clipboard recovery when safe insertion isn't available.
- Keep names and specialist terms in a personal word dictionary.
- Optionally clean up punctuation and filler words with an on-device model.
- Review past transcripts in History and choose how long to keep them.

Voxloom is in active development. macOS is the supported release platform;
Windows has a native build/test foundation, but end-to-end dictation is not yet
verified there.

## Install

Requires macOS 13.1 (Ventura) or later, on Apple Silicon or Intel.
Parakeet models require Apple Silicon and macOS 14 or later.

1. Download the `.dmg` from the [latest release](https://github.com/voxloom-app/voxloom/releases/latest).
2. Open it and drag Voxloom to Applications.
3. Launch Voxloom and follow the guided setup: allow Microphone and
   Accessibility, download a speech model, choose a shortcut, and try both
   dictation gestures.

Setup recommends Whisper Base English (about 148 MB). Models download only
when you choose to start; they aren't bundled with the app. You don't need
Input Monitoring permission.

There is no automatic updater yet. Download new versions from the Releases page.

## Dictate

1. Focus the field where you want the text.
2. Hold your shortcut while speaking, then release it. Or double-tap to start
   hands-free recording and press it once more to stop.
3. Keep the destination focused while Voxloom finishes processing.

You can switch apps while recording or processing. Voxloom chooses the
intended destination when the final text is ready, not when recording starts.
It never presses Return or Send for you.

With Clipboard fallback on (the default), Voxloom usually inserts with a
short clipboard paste, then restores your previous clipboard after about
1.5 seconds unless you've copied something else. If the result is Copied,
paste it yourself. If it is Unverified, check the destination before trying
again so you don't insert the same text twice.

Avoid dictating into password fields or sensitive terminal prompts. macOS
doesn't identify every secure field, and terminal input can trigger actions
even without Return. See [dictation and insertion](docs/dictation.md) for
clipboard behavior, result meanings and limitations.

## Privacy

Speech recognition and optional cleanup run locally. Recorded audio is not
saved. Model downloads need an internet connection; dictation uses the installed
models on your Mac.

Saved transcripts are plain text, not encrypted by Voxloom. Clipboard managers
may also see text during insertion. Use Settings → Privacy to control transcript
retention, and read [Privacy and local data](PRIVACY.md) for deletion, backup
and clipboard details.

## Development and documentation

The app uses Tauri, React/TypeScript and Rust, with a Swift helper for Parakeet.

- [Contributing](CONTRIBUTING.md): local setup, builds, checks and releases.
- [Models and word dictionary](docs/models.md): model choices, downloads and recognition behavior.
- [Dictation and insertion](docs/dictation.md): targeting, delivery and recovery.
- [Architecture decisions](docs/decisions/): design rationale and historical implementation notes.

The website lives in a separate repository, [voxloom-site](https://github.com/voxloom-app/voxloom-site).

## License

[MIT](LICENSE). Bundled third-party notices are available in the app under
Settings → Privacy → Licenses.
