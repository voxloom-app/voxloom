//! macOS whole-document history encryption. No system key operations in tests.
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

const FORMAT: &str = "voxloom-history-encrypted";
const ALGORITHM: &str = "AES-256-GCM";
const HISTORY: &str = "history";
const PRESERVATION: &str = "preservation";
const PRIMARY: &str = "history.json";

pub(super) trait KeyOps {
    fn read(&self) -> Result<Option<Vec<u8>>, String>;
    /// Add only. A duplicate leaves the winner unchanged; read it back.
    fn add(&self, key: &[u8]) -> Result<(), String>;
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    format: String,
    envelope_version: u32,
    algorithm: String,
    role: String,
    nonce: String,
    ciphertext: String,
}
fn random(bytes: &mut [u8]) -> Result<(), String> {
    SystemRandom::new()
        .fill(bytes)
        .map_err(|_| "History encryption randomness unavailable".into())
}
fn cipher(key: &[u8]) -> Result<aead::LessSafeKey, String> {
    aead::UnboundKey::new(&aead::AES_256_GCM, key)
        .map(aead::LessSafeKey::new)
        .map_err(|_| "History key is invalid".into())
}
fn aad(role: &str) -> Vec<u8> {
    format!("{FORMAT}\0v1\0{ALGORITHM}\0{role}").into_bytes()
}
type Random = fn(&mut [u8]) -> Result<(), String>;
fn seal_as(key: &[u8], bytes: &[u8], role: &str, entropy: Random) -> Result<Vec<u8>, String> {
    // Probabilistic nonce policy: fresh OS-random 96 bits for every document
    // and archive, including across restarts. Never use counters/timestamps.
    let mut nonce = [0; 12];
    entropy(&mut nonce)?;
    let mut data = bytes.to_vec();
    cipher(key)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(role)),
            &mut data,
        )
        .map_err(|_| "History encryption failed".to_string())?;
    serde_json::to_vec(&Envelope {
        format: FORMAT.into(),
        envelope_version: 1,
        algorithm: ALGORITHM.into(),
        role: role.into(),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(data),
    })
    .map_err(|_| "History encryption format failed".into())
}
#[cfg(test)]
fn seal(key: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
    seal_as(key, bytes, HISTORY, random)
}
fn envelope(bytes: &[u8]) -> Result<Envelope, String> {
    let e: Envelope = serde_json::from_slice(bytes)
        .map_err(|_| "Unsupported encrypted history format; files preserved".to_string())?;
    if e.format != FORMAT
        || e.envelope_version != 1
        || e.algorithm != ALGORITHM
        || !matches!(e.role.as_str(), HISTORY | PRESERVATION)
    {
        return Err("Unsupported encrypted history format; files preserved".into());
    }
    Ok(e)
}
fn open(key: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
    let e = envelope(bytes)?;
    let nonce: [u8; 12] = STANDARD
        .decode(e.nonce)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("Invalid encrypted history nonce")?;
    let mut data = STANDARD
        .decode(e.ciphertext)
        .map_err(|_| "Invalid encrypted history encoding".to_string())?;
    cipher(key)?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(&e.role)),
            &mut data,
        )
        .map(|v| v.to_vec())
        .map_err(|_| {
            "History authentication failed; files preserved; original Keychain key required".into()
        })
}
fn encrypted_marker(bytes: &[u8]) -> bool {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
        // Inspect only the root: old rows can legitimately contain arbitrary
        // text or extension metadata that happens to name this format.
        return [
            "format",
            "envelopeVersion",
            "algorithm",
            "nonce",
            "ciphertext",
        ]
        .iter()
        .any(|k| value.get(k).is_some());
    }
    // Damaged/truncated envelope headers still require the original key.
    let text = String::from_utf8_lossy(bytes);
    text.trim_start().starts_with('{')
        && (text.contains(FORMAT) || text.contains("\"envelopeVersion\""))
}
fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot read history artifact; files preserved")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot inspect history artifact")?;
    if !meta.is_file() || meta.nlink() != 1 {
        return Err("Unsafe history artifact; files preserved".into());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| "Cannot read history artifact")?;
    Ok(bytes)
}
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => read_regular(path).map(Some),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Cannot inspect history artifact; files preserved".into()),
    }
}
fn supported_document(bytes: &[u8]) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "History is not valid JSON; files preserved")?;
    if !matches!(v.get("version").and_then(|v| v.as_f64()), Some(1.0 | 2.0))
        || !v.get("records").is_some_and(|v| v.is_array())
    {
        return Err("Unsupported history schema; files preserved".into());
    }
    Ok(())
}
fn document(key: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
    let plain = if encrypted_marker(bytes) {
        if envelope(bytes)?.role != HISTORY {
            return Err("History preservation archive is not active history".into());
        }
        open(key, bytes)?
    } else {
        // The existing frontend treats an empty/whitespace legacy file as an
        // empty store. Preserve its original bytes before the next rewrite.
        if std::str::from_utf8(bytes).is_ok_and(|s| s.trim().is_empty()) {
            return Ok(bytes.to_vec());
        }
        bytes.to_vec()
    };
    supported_document(&plain)?;
    Ok(plain)
}

pub(super) struct Store<'a> {
    dir: &'a Path,
    keys: &'a dyn KeyOps,
    entropy: Random,
    #[cfg(test)]
    io_fault: Option<&'a dyn Fn(&str) -> Result<(), String>>,
}
impl<'a> Store<'a> {
    pub fn new(dir: &'a Path, keys: &'a dyn KeyOps) -> Self {
        Self {
            dir,
            keys,
            entropy: random,
            #[cfg(test)]
            io_fault: None,
        }
    }
    fn checkpoint(&self, _stage: &str) -> Result<(), String> {
        #[cfg(test)]
        if let Some(hook) = self.io_fault {
            hook(_stage)?;
        }
        Ok(())
    }
    fn lock(&self) -> Result<File, String> {
        let path = self.dir.join("history.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)
            .map_err(|_| "Cannot open history transaction lock")?;
        let meta = file
            .metadata()
            .map_err(|_| "Cannot inspect history transaction lock")?;
        if !meta.is_file() || meta.nlink() != 1 {
            return Err("Unsafe history transaction lock".into());
        }
        file.lock().map_err(|_| "Cannot lock history transaction")?;
        let current = fs::symlink_metadata(path).map_err(|_| "History transaction lock changed")?;
        if current.dev() != meta.dev() || current.ino() != meta.ino() {
            return Err("History transaction lock changed".into());
        }
        Ok(file) // File drop releases the OS-backed cross-process lock.
    }
    fn artifacts(&self) -> Result<Vec<PathBuf>, String> {
        let mut paths = Vec::new();
        for entry in fs::read_dir(self.dir).map_err(|_| "Cannot inventory history artifacts")? {
            let entry = entry.map_err(|_| "Cannot inventory history artifacts")?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == PRIMARY
                || name == "history.json.tmp"
                || backup_name(&name)
                || (name.starts_with("history.json.encrypted-") && name.ends_with(".tmp"))
            {
                read_regular(&entry.path())?;
                paths.push(entry.path());
            }
        }
        paths.sort();
        Ok(paths)
    }
    fn key(&self) -> Result<Zeroizing<Vec<u8>>, String> {
        let artifacts = self.artifacts()?;
        let validate = |key: Vec<u8>| {
            let key = Zeroizing::new(key);
            if key.len() != 32 {
                return Err("History Keychain key is invalid; files preserved".into());
            }
            Ok(key)
        };
        if let Some(key) = self.keys.read()? {
            return validate(key);
        }
        for path in artifacts {
            let bytes = read_regular(&path)?;
            if encrypted_marker(&bytes)
                || path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("history.json.encrypted-")
            {
                return Err(
                    "History key missing; files preserved; original Keychain key required".into(),
                );
            }
        }
        let mut key = Zeroizing::new(vec![0; 32]);
        (self.entropy)(&mut key)?;
        self.keys.add(&key)?;
        validate(
            self.keys
                .read()?
                .ok_or("History key missing after creation")?,
        )
    }
    fn sync_dir(&self) -> Result<(), String> {
        self.checkpoint("directory-sync").map_err(|_| {
            "History changed but directory durability is uncertain; reload before retry"
        })?;
        File::open(self.dir)
            .and_then(|f| f.sync_all())
            .map_err(|_| {
                "History changed but directory durability is uncertain; reload before retry".into()
            })
    }
    /// All staging bytes are ciphertext; exclusive creation never follows a
    /// planted temporary path. None means create-only, including new primary.
    fn write_encrypted(
        &self,
        path: &Path,
        bytes: &[u8],
        old: Option<&[u8]>,
        key: Option<&[u8]>,
    ) -> Result<bool, String> {
        if let Some(key) = key {
            open(key, bytes)?;
        }
        let mut id = [0; 16];
        (self.entropy)(&mut id)?;
        let tmp = self.dir.join(format!(
            "history.json.encrypted-{}.tmp",
            URL_SAFE_NO_PAD.encode(id)
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&tmp)
            .map_err(|_| "Cannot create encrypted history staging file")?;
        let result = (|| {
            self.checkpoint("write")?;
            file.write_all(bytes)
                .map_err(|_| "Cannot write encrypted history staging file")?;
            self.checkpoint("sync")?;
            file.sync_all()
                .map_err(|_| "Cannot sync encrypted history staging file")?;
            self.checkpoint("verify")?;
            let staged = read_regular(&tmp)?;
            if staged != bytes {
                return Err("Encrypted history staging verification failed".into());
            }
            if let Some(key) = key {
                open(key, &staged)?;
            }
            self.checkpoint("publish")?;
            if read_optional(path)?.as_deref() != old {
                return Err("History changed during transaction; files preserved".into());
            }
            if old.is_some() {
                fs::rename(&tmp, path)
                    .map_err(|_| "Cannot replace encrypted history; original preserved")?;
            } else {
                use std::{ffi::CString, os::unix::ffi::OsStrExt};
                let from = CString::new(tmp.as_os_str().as_bytes())
                    .map_err(|_| "Invalid history staging path")?;
                let to = CString::new(path.as_os_str().as_bytes())
                    .map_err(|_| "Invalid history destination path")?;
                // macOS exclusive rename publishes one name atomically. A
                // link/unlink pair leaves an unreadable two-link crash state.
                // SAFETY: both C strings live through the call; no pointers
                // are retained. RENAME_EXCL never replaces a collision.
                if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } != 0 {
                    if std::io::Error::last_os_error().kind() == ErrorKind::AlreadyExists {
                        return Ok(false);
                    }
                    return Err("Cannot publish encrypted history; original preserved".into());
                }
                self.checkpoint("new-published")?;
            }
            self.sync_dir()?;
            Ok(true)
        })();
        drop(file);
        let _ = fs::remove_file(&tmp);
        result
    }
    fn preserve(&self, key: &[u8], bytes: &[u8]) -> Result<PathBuf, String> {
        self.preserve_with_key(Some(key), bytes)
    }
    fn preserve_with_key(&self, key: Option<&[u8]>, bytes: &[u8]) -> Result<PathBuf, String> {
        for path in self.artifacts()? {
            if backup_name(&path.file_name().unwrap().to_string_lossy()) {
                let old = read_regular(&path)?;
                // A plaintext duplicate is not durable encrypted protection
                // (notably when legacy tmp sorts before archive migration).
                if encrypted_marker(&old) {
                    let duplicate = old == bytes
                        || match key {
                            Some(key) => open(key, &old)? == bytes,
                            None => false,
                        };
                    if duplicate {
                        // A prior publication may have failed its directory
                        // sync. Visibility alone cannot authorize source loss.
                        let file = OpenOptions::new()
                            .read(true)
                            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
                            .open(&path)
                            .map_err(|_| "Cannot open preserved history archive")?;
                        let meta = file
                            .metadata()
                            .map_err(|_| "Cannot inspect preserved history archive")?;
                        if !meta.is_file() || meta.nlink() != 1 {
                            return Err("Unsafe history artifact; files preserved".into());
                        }
                        self.checkpoint("sync")?;
                        file.sync_all()
                            .map_err(|_| "Cannot sync preserved history archive")?;
                        self.sync_dir()?;
                        return Ok(path);
                    }
                }
            }
        }
        let encrypted = if encrypted_marker(bytes) {
            bytes.to_vec()
        } else {
            seal_as(
                key.ok_or("History key required for backup")?,
                bytes,
                PRESERVATION,
                self.entropy,
            )?
        };
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        for suffix in 0..=100 {
            let suffix = if suffix == 0 {
                String::new()
            } else {
                format!("-{suffix}")
            };
            let path = self
                .dir
                .join(format!("history.json.unreadable-{ms}{suffix}.bak"));
            if read_optional(&path)?.is_some() {
                continue;
            }
            if self.write_encrypted(&path, &encrypted, None, key)? {
                return Ok(path);
            }
        }
        Err("Too many history backup name collisions".into())
    }
    /// Archive conversions are independently atomic and restartable. Stale
    /// staging files are verified, never restored or merged into active rows.
    fn migrate_archives(&self, key: &[u8]) -> Result<(), String> {
        let artifacts = self.artifacts()?;
        for path in &artifacts {
            if path.file_name().unwrap() == PRIMARY {
                continue;
            }
            let bytes = read_regular(path)?;
            let staging = path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("history.json.encrypted-");
            if encrypted_marker(&bytes) || staging {
                open(key, &bytes)?;
            }
        }
        for path in artifacts {
            let name = path.file_name().unwrap().to_string_lossy();
            if name == PRIMARY {
                continue;
            }
            let bytes = read_regular(&path)?;
            if name == "history.json.tmp" {
                self.preserve(key, &bytes)?;
                self.checkpoint("remove-legacy")?;
                if read_regular(&path)? != bytes {
                    return Err(
                        "Legacy history temporary file changed; migration incomplete".into(),
                    );
                }
                fs::remove_file(&path).map_err(|_| {
                    "Cannot remove preserved legacy history temporary file; migration incomplete"
                })?;
                self.sync_dir()?;
            } else if backup_name(&name) && !encrypted_marker(&bytes) {
                let encrypted = seal_as(key, &bytes, PRESERVATION, self.entropy)?;
                self.write_encrypted(&path, &encrypted, Some(&bytes), Some(key))?;
            }
        }
        Ok(())
    }
    pub fn backup(&self) -> Result<Option<PathBuf>, String> {
        let _lock = self.lock()?;
        let Some(bytes) = read_optional(&self.dir.join(PRIMARY))? else {
            return Ok(None);
        };
        // Unknown ciphertext must remain opaque, even when the original key is
        // unavailable. A successful backup never authorizes active replacement.
        let backup = if encrypted_marker(&bytes) {
            self.preserve_with_key(None, &bytes)?
        } else {
            let key = self.key()?;
            self.migrate_archives(&key)?;
            self.preserve(&key, &bytes)?
        };
        if read_optional(&self.dir.join(PRIMARY))?.as_deref() != Some(bytes.as_slice()) {
            return Err("History changed during backup; files preserved".into());
        }
        Ok(Some(backup))
    }
    pub fn save(&self, contents: &str) -> Result<(), String> {
        let _lock = self.lock()?;
        supported_document(contents.as_bytes())?;
        let key = self.key()?;
        let path = self.dir.join(PRIMARY);
        let old = read_optional(&path)?;
        if let Some(old) = &old {
            document(&key, old)?;
        }
        self.migrate_archives(&key)?;
        if let Some(old) = &old {
            if !encrypted_marker(old) {
                self.preserve(&key, old)?;
            }
        }
        let encrypted = seal_as(&key, contents.as_bytes(), HISTORY, self.entropy)?;
        if !self.write_encrypted(&path, &encrypted, old.as_deref(), Some(&key))? {
            return Err("History changed during transaction".into());
        }
        Ok(())
    }
    pub fn load(&self) -> Result<Option<String>, String> {
        let _lock = self.lock()?;
        let key = self.key()?;
        let bytes = read_optional(&self.dir.join(PRIMARY))?;
        let plain = bytes.as_deref().map(|b| document(&key, b)).transpose()?;
        self.migrate_archives(&key)?;
        let Some(bytes) = bytes else { return Ok(None) };
        if !encrypted_marker(&bytes) {
            self.preserve(&key, &bytes)?;
        }
        String::from_utf8(plain.unwrap())
            .map(Some)
            .map_err(|_| "Invalid history text".into())
    }
}
fn backup_name(name: &str) -> bool {
    name.strip_prefix("history.json.unreadable-")
        .and_then(|n| n.strip_suffix(".bak"))
        .is_some_and(|n| {
            !n.is_empty()
                && n.split('-')
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        })
}
#[cfg(test)]
#[path = "encrypted_tests.rs"]
mod tests;
