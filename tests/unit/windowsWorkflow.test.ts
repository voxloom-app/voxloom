import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
interface Step {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}
interface Job {
  'runs-on'?: string;
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  defaults?: { run?: { shell?: string } };
  steps: Step[];
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}
const file = resolve(root, '.github/workflows/windows.yml');
const source = existsSync(file) ? readFileSync(file, 'utf8') : '';
const workflow = (parse(source) ?? {}) as Workflow;
const native = workflow.jobs?.['windows-x64'];

describe('Windows native build foundation', () => {
  it('links the Common Controls v6 manifest into native test artifacts', () => {
    const build = readFileSync(resolve(root, 'src-tauri/build.rs'), 'utf8');
    expect(build).toContain('cargo:rustc-link-arg=/MANIFEST:EMBED');
    expect(build).toContain('cargo:rustc-link-arg=/MANIFESTINPUT:');
    expect(build).toContain('WindowsAttributes::new_without_app_manifest()');
    expect(build).toContain('.app_manifest(tauri_build::AppManifest::new().commands(COMMANDS))');
    const manifest = readFileSync(resolve(root, 'src-tauri/windows-app-manifest.xml'), 'utf8');
    expect(manifest).toContain('name="Microsoft.Windows.Common-Controls"');
    expect(manifest).toContain('version="6.0.0.0"');
    expect(build).not.toContain('__TAURI_WORKSPACE__');
  });
  it('retains tamper-before-spawn policy on Windows, not only its Unix script fixture', () => {
    const ownership = readFileSync(resolve(root, 'src-tauri/src/cleanup/ownership/tests.rs'), 'utf8').replace(/\r\n/g, '\n');
    expect(ownership).not.toContain('#[cfg(unix)]\n#[test]\nfn tampering_after_admission_is_rejected_before_worker_spawn');
    expect(ownership).toContain('#[cfg(unix)]\n    write_executable(');
  });

  it('keeps portable Rust policy suites enabled while isolating Unix fixtures', () => {
    const read = (path: string) => readFileSync(resolve(root, 'src-tauri/src', path), 'utf8').replace(/\r\n/g, '\n');
    expect(read('cleanup/mod.rs')).toContain('#[cfg(test)]\nmod test_support;');
    expect(read('cleanup/ownership/mod.rs')).toContain('#[cfg(test)]\nmod tests;');
    expect(read('cleanup/supervisor/mod.rs')).toContain('#[cfg(all(test, unix))]\nmod tests;');
    expect(read('cleanup/supervisor/mod.rs')).toContain('#[cfg(test)]\nmod policy_tests;');
    expect(read('stt/store.rs')).toContain('#[cfg(test)]\nmod parakeet_tests;');
    expect(read('cleanup/ownership/tests.rs')).toContain('#[cfg(unix)]\n#[test]\nfn retiring_an_actual_worker_reaps_it_then_new_generation_runs');
    // Visible follow-ups must not replace portable missing/extra/hash/lease tests.
    expect(read('cleanup/supervisor/policy_tests.rs')).toContain('#[cfg(windows)]');
    expect(read('cleanup/supervisor/policy_tests.rs')).toContain('#[ignore = "Windows native fixture follow-up:');
    expect(read('stt/store/parakeet_tests.rs')).toContain('#[ignore = "Windows native fixture follow-up:');
    expect(read('stt/store/parakeet_tests.rs')).toMatch(/"missing",\s*"extra",/);
  });

  it('selects an explicit compatible libclang before any locked Whisper build', () => {
    const steps = native?.steps ?? [];
    const preflight = steps.findIndex((step) => step.run?.includes('LIBCLANG_PATH'));
    expect(preflight, 'explicit Windows libclang selection').toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(steps.findIndex((step) => step.run?.startsWith('cargo check')));
    const command = steps[preflight]?.run ?? '';
    expect(command).toContain('libclang.dll');
    expect(command).toContain('Test-Path');
    expect(command).toContain('clang version 20');
    expect(command).toContain('GITHUB_ENV');
    expect(command).toContain('cmake --version');
    expect(command).toContain('host: x86_64-pc-windows-msvc');
    expect(command).toContain('throw');
    expect(steps[preflight]?.if).toBeUndefined();
    expect(source).not.toContain('WHISPER_DONT_GENERATE_BINDINGS');
  });

  it('gates native MSVC default and shipping Whisper builds on locked checks and tests', () => {
    expect(native, 'Windows x64 native job is required').toBeDefined();
    expect(native?.['runs-on']).toBe('windows-2022');
    expect(native?.defaults?.run?.shell).toBe('pwsh');
    expect(native?.['timeout-minutes']).toBeGreaterThan(0);
    expect(native?.['timeout-minutes']).toBeLessThanOrEqual(90);
    const steps = native?.steps ?? [];
    const commands = steps.map((step) => step.run);
    for (const command of [
      'npm ci', 'npm run lint', 'npm run typecheck',
      'npm run test:unit -- tests/unit/windowsWorkflow.test.ts', 'npm run build',
      'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
      'cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets --target x86_64-pc-windows-msvc',
      'cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --target x86_64-pc-windows-msvc',
      'cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets --features whisper --target x86_64-pc-windows-msvc',
      'cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --features whisper --target x86_64-pc-windows-msvc',
      'cargo build --manifest-path src-tauri/Cargo.toml --locked --release --features whisper --target x86_64-pc-windows-msvc',
    ]) {
      const index = commands.indexOf(command);
      expect(index, command).toBeGreaterThan(-1);
      expect(steps[index]?.if, command).toBeUndefined();
      expect(steps[index]?.['continue-on-error'], command).toBeUndefined();
    }
    expect(commands.indexOf('npm run build')).toBeLessThan(commands.findIndex(
      (command) => command?.startsWith('cargo check'),
    ));
    expect(steps.find((step) => step.uses?.startsWith('actions/setup-node@'))?.with?.['node-version']).toBe('24');
    expect(steps.find((step) => step.uses?.startsWith('dtolnay/rust-toolchain@'))?.with?.targets).toBe('x86_64-pc-windows-msvc');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.on).toHaveProperty('pull_request');
    expect(workflow.on).toHaveProperty('push');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(native?.['continue-on-error']).toBeUndefined();
    for (const step of steps.filter((step) => step.uses)) {
      expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      expect(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')).toContain(step.uses);
    }
    expect(source).not.toMatch(/secrets\.|pull_request_target|--ignored|--skip|continue-on-error|contents: write|gh release|signing|upload-artifact/);
  });
});
