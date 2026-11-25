//! The cleanup models this build offers (BUS-229). Qwen3 0.6B is the
//! default everywhere; the 4B is an opt-in download, never offered on
//! Windows (BUS-247), so there it is unknown to status, download, delete
//! and lease alike.

use super::super::artifact::ArtifactSpec;
use super::{pin, pin_4b};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub(super) file: &'static str,
    pub(super) artifact: ArtifactSpec,
    pub(super) url: &'static str,
}

pub(super) const DEFAULT_MODEL: ModelSpec = ModelSpec {
    id: pin::MODEL_ID,
    file: pin::MODEL_FILE,
    artifact: ArtifactSpec {
        sha256: pin::MODEL_SHA256,
        size: pin::MODEL_SIZE,
    },
    url: pin::MODEL_URL,
};

pub(super) const QUALITY_MODEL: ModelSpec = ModelSpec {
    id: pin_4b::MODEL_ID,
    file: pin_4b::MODEL_FILE,
    artifact: ArtifactSpec {
        sha256: pin_4b::MODEL_SHA256,
        size: pin_4b::MODEL_SIZE,
    },
    url: pin_4b::MODEL_URL,
};

/// The models offered on `os` (`std::env::consts::OS`), default first.
pub(super) fn offered_on(os: &str) -> &'static [ModelSpec] {
    if os == "windows" {
        &[DEFAULT_MODEL]
    } else {
        &[DEFAULT_MODEL, QUALITY_MODEL]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_is_never_offered_the_4b() {
        assert_eq!(offered_on("windows"), &[DEFAULT_MODEL]);
    }

    #[test]
    fn macos_is_offered_both_with_the_default_first() {
        assert_eq!(offered_on("macos"), &[DEFAULT_MODEL, QUALITY_MODEL]);
    }

    #[test]
    fn this_build_offers_the_4b_unless_it_targets_windows() {
        let offered = offered_on(std::env::consts::OS);
        assert_eq!(
            offered.contains(&QUALITY_MODEL),
            !cfg!(target_os = "windows")
        );
    }

    #[test]
    fn the_models_have_distinct_ids_and_files() {
        assert_ne!(DEFAULT_MODEL.id, QUALITY_MODEL.id);
        assert_ne!(DEFAULT_MODEL.file, QUALITY_MODEL.file);
        assert_ne!(DEFAULT_MODEL.artifact.sha256, QUALITY_MODEL.artifact.sha256);
    }
}
