# Models and word dictionary

[Back to Voxloom](../README.md) · [Build instructions](../CONTRIBUTING.md#macos-desktop)

## Choose a speech model

Settings → Models offers Whisper Tiny/Base, Whisper Large v3 Turbo (English),
and optional Parakeet Core ML models. New users start with Whisper Base English
(`whisper-base.en`, 147,964,211 bytes, shown as 148 MB); existing explicit
choices are preserved. Guided setup discloses and downloads the selected pack
when you choose to start. Selecting a model in Settings does not download it.
Model weights are not bundled with the app.

Unsupported or missing models never silently switch engines or trigger an
automatic download. Speech recognition stays local. See the
[local STT decision](decisions/local-stt-whisper.md) for the original rationale.

## Download verification and recovery

The Whisper catalog (`src-tauri/src/stt/catalog.rs`) pins each file to a fixed
Hugging Face revision, exact size and SHA-256. The shared native `model_fetch`
path verifies downloads before an atomic rename. A mismatch deletes the
partial file and reports `download-corrupted`; the Models tab offers Retry.
Sizes and hashes, not transcript contents, go to the native log.

Downloads use a shared HTTPS-only client that refuses redirects to HTTP, with
30-second connect and read timeouts and no overall transfer time limit.
Installed Whisper files are also checked in the background after launch.
Passing files receive a `<file>.verified` marker with hash, size and modified
time so unchanged files do not need hashing again. Dictation can continue
while the background check runs; a file that fails is kept but marked damaged
and is not used for transcription.

If a file cannot be opened, the UI shows "Couldn't open the model file" with
Retry. Dictation attempts to open it again and schedules another background
check once it opens. A file that opens but cannot be read during verification
stays failed until Retry download or the next launch.

## Whisper Large v3 Turbo

The converted `whisper-large-v3-turbo` model is 1,624,555,275 bytes (about
1.62 GB), verified against its pinned size and hash. This integration is
English-first; it does not enable automatic language detection or translation.

Turbo uses the same local Whisper transcription, dictionary, optional cleanup,
History and completion-time delivery paths as Tiny/Base. Download size is not
peak memory usage, and "Turbo" is not a speed guarantee over smaller models.
Measure memory and stop-to-text latency on the intended Mac.

macOS Whisper-feature builds include Metal acceleration, with CPU execution
when the GPU backend is unavailable. Turbo preparation and inference have
separate bounds from Tiny/Base and Parakeet. Explicit cancellation
cooperatively stops decoding, but synchronous model loading is not
interruptible: its reservation stays held until loading and context cleanup
finish. Superseded work may finish for History without delivering into
another field. This implementation does not add a resident-model cache.

OpenAI Whisper and whisper.cpp notices are bundled at
`licenses/whisper/THIRD-PARTY-NOTICES.txt` in the app resources.

## Parakeet (Core ML)

Parakeet v2 is English; Parakeet v3 is multilingual. Both require Apple Silicon
and macOS 14 or later. Whisper and the parent app retain the macOS 13.1/Intel
path. Multilingual recognition does not imply translation or a selectable
language-hint setting.

Each download contains a revision-pinned set of Core ML components and
vocabulary. The store verifies the set before publishing it. Transcription
uses FluidAudio's local-only loader, not automatic download/recovery APIs.
NVIDIA created the models; FluidInference provides the Core ML conversions
and Swift runtime. Notices are bundled under `licenses/parakeet-worker/`.

Preparation starts when dictation activates, independently of capture, and
the selected model is frozen for that recording. Completed audio waits for
readiness if necessary, then follows the dictionary, optional cleanup,
History and completion-time delivery flow. Audio does not pass through the UI.

The helper is created per recording and released afterward; this does not
promise that system-owned Core ML caches vanish immediately. Work is bounded
separately from Whisper, and a busy engine reports an error rather than
spawning unbounded workers. See [Contributing](../CONTRIBUTING.md#parakeet-helper)
for helper builds and tests.

## Optional local cleanup

Experimental cleanup fixes punctuation and drops filler words on the Mac.
If cleanup fails or its output changes the words beyond the permitted checks,
Voxloom uses the original transcript.

Settings → Cleanup model offers Download (397 MB). The pinned model is
Qwen3 0.6B Q4_K_M, a 396,705,472-byte GGUF from `unsloth/Qwen3-0.6B-GGUF`.
Its revision, size and hash are in
`src-tauri/src/cleanup/model_store/pin.rs`. The same HTTPS-only `model_fetch`
path writes a `.partial` file, verifies it and renames it into place.
A failed/cancelled/mismatched download leaves no new model and does not touch
an installed one; retries start from zero. A matching model imported by an
earlier version is still recognized at the same path.

Cleanup needs both the verified model and a build containing the cleanup
worker. Plain Whisper-only builds do not include that worker.

Qwen3 is by Alibaba Cloud's Qwen team, under
[Apache-2.0](https://huggingface.co/Qwen/Qwen3-0.6B/blob/main/LICENSE);
the GGUF conversion is by Unsloth.

## Word dictionary

Add names and specialist terms in their correct spelling, such as `Voxloom`.
The dictionary stays on the Mac and works in several ways:

- With cleanup on or off, deterministic matching restores saved spelling
  (`voxloom` → `Voxloom`) and can join split words whose letters match an entry
  (`vox loom` or `vox-loom` → `Voxloom`). Longest whole-word matches win.
  Code, backticked text, hyphenated identifiers, paths, URLs and flags are left
  alone. Pronoun/negation guards avoid joins such as `my cell` → `Mycell` or
  `her mes` → `Hermes`; entries with inner capitals still match their parts,
  as in `you tube` → `YouTube`. Phrases like `sales force` → `Salesforce` are
  intentional; remove the entry to opt out.
- Whisper also receives recent dictionary words as an initial prompt
  (`Glossary: Word, Word.`), cut at a whole entry near 220 tokens. Empty
  dictionaries and audio classified as quiet use no prompt. The hint may help
  recognize a phrase such as "box loom" as a saved word.
- With local cleanup enabled, the model may fix a near miss from context,
  subject to output validation. One spoken word may differ by one letter;
  two letters are permitted only for two or three spoken words representing
  a saved word of at least seven letters. Plain real words, common-word
  targets, inflection-only changes and equally good competing dictionary
  matches are excluded. Invalid output falls back to the original transcript;
  valid near-miss correction is still best effort.

The cleanup prompt includes at most 64 dictionary words, 2 KB in total and
128 bytes per word. These are prompt limits, not a cap on the saved dictionary.
With no entries it uses `cleanup-v2`; dictionary context uses `cleanup-v3`.

`dictionary.json` retains its format. Words are stored oldest-added first
while the Dictionary UI lists them alphabetically. Older alphabetical files
load as they are. Recognition hints use newest-added words first and do not
change Settings or History formats.
