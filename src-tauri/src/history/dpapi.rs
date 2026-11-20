//! Current-user Windows DPAPI key storage. Not an app-exclusive boundary.
//! SystemKeys construction does no I/O; Store acquires history.lock before use.
use super::{dpapi_blob, encrypted::KeyOps, native_fs};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use std::{
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    ptr,
};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};
use zeroize::{Zeroize, Zeroizing};

const KEY_FILE: &str = "history.key.dpapi";

const PAYLOAD: &[u8] = b"voxloom-history-key-v1\0";
use dpapi_blob::MAX_BLOB;
const ERROR: &str = "History Windows protected key unavailable or invalid; files preserved";

struct Output(CRYPT_INTEGER_BLOB);
impl Drop for Output {
    fn drop(&mut self) {
        if !self.0.pbData.is_null() {
            // SAFETY: DPAPI owns this cbData-byte allocation and transfers
            // ownership to the caller; clear before freeing with LocalFree.
            unsafe {
                std::slice::from_raw_parts_mut(self.0.pbData, self.0.cbData as usize).zeroize();
                LocalFree(self.0.pbData.cast());
            }
        }
    }
}
fn crypt(input: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: input.len().try_into().map_err(|_| ERROR)?,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = Output(CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    });
    // Default scope is the current user. No UI, machine scope, prompt,
    // optional entropy, description allocation or credential management.
    // SAFETY: live buffers, null optional/reserved pointers; Output owns the
    // returned allocation on every exit. The API does not mutate input.
    let success = unsafe {
        if protect {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        } else {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        }
    };
    if success == 0 || output.0.pbData.is_null() || output.0.cbData as u64 > MAX_BLOB {
        return Err(ERROR.into());
    }
    // Unprotect's success alone is insufficient: caller validates the whole
    // inner payload/length/digest, without relying on a particular error code.
    Ok(Zeroizing::new(unsafe {
        std::slice::from_raw_parts(output.0.pbData, output.0.cbData as usize).to_vec()
    }))
}
fn protect(key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err(ERROR.into());
    }
    let mut plain = Zeroizing::new(PAYLOAD.to_vec());
    plain.extend_from_slice(key);
    let hash = digest::digest(&digest::SHA256, &plain);
    plain.extend_from_slice(hash.as_ref());
    let protected = crypt(&plain, true)?;
    dpapi_blob::encode(&protected).map_err(|_| ERROR.into())
}
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let protected = dpapi_blob::decode(bytes).map_err(|_| ERROR)?;
    let plain = crypt(protected, false)?;
    let end = PAYLOAD.len() + 32;
    if plain.len() != end + 32
        || !plain.starts_with(PAYLOAD)
        || digest::digest(&digest::SHA256, &plain[..end]).as_ref() != &plain[end..]
    {
        return Err(ERROR.into());
    }
    Ok(plain[PAYLOAD.len()..end].to_vec())
}

pub(super) struct SystemKeys {
    dir: PathBuf,
}
impl SystemKeys {
    pub fn new(dir: &Path) -> Result<Self, String> {
        Ok(Self {
            dir: dir.to_owned(),
        })
    }
}
impl KeyOps for SystemKeys {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        let path = self.dir.join(KEY_FILE);
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(ERROR.into()),
            Ok(_) => (),
        }
        let file = native_fs::open_regular(&path, true).map_err(|_| ERROR)?;
        let mut bytes = Vec::new();
        (&file)
            .take(MAX_BLOB + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ERROR)?;
        let key = Zeroizing::new(unprotect(&bytes)?);
        // Retry a previously uncertain key publication before using it to
        // create ANY ciphertext. The raw key is never a filesystem artifact.
        file.sync_all().map_err(|_| ERROR)?;
        native_fs::sync_publication(&self.dir, &path).map_err(|_| ERROR)?;
        Ok(Some(key.to_vec()))
    }
    fn add(&self, key: &[u8]) -> Result<(), String> {
        let bytes = protect(key)?;
        let mut id = [0; 16];
        SystemRandom::new().fill(&mut id).map_err(|_| ERROR)?;
        let tmp = self.dir.join(format!(
            "history.key.dpapi-{}.tmp",
            URL_SAFE_NO_PAD.encode(id)
        ));
        let path = self.dir.join(KEY_FILE);
        let mut file = native_fs::create_new(&tmp).map_err(|_| ERROR)?;
        let result = (|| {
            file.write_all(&bytes).map_err(|_| ERROR)?;
            file.sync_all().map_err(|_| ERROR)?;
            let mut readback = Vec::new();
            native_fs::open_regular(&tmp, false)
                .map_err(|_| ERROR)?
                .read_to_end(&mut readback)
                .map_err(|_| ERROR)?;
            if readback != bytes || Zeroizing::new(unprotect(&readback)?).as_slice() != key {
                return Err(ERROR.to_string());
            }
            match native_fs::publish(&tmp, &path, false) {
                Ok(()) => {
                    native_fs::sync_publication(&self.dir, &path).map_err(|_| ERROR.to_string())
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(()),
                Err(_) => Err(ERROR.to_string()),
            }
        })();
        drop(file);
        let _ = fs::remove_file(&tmp);
        result
    }
}

#[cfg(test)]
#[path = "dpapi_tests.rs"]
mod tests;
