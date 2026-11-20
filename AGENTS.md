# Coding guidance

## Start here

- Keep [README.md](README.md) focused on installation and everyday use.
- Use [CONTRIBUTING.md](CONTRIBUTING.md) for setup, builds, checks and releases;
  [PRIVACY.md](PRIVACY.md) describes local data and its limitations.
- Read [docs/dictation.md](docs/dictation.md) before changing delivery and
  [docs/models.md](docs/models.md) before changing models or the dictionary.
- Architecture records in `docs/decisions/` can describe historical behavior.
  Check current callers and tests before treating an old design as a requirement.

## Repository map

- `src/`: React/TypeScript application, components, domain logic and services.
- `src-tauri/src/`: Rust commands, capture, speech engines, delivery and stores.
- `src-tauri/worker/`: local cleanup worker; it has its own Cargo lockfile.
- `src-tauri/parakeet-worker/`: Swift speech helper and its protocol tests.
- `tests/unit/`, `tests/e2e/`, `tests/fixtures/`: frontend tests and synthetic data.
- `scripts/release/`, `.github/workflows/`: packaging and CI/release orchestration.

## Preserve behavior and user data

- Select the destination when final text is ready, after transcription and
  optional cleanup. Switching apps during recording or processing is allowed.
  Revalidate before writing; never restore focus or synthesize Return/Send.
- Shared paste is generic, not an app allowlist. Preserve native retained
  app/window/observable-field authority, secure-target checks and clipboard
  ownership/restoration. Missing AX editability alone does not forbid paste.
- Lost, malformed or uncertain delivery replies are not verified insertion or
  evidence that nothing happened. Do not automatically retry, switch routes
  or overwrite the clipboard after input may have been dispatched.
- Treat known QA examples as samples, not the boundary of cross-app behavior.
  Cover the underlying policy and lifecycle rather than special-casing fixtures.
- Setup uses Microphone and Accessibility, not Input Monitoring. Keep model
  downloads explicit; do not download weights as a side effect of tests.
- Follow the [store compatibility rules](CONTRIBUTING.md#store-backwards-compatibility-rule)
  for Settings, History and the dictionary. Keep defaults, migrations, required
  backups, unknown-setting preservation and refusal to overwrite newer stores.
- Use synthetic test content. Do not expose personal transcripts, clipboard
  contents, credentials or machine-specific operational details in logs or docs.

## Verify the affected surface

Use Node 24 and the locked dependencies. Start with a regression that fails
for the behavior being changed, then run the relevant focused checks and the
shared frontend gates:

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

For UI changes, also run `npm run test:e2e` and `npm run test:e2e:release` as
appropriate. For native changes, run the Cargo formatting/tests and affected
worker checks in [CONTRIBUTING.md](CONTRIBUTING.md#checks), including the
Whisper feature when changing its shipped path. Keep lockfiles intentional.

Update command registration, `src-tauri/build.rs`, capabilities and native
permission tests together when adding or renaming an IPC command.

Browser previews and mocked tests do not prove native microphone, permission,
shortcut, inference or app-to-app insertion behavior. Report automated checks,
actual on-device evidence and untested cases separately. Documentation changes
need link/anchor, command, rendering and affected-test checks, not an unrelated
native rebuild.

Installing/restarting an app, changing OS permissions, downloading models and
publishing a release are separate from editing or validating source. Do not
perform them implicitly. Follow the documented release workflow; do not push
release changes directly to `main` or replace published tags as routine cleanup.
