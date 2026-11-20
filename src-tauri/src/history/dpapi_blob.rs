//! Bounded framing for the Windows DPAPI-protected history key blob.
//! Contains only OS-protected bytes, never the raw key.
//! The outer checksum detects accidental blob damage/trailing bytes. It is
//! not authentication against a same-user process; DPAPI protects the key.
pub(super) const HEADER: &[u8] = b"voxloom-dpapi-key\0\x01";
pub(super) const MAX_BLOB: u64 = 64 * 1024;
pub(super) fn encode(protected: &[u8]) -> Result<Vec<u8>, String> {
    if protected.is_empty() || protected.len() as u64 > MAX_BLOB - HEADER.len() as u64 - 32 {
        return Err("Invalid Windows protected key blob".into());
    }
    let mut bytes = HEADER.to_vec();
    bytes.extend_from_slice(protected);
    let hash = ring::digest::digest(&ring::digest::SHA256, &bytes);
    bytes.extend_from_slice(hash.as_ref());
    Ok(bytes)
}
pub(super) fn decode(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() <= HEADER.len() + 32
        || bytes.len() as u64 > MAX_BLOB
        || !bytes.starts_with(HEADER)
    {
        return Err("Invalid Windows protected key blob".into());
    }
    let end = bytes.len() - 32;
    if ring::digest::digest(&ring::digest::SHA256, &bytes[..end]).as_ref() != &bytes[end..] {
        return Err("Invalid Windows protected key blob".into());
    }
    Ok(&bytes[HEADER.len()..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versioned_blob_detects_every_single_byte_change_and_trailing_data() {
        let protected = b"synthetic OS-protected bytes, not a raw key";
        let bytes = encode(protected).unwrap();
        assert!(bytes.starts_with(HEADER));
        assert_eq!(decode(&bytes).unwrap(), protected);
        for at in 0..bytes.len() {
            let mut changed = bytes.clone();
            changed[at] ^= 1;
            assert!(decode(&changed).is_err(), "undetected byte {at}");
        }
        let mut extended = bytes.clone();
        extended.push(0);
        assert!(decode(&extended).is_err());
        for len in 0..bytes.len() {
            assert!(decode(&bytes[..len]).is_err());
        }
        let mut future = bytes.clone();
        future[HEADER.len() - 1] = 99;
        let end = future.len() - 32;
        let hash = ring::digest::digest(&ring::digest::SHA256, &future[..end]);
        future[end..].copy_from_slice(hash.as_ref());
        assert!(decode(&future).is_err());
        assert!(encode(&[]).is_err());
        assert!(encode(&vec![0; MAX_BLOB as usize]).is_err());
        assert!(decode(&vec![0; MAX_BLOB as usize + 1]).is_err());
    }
}
