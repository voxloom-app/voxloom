//! The optional higher-quality cleanup model (BUS-229): Qwen3-4B-Instruct-2507
//! Q4_K_M GGUF, offered beside the 0.6B default (pin.rs) everywhere except
//! Windows (catalog.rs, BUS-247).
//!
//! The download URL is pinned to an immutable Hugging Face commit of
//! `unsloth/Qwen3-4B-Instruct-2507-GGUF`; the SHA-256 is that file's LFS oid
//! there. Instruct-only (no thinking mode): the worker's ChatML template
//! already sends it no think block (worker/src/template.rs).
//! Qwen3 by Alibaba Cloud (Qwen team), Apache-2.0; GGUF by Unsloth.

pub const MODEL_ID: &str = "qwen3-4b-instruct-2507-q4-k-m";
pub(super) const MODEL_FILE: &str = "qwen3-4b-instruct-2507-q4-k-m.gguf";
pub(super) const MODEL_SHA256: &str =
    "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597";
pub(super) const MODEL_SIZE: u64 = 2_497_281_120;

/// Pinned `unsloth/Qwen3-4B-Instruct-2507-GGUF` commit. Changing it means
/// re-reading the file's size and LFS oid at the new commit.
#[allow(dead_code)] // Read by the pin test; documents MODEL_URL.
pub(super) const MODEL_REVISION: &str = "a06e946bb6b655725eafa393f4a9745d460374c9";
pub(super) const MODEL_URL: &str = "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_is_pinned_to_the_revision_and_file() {
        assert!(MODEL_URL
            .starts_with("https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/"));
        assert!(MODEL_URL.contains(&format!("/resolve/{MODEL_REVISION}/")));
        assert!(MODEL_URL.ends_with("/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"));
        assert_eq!(MODEL_REVISION.len(), 40);
        assert_eq!(MODEL_SHA256.len(), 64);
        assert!(MODEL_SHA256
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(MODEL_SIZE, 2_497_281_120);
    }
}
