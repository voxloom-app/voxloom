//! Shared macOS/Windows authenticated format and migration state machine.
use super::native_fs;
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
    fs::{self, File},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

const FORMAT: &str = "voxloom-history-encrypted";
const ALGORITHM: &str = "AES-256-GCM";
const HISTORY: &str = "history";
const PRESERVATION: &str = "preservation";
const PRIMARY: &str = "history.json";
const AUTH_FAILED: &str =
    "History authentication failed; files preserved; original protected key required";
/// Lost keys cannot be recovered. Moving every history file aside (on Windows
/// that includes the key blob) starts over without deleting anything.
pub(super) const KEY_LOSS_HELP: &str = "If the original key can't be restored, quit Voxloom and move every file named history* out of its data folder to start a new history";
pub(super) fn key_loss(reason: &str) -> String {
    format!("{reason}. {KEY_LOSS_HELP}")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArtifactKind {
    Primary,
    LegacyTmp,
    Backup,
    Staging,
}
fn artifact_kind(path: &Path) -> Option<ArtifactKind> {
    // Fold only owned ASCII filename syntax, never the actual entry path.
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if name == PRIMARY {
        Some(ArtifactKind::Primary)
    } else if name == "history.json.tmp" {
        Some(ArtifactKind::LegacyTmp)
    } else if backup_name(&name) {
        Some(ArtifactKind::Backup)
    } else if name.starts_with("history.json.encrypted-") && name.ends_with(".tmp") {
        Some(ArtifactKind::Staging)
    } else {
        None
    }
}

// Only fixed internal format/read errors belong here, never OS error text or
// file contents. Discovery is deliberately broader than safe diagnostic names.
fn sidefile_error(path: &Path, reason: &str) -> String {
    let category = match artifact_kind(path) {
        Some(ArtifactKind::Backup) => "archive",
        Some(ArtifactKind::Staging) => "staging file",
        Some(ArtifactKind::LegacyTmp) => "legacy temporary file",
        _ => return reason.to_owned(),
    };
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let folded = name.to_ascii_lowercase();
    let safe = match artifact_kind(path) {
        Some(ArtifactKind::LegacyTmp) => true,
        Some(ArtifactKind::Backup) => folded
            .strip_prefix("history.json.unreadable-")
            .and_then(|n| n.strip_suffix(".bak"))
            .is_some_and(|n| {
                let mut parts = n.split('-');
                let timestamp = parts.next().unwrap_or("");
                !timestamp.is_empty()
                    && timestamp.len() <= 39
                    && timestamp.bytes().all(|b| b.is_ascii_digit())
                    && parts.next().is_none_or(|suffix| {
                        !suffix.is_empty()
                            && suffix.len() <= 3
                            && suffix.bytes().all(|b| b.is_ascii_digit())
                            && suffix.parse::<u8>().is_ok_and(|n| (1..=100).contains(&n))
                    })
                    && parts.next().is_none()
            }),
        Some(ArtifactKind::Staging) => folded
            .strip_prefix("history.json.encrypted-")
            .and_then(|n| n.strip_suffix(".tmp"))
            .is_some_and(|n| {
                n.len() == 22
                    && n.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            }),
        _ => false,
    };
    let label = if safe {
        name
    } else {
        "[redacted history artifact]"
    };
    // Earlier independent per-file migrations may already have committed;
    // this is a refusal, not a promise that every folder entry is unchanged.
    let reason = reason.replace("; files preserved", "");
    format!("History {category} '{label}': {reason}. History loading and saving are blocked. Quit Voxloom, back up the history folder, and seek recovery help. Do not delete suspect files or reset the protected key.")
}

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
pub(super) fn open(key: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
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
        .map_err(|_| AUTH_FAILED.into())
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
// Conservative suspicion above fences key provisioning. Raw-copy permission
// is narrower: a complete, strictly encoded envelope (including future versions)
// or the current writer's complete header/payload prefix. Neither authenticates
// the bytes or grants permission to replace active history.
fn opaque_backup_encoding(bytes: &[u8]) -> bool {
    serde_json::from_slice::<Envelope>(bytes).is_ok_and(|e| {
        e.format == FORMAT
            && e.algorithm == ALGORITHM
            && matches!(e.role.as_str(), HISTORY | PRESERVATION)
            && STANDARD.decode(&e.nonce).is_ok_and(|v| v.len() == 12)
            && STANDARD
                .decode(&e.ciphertext)
                .is_ok_and(|v| v.len() >= aead::AES_256_GCM.tag_len())
    }) || (serde_json::from_slice::<serde_json::Value>(bytes).is_err()
        && current_staging_debris(bytes))
}

// Only the complete current header plus a strict writer-payload prefix can
// identify truncated ciphertext. Short/ambiguous headers, plaintext and future
// envelopes stay fenced. This is format recognition, NEVER authentication.
fn current_staging_debris(bytes: &[u8]) -> bool {
    if envelope(bytes).is_ok() {
        return true;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    [HISTORY, PRESERVATION].iter().any(|role| {
        let prefix = format!(
            "{{\"format\":\"{FORMAT}\",\"envelopeVersion\":1,\"algorithm\":\"{ALGORITHM}\",\"role\":\"{role}\",\"nonce\":\""
        );
        let Some(rest) = text.strip_prefix(&prefix) else { return false };
        let Some((nonce, payload)) = rest.split_once("\",\"ciphertext\":\"") else { return false };
        if !STANDARD.decode(nonce).is_ok_and(|v| v.len() == 12) {
            return false;
        }
        let payload = payload.strip_suffix('"').unwrap_or(payload);
        let unpadded = payload.trim_end_matches('=');
        payload.len() - unpadded.len() <= 2
            && unpadded.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/'))
    })
}

fn open_artifact(path: &Path) -> Result<File, String> {
    native_fs::open_regular(path, false)
        .map_err(|_| sidefile_error(path, "Cannot read history artifact; files preserved"))
}
fn read_regular(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    open_artifact(path)?
        .read_to_end(&mut bytes)
        .map_err(|_| sidefile_error(path, "Cannot read history artifact"))?;
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
        // Side files keep their own diagnostics; only the active document
        // gets key-loss guidance.
        open(key, bytes).map_err(|e| if e == AUTH_FAILED { key_loss(&e) } else { e })?
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
        native_fs::lock(&self.dir.join("history.lock"))
            .map_err(|_| "Cannot safely lock history transaction; files preserved".into())
    }
    /// Taken once per transaction, before any key access. Each artifact is
    /// opened and checked as a regular file; contents are read where used.
    fn artifacts(&self) -> Result<Vec<PathBuf>, String> {
        let mut paths = Vec::new();
        for entry in fs::read_dir(self.dir).map_err(|_| "Cannot inventory history artifacts")? {
            let entry = entry.map_err(|_| "Cannot inventory history artifacts")?;
            if artifact_kind(&entry.path()).is_some() {
                open_artifact(&entry.path())?;
                paths.push(entry.path());
            }
        }
        paths.sort();
        Ok(paths)
    }
    fn primary_path(&self, artifacts: &[PathBuf]) -> Result<PathBuf, String> {
        let mut primary = None;
        for path in artifacts {
            if artifact_kind(path) == Some(ArtifactKind::Primary) && primary.replace(path).is_some()
            {
                return Err("Ambiguous history primary names; files preserved".into());
            }
        }
        Ok(primary.cloned().unwrap_or_else(|| self.dir.join(PRIMARY)))
    }
    fn key(&self, artifacts: &[PathBuf]) -> Result<Zeroizing<Vec<u8>>, String> {
        let missing =
            || key_loss("History key missing; files preserved; original protected key required");
        let validate = |key: Vec<u8>| {
            let key = Zeroizing::new(key);
            if key.len() != 32 {
                return Err("History protected key is invalid; files preserved".into());
            }
            Ok(key)
        };
        if let Some(key) = self.keys.read()? {
            return validate(key);
        }
        // The filesystem's actual primary lookup is authoritative too: a
        // case alias must never permit provisioning before ciphertext is read.
        if read_optional(&self.dir.join(PRIMARY))?
            .as_deref()
            .is_some_and(encrypted_marker)
        {
            return Err(missing());
        }
        for path in artifacts {
            let bytes = read_regular(path)?;
            if encrypted_marker(&bytes) || artifact_kind(path) == Some(ArtifactKind::Staging) {
                return Err(missing());
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
    fn sync_dir(&self, published: &Path) -> Result<(), String> {
        self.checkpoint("directory-sync").map_err(|_| {
            "History changed but directory durability is uncertain; reload before retry"
        })?;
        native_fs::sync_publication(self.dir, published).map_err(|_| {
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
        let mut file = native_fs::create_new(&tmp)
            .map_err(|_| "Cannot create encrypted history staging file")?;
        let result = (|| {
            self.checkpoint("write")?;
            file.write_all(bytes)
                .map_err(|_| "Cannot write encrypted history staging file")?;
            self.checkpoint("sync")?;
            file.sync_all()
                .map_err(|_| "Cannot sync encrypted history staging file")?;
            self.checkpoint("verify")?;
            // Identical to the bytes authenticated above; no second decrypt.
            if read_regular(&tmp)? != bytes {
                return Err("Encrypted history staging verification failed".into());
            }
            self.checkpoint("publish")?;
            if read_optional(path)?.as_deref() != old {
                return Err("History changed during transaction; files preserved".into());
            }
            if old.is_some() {
                native_fs::publish(&tmp, path, true).map_err(|_| {
                    "Cannot confirm encrypted history replacement; reload before retry"
                })?;
            } else {
                if let Err(e) = native_fs::publish(&tmp, path, false) {
                    if e.kind() == ErrorKind::AlreadyExists {
                        return Ok(false);
                    }
                    return Err(
                        "Cannot confirm encrypted history publication; reload before retry".into(),
                    );
                }
                self.checkpoint("new-published")?;
            }
            self.sync_dir(path)?;
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
        self.preserve_bytes(key, bytes, false)
    }
    fn preserve_bytes(
        &self,
        key: Option<&[u8]>,
        bytes: &[u8],
        wrap: bool,
    ) -> Result<PathBuf, String> {
        for path in self.artifacts()? {
            if artifact_kind(&path) == Some(ArtifactKind::Backup) {
                let old = read_regular(&path)?;
                // A plaintext duplicate is not durable encrypted protection
                // (notably when legacy tmp sorts before archive migration).
                if encrypted_marker(&old) {
                    let duplicate = (!wrap && opaque_backup_encoding(&old) && old == bytes)
                        || match key {
                            Some(key) => {
                                open(key, &old).map_err(|e| sidefile_error(&path, &e))? == bytes
                            }
                            None => false,
                        };
                    if duplicate {
                        // A prior publication may have failed its directory
                        // sync. Visibility alone cannot authorize source loss.
                        let file = native_fs::open_regular(&path, true)
                            .map_err(|_| "Cannot open preserved history archive")?;
                        self.checkpoint("sync")?;
                        file.sync_all()
                            .map_err(|_| "Cannot sync preserved history archive")?;
                        self.sync_dir(&path)?;
                        return Ok(path);
                    }
                }
            }
        }
        let encrypted = if opaque_backup_encoding(bytes) && !wrap {
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
    /// Archive conversions are independently atomic and restartable. Staging
    /// is disposed only when empty/authenticated, or after exact current-format
    /// debris is durably wrapped in quarantine. Never restore or merge rows.
    fn migrate_archives(&self, key: &[u8], artifacts: &[PathBuf]) -> Result<(), String> {
        // Validate every side file before changing any. Encrypted archives
        // still authenticate on every transaction but need no further work.
        let mut pending = Vec::new();
        for path in artifacts {
            let kind = artifact_kind(path);
            if kind == Some(ArtifactKind::Primary) {
                continue;
            }
            let bytes = read_regular(path)?;
            if kind == Some(ArtifactKind::Staging) {
                if !bytes.is_empty()
                    && open(key, &bytes).is_err()
                    && !current_staging_debris(&bytes)
                {
                    return Err(sidefile_error(path, "Unsupported history staging format"));
                }
            } else if encrypted_marker(&bytes) {
                open(key, &bytes).map_err(|e| sidefile_error(path, &e))?;
                if kind == Some(ArtifactKind::Backup) {
                    continue;
                }
            }
            pending.push((path, kind));
        }
        for (path, kind) in pending {
            let bytes = read_regular(path)?;
            if kind == Some(ArtifactKind::Staging) {
                let authenticated = open(key, &bytes).is_ok();
                if !bytes.is_empty() && !authenticated && !current_staging_debris(&bytes) {
                    return Err(sidefile_error(path, "Unsupported history staging format"));
                }
                // Never store damaged ciphertext as an outer archive: wrap the
                // exact bytes so a later inventory can authenticate quarantine.
                let preserved = if bytes.is_empty() || authenticated {
                    self.dir.join("history.lock")
                } else {
                    self.preserve_bytes(Some(key), &bytes, true)?
                };
                self.checkpoint("remove-staging")?;
                if read_regular(path)? != bytes {
                    return Err("History staging changed; files preserved".into());
                }
                fs::remove_file(path)
                    .map_err(|_| "Cannot remove history staging; files preserved")?;
                self.sync_dir(&preserved)?;
            } else if kind == Some(ArtifactKind::LegacyTmp) {
                let preserved = self.preserve(key, &bytes)?;
                self.checkpoint("remove-legacy")?;
                if read_regular(path)? != bytes {
                    return Err(
                        "Legacy history temporary file changed; migration incomplete".into(),
                    );
                }
                fs::remove_file(path).map_err(|_| {
                    "Cannot remove preserved legacy history temporary file; migration incomplete"
                })?;
                self.sync_dir(&preserved)?;
            } else if kind == Some(ArtifactKind::Backup) && !encrypted_marker(&bytes) {
                let encrypted = seal_as(key, &bytes, PRESERVATION, self.entropy)?;
                self.write_encrypted(path, &encrypted, Some(&bytes), Some(key))?;
            }
        }
        Ok(())
    }
    pub fn backup(&self) -> Result<Option<PathBuf>, String> {
        let _lock = self.lock()?;
        let artifacts = self.artifacts()?;
        let path = self.primary_path(&artifacts)?;
        let Some(bytes) = read_optional(&path)? else {
            return Ok(None);
        };
        // Unknown ciphertext must remain opaque, even when the original key is
        // unavailable. A successful backup never authorizes active replacement.
        let backup = if opaque_backup_encoding(&bytes) {
            self.preserve_with_key(None, &bytes)?
        } else {
            let key = self.key(&artifacts)?;
            self.migrate_archives(&key, &artifacts)?;
            self.preserve(&key, &bytes)?
        };
        if read_optional(&path)?.as_deref() != Some(bytes.as_slice()) {
            return Err("History changed during backup; files preserved".into());
        }
        Ok(Some(backup))
    }
    pub fn save(&self, contents: &str) -> Result<(), String> {
        let _lock = self.lock()?;
        supported_document(contents.as_bytes())?;
        let artifacts = self.artifacts()?;
        let key = self.key(&artifacts)?;
        let path = self.primary_path(&artifacts)?;
        let old = read_optional(&path)?;
        if let Some(old) = &old {
            document(&key, old)?;
        }
        self.migrate_archives(&key, &artifacts)?;
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
        let artifacts = self.artifacts()?;
        let key = self.key(&artifacts)?;
        let bytes = read_optional(&self.primary_path(&artifacts)?)?;
        let plain = bytes.as_deref().map(|b| document(&key, b)).transpose()?;
        self.migrate_archives(&key, &artifacts)?;
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
