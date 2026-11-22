import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';

describe('native encrypted history platform routing', () => {
  it('uses the same encrypted engine on macOS and Windows, never the plaintext adapter', () => {
    const source = read('src-tauri/src/history.rs');
    expect(source).toContain('#[cfg(any(target_os = "macos", target_os = "windows"))]\nmod encrypted;');
    expect(source).toContain('#[cfg(not(any(target_os = "macos", target_os = "windows")))]\nmod plain;');
    expect(source).toContain('dpapi::SystemKeys::new(dir)');
    expect(read('src-tauri/src/store_backup.rs')).toContain('#[cfg(any(target_os = "macos", target_os = "windows"))]\n    if store == "history"');
  });

  it('wires native current-user DPAPI and real publication fences, not plaintext or a no-op sync', () => {
    const keys = read('src-tauri/src/history/dpapi.rs');
    expect(keys).toContain('CryptProtectData(');
    expect(keys).toContain('CryptUnprotectData(');
    expect(keys).toContain('CRYPTPROTECT_UI_FORBIDDEN');
    expect(keys).not.toContain('CRYPTPROTECT_LOCAL_MACHINE');
    expect(keys).toContain('LocalFree(');
    expect(keys).toContain('Zeroizing');
    const files = read('src-tauri/src/history/native_fs_windows.rs');
    expect(files).toContain('FILE_FLAG_OPEN_REPARSE_POINT');
    expect(files).toContain('GetFileInformationByHandle(');
    expect(files).toContain('MoveFileExW(');
    expect(files).toContain('MOVEFILE_WRITE_THROUGH');
    expect(files).not.toContain('MOVEFILE_COPY_ALLOWED');
    expect(files).toContain('open_regular(published, true)?.sync_all()');
  });
});
