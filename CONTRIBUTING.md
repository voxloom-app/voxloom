# Contributing to Voxloom

[Back to Voxloom](README.md)

## Local setup

Use Node 24, matching CI, and install the locked dependencies:

```sh
npm ci
npm run dev
```

Open `http://localhost:1420`. The browser preview uses synthetic capture,
transcription and focused-window shortcuts, and clears state on reload.
It cannot complete real guided setup or verify native microphone, permissions,
inference or insertion. Development scenario controls are excluded from
production builds.

The desktop app persists Settings, History and the Word dictionary in app data.
See [Privacy](PRIVACY.md) before working with real user data, and follow the
[store compatibility rules](#store-backwards-compatibility-rule) below.

## macOS desktop

The parent app requires macOS 13.1 or later. Its system WKWebView needs the
WebKit features available with Safari 16.2, including `color-mix()`, `:has()`,
`Array.prototype.at()` and `inert`. The minimum is declared in
`src-tauri/tauri.conf.json` → `bundle.macOS.minimumSystemVersion`.

Install Rust, the macOS/Xcode build tools and CMake. To run the desktop shell
without real Whisper linkage:

```sh
npm run tauri -- dev
```

For local Whisper transcription:

```sh
brew install cmake # if missing
npm run tauri -- dev -- --features whisper
```

Models still require an explicit download in the app. See
[Models and word dictionary](docs/models.md) for engine behavior and limits.

### Parakeet helper

Parakeet requires Apple Silicon/macOS 14+ and a Swift 6.2+ build toolchain.
Build the helper first, substituting the target architecture as needed:

```sh
bash scripts/release/build-parakeet-worker.sh aarch64-apple-darwin
npm run tauri -- dev -- --features whisper
```

### Packaged app and permissions

Development runs under a Tauri helper, so macOS may attribute Microphone
permission to your terminal rather than Voxloom. Use a packaged app to check
its actual permission identity:

```sh
# Microphone/UI smoke build; no real Whisper inference or bundled sidecars.
npm run tauri -- build --bundles app

# Whisper-enabled build; still not a complete worker-equipped release.
npm run tauri -- build --bundles app -- --locked --features whisper

npm run macos:assert-entitlements
```

Without an explicit target or custom target directory, the app is at
`src-tauri/target/release/bundle/macos/Voxloom.app`. After opening it and
requesting microphone access, check that Voxloom appears in System Settings →
Privacy & Security → Microphone. Accessibility is also required; Input
Monitoring is not used.

The ad-hoc signing identity (`"-"`) ensures Tauri embeds
`src-tauri/Entitlements.plist`. If the entitlement check fails,
`npm run macos:assert-entitlements -- --repair` re-signs the app. Developer ID
configuration and notarization are described in [macOS signing](docs/macos-signing.md).
Changing signing identity can affect existing permission grants.

### Complete release-style build

Use the worker-aware scripts to include both cleanup and Parakeet helpers,
with their notices. A plain Whisper-enabled Tauri build omits these sidecars.
For a universal build, install both Rust targets first:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
bash scripts/release/build-macos.sh universal-apple-darwin
bash scripts/release/bundle-macos.sh universal-apple-darwin
```

The first script compiles without Apple signing variables. The second bundles
without compiling and uses the configured signing/notarization credentials,
or ad-hoc signing when they are absent. Explicit-target output is under
`src-tauri/target/<target>/release/bundle/` unless `CARGO_TARGET_DIR` overrides it.
Building an app is separate from installing it or changing OS permissions.

## Checks

Frontend checks, after `npm ci`:

```sh
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright install chromium
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm run test:e2e:release
```

`npm run build` also runs TypeScript checking. ESLint uses single-quoted
ordinary strings and semicolons in JS/TS; JSX attribute quotes remain double.
The release browser suite serves the production build rather than dev scenarios.

Native app checks, on a host with the required platform dependencies:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
cargo test --manifest-path src-tauri/Cargo.toml --locked --features whisper --lib
```

Worker checks (the Rust worker has its own lockfile; Swift tests use mocked
loaders and do not download weights):

```sh
cargo test --manifest-path src-tauri/worker/Cargo.toml --locked
swift test --package-path src-tauri/parakeet-worker --disable-automatic-resolution
```

The [main CI workflow](.github/workflows/ci.yml) covers browser checks, Rust
checks/tests, Whisper-feature builds, both helpers and Cargo audits, including
macOS native tests. The [Windows workflow](.github/workflows/windows.yml)
checks/builds native x64 MSVC code with CPU Whisper; it does not launch the
app, provision models or prove working end-to-end Windows dictation.

Automated checks do not establish live microphone, Accessibility, shortcut,
insertion or permission behavior. Report those on-device checks separately.
For documentation-only changes, check links, commands, Markdown rendering and
`git diff --check`; a full app build is not needed.

## Store backwards-compatibility rule

Voxloom keeps user data in stores (`settings.json`, `history.json`,
`dictionary.json`). History's inner JSON schema is independent of its macOS
encryption envelope. Any change to these stores must stay backwards compatible:

1. **Every new setting or store field has a default.** A file written before
   the field existed must load with that default filled in.
2. **Older files are always read and migrated, never rejected.** Bump the
   file `version` when the shape changes, and add a migration from every
   earlier version. Never treat an older version as unreadable.
3. **Unknown keys in `settings.json`'s `settings` object are kept.** Other
   stores keep only known fields, so back up before any rewrite that drops
   data.
4. **Settings and dictionary may be reset only after a byte-exact backup
   succeeds.** History that can't be read is never written. With no backup,
   leave the file untouched.
5. **Add a test with a fixture from the previous version** (see
   `tests/fixtures/history-v2.json` and `tests/unit/historyVersionCompat.test.tsx`).
6. **Files from a newer or unknown version are left untouched and writes
   stay blocked.** A known sibling version (history v2) is migrated only
   after a backup.

Why: BUS-42. A history file saved in a newer sibling version by an unmerged branch was
rejected as unreadable, and History came up empty.

## History encryption and recovery

`history_load`, `history_save` and `store_backup({ store: 'history' })` keep
their IPC contract. The shared macOS/Windows native boundary encrypts the entire serialized
history document using ring AES-256-GCM. The outer JSON has `format` =
`voxloom-history-encrypted`, `envelopeVersion` = 1, `algorithm` = `AES-256-GCM`,
`role` (`history` or `preservation`), a base64 12-byte nonce, and base64
ciphertext including the 16-byte tag. The fixed format/version/algorithm/role
header is authenticated. It deliberately has no inner `version` or `records`,
so older plaintext readers reject it. Unknown older **and** newer envelope
versions block reads/writes; none predates envelope v1 in a shipped format.
Inner history v1/v2, retention, settings hydration and error gates are unchanged.

Each seal uses a fresh OS-random 96-bit nonce under a random 256-bit key: a
probabilistic bounded-volume policy, not a deterministic uniqueness guarantee.
Raw key bytes are never stored beside history. On macOS, the dedicated file-Keychain generic
password uses service `com.voxloom.prototype.history`, account `encryption-key`,
and the default file Keychain resolved once for matching read/add operations.
The adapter uses restricted lookup and **add-only** creation; do not substitute
`set_generic_password` (an upsert), change ACLs, or delete/reset the item.
Read back and validate the persisted key before encrypting. Missing keys with
ciphertext/unknown encrypted artifacts must never trigger reprovisioning.

Windows stores a per-directory key in `history.key.dpapi`, with a versioned
outer header, bounded blob and unkeyed corruption checksum, and a current-user
DPAPI-protected inner domain/key/SHA-256 payload. The checksum is not a same-user
authentication boundary. `CryptProtectData`/`CryptUnprotectData` use UI-forbidden flags, never
machine-wide scope. Validate the full decrypted payload, not a particular
tamper error code. Clear and `LocalFree` native outputs on every exit. Publish
the protected blob add-only, flush and read back the persistent winner before
using it; never recreate a missing key when any encrypted artifact survives.
This is user-account protection, not an app ACL or a same-user malware boundary.

Native transactions use an OS-backed `history.lock`, revalidate the current
source/schema and run filesystem/protected-key work on blocking workers, not the UI
thread. New same-directory staging is exclusive and ciphertext-only (0600 on
macOS; inherited user app-data ACLs on Windows). Reject nonregular files,
reparse/symlink artifacts and hard links using opened-handle information.
Verify, sync and publish atomically. A post-publication persistence failure
means changed-but-durability-uncertain, not "nothing changed." The lock orders
cooperating app processes; this is not protection from arbitrary same-user
malware changing files concurrently.

Keep native adapters separate from the shared codec/migration state machine.
macOS retains exclusive `renamex_np` publication and directory `fsync`.
Windows uses same-directory `MoveFileExW` (no copy fallback), with replacement
only when intended, and reopens the published regular file for a writable
`FlushFileBuffers` data/metadata fence. `MOVEFILE_WRITE_THROUGH` is not itself
a general directory `fsync`; explicit flushes also run before deduplicated
archive reuse and persisted-key use. Propagate unsupported/access/sharing/flush
errors. Windows does not promise durable deletion of a legacy tmp directory
entry or whole-volume power-loss recovery; a resurrected tmp must be migrated
again, never restored as active history. See Microsoft's File Caching and
CreateFileW/FlushFileBuffers/MoveFileExW API documentation for these boundaries.

Before a supported plaintext primary is rewritten, preserve its original bytes
in an encrypted archive. Migrate owned numeric `history.json.unreadable-*.bak`
names independently and restartably, including corrupt/non-UTF8 contents.
Quarantine legacy `history.json.tmp` before removing it; never restore stale
staging or archives. Normal retention/Off/delete does not prune archival copies
or delete their key. Unknown ciphertext stays opaque; a backup is never permission
to overwrite unreadable history. Recovery requires the original usable protected
key; do not advise key deletion, automatic reset or speculative restoration.
See [Privacy](PRIVACY.md#transcript-encryption-on-macos-and-windows) for limitations.

Linux explicitly retains existing plaintext storage; macOS and Windows have no
plaintext fallback. Dictionary/settings encryption is out of scope. Shared tests
inject synthetic key operations and execute on both native platforms. Windows
also tests actual current-user DPAPI against owned synthetic directories,
persisted-key restart/reuse, tamper/loss/access failure, migration and canaries.
Never run tests against personal data or the real macOS Keychain. Use a disposable
explicit `TMPDIR` on macOS; Windows tests create owned fixtures in its temp directory.
The encrypted fixture uses a public synthetic `[7; 32]` key and decrypts to
the existing v2 fixture. Signed-app Keychain approval and upgrade trust continuity
need a separately authorized isolated native acceptance check; unit tests do not
establish them.
Native Windows CI compilation/tests are required separately from macOS checks;
neither proves Windows GUI behavior or actual power-loss recovery.

## Releases

Release preparation belongs on a branch and through a PR, not a direct push
to `main`. `npm run release:bump -- <version>` updates the manifests and
lockfiles, creates a commit and creates a local `v<version>` tag; it requires
a clean worktree. If the PR merge changes commit identity, ensure the final
release tag points to the merged commit already on `main`, not the pre-merge
commit. Do not push or replace a tag without checking where it points.

A `v*` tag push triggers the [Release workflow](.github/workflows/release.yml),
which requires the tagged commit to be on `main` and enters the protected
`release` environment. It builds a universal `.dmg`, zipped `.app` and
`SHA256SUMS`, then creates a draft GitHub Release. Version consistency is
checked with `npm run release:check-version -- <tag>`.

Review the draft and its notes before publishing; the notes template is
[`.github/release-notes.md`](.github/release-notes.md). Signing/notarization
setup is in [macOS signing](docs/macos-signing.md). Without the required
credentials, builds are ad-hoc signed and labeled UNSIGNED.

For an ad-hoc test artifact without creating a release, run the Release
workflow manually. Manual runs do not receive release signing secrets.
Website changes belong in the separate
[voxloom-site repository](https://github.com/voxloom-app/voxloom-site).
