//! Setup model-readiness decision. Pure: it reads facts the caller already
//! gathered and never fetches, hashes or writes anything.

/// Whisper inference is built for macOS and Windows only. Linux can compile
/// the feature for CI, but guided setup does not offer it there.
pub(super) const WHISPER_SETUP_ENGINE: bool = cfg!(all(
    any(target_os = "macos", target_os = "windows"),
    feature = "whisper"
));

/// Names the platform in the user-facing "engine unavailable" reason. macOS
/// (and Linux dev builds) keep the original text byte for byte.
#[cfg(not(target_os = "windows"))]
pub(super) const ENGINE_UNAVAILABLE_REASON: &str =
    "The selected speech engine is unavailable in this build or on this Mac.";
#[cfg(target_os = "windows")]
pub(super) const ENGINE_UNAVAILABLE_REASON: &str =
    "The selected speech engine is unavailable in this build or on this PC.";

const PENDING_REASON: &str =
    "The selected voice pack is still being verified. Check again when verification finishes.";
const MISSING_REASON: &str =
    "The selected voice pack is missing, downloading or not verified. Check or retry the download.";

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Decision {
    pub status: &'static str,
    pub reason: Option<&'static str>,
}

/// `listed_status` is the model list's status for the id (`downloading`,
/// `available`, ...). `verified` is the strict setup check, which is only
/// meaningful when `engine` is true. A listed-available but unverified model
/// is `pending` (still being checked), never `missing`.
pub(super) fn decide(
    engine: bool,
    listed_status: Option<&str>,
    verified: bool,
    unavailable_reason: &'static str,
) -> Decision {
    let status = if !engine {
        "unavailable"
    } else if listed_status == Some("downloading") {
        "downloading"
    } else if verified {
        "available"
    } else if listed_status == Some("available") {
        "pending"
    } else {
        "missing"
    };
    let reason = match status {
        "available" => None,
        "unavailable" => Some(unavailable_reason),
        "pending" => Some(PENDING_REASON),
        _ => Some(MISSING_REASON),
    };
    Decision { status, reason }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAC_UNAVAILABLE: &str =
        "The selected speech engine is unavailable in this build or on this Mac.";
    const LISTED: [Option<&str>; 5] = [
        None,
        Some("missing"),
        Some("downloading"),
        Some("available"),
        Some("failed"),
    ];

    /// The decision exactly as it was written inline before it was extracted
    /// (BUS-208), kept verbatim so the matrix test compares old to new.
    fn before_extraction(
        engine: bool,
        listed: Option<&str>,
        verified: bool,
    ) -> (&'static str, bool, Option<String>) {
        let verified = engine && verified;
        let status = if !engine {
            "unavailable"
        } else if listed.is_some_and(|status| status == "downloading") {
            "downloading"
        } else if verified {
            "available"
        } else if listed.is_some_and(|status| status == "available") {
            "pending"
        } else {
            "missing"
        };
        let ready = status == "available";
        let reason = if ready {
            None
        } else if !engine {
            Some("The selected speech engine is unavailable in this build or on this Mac.".into())
        } else if status == "pending" {
            Some("The selected voice pack is still being verified. Check again when verification finishes.".into())
        } else {
            Some("The selected voice pack is missing, downloading or not verified. Check or retry the download.".into())
        };
        (status, ready, reason)
    }

    #[test]
    fn matrix_matches_the_pre_extraction_decision_for_every_input() {
        for engine in [false, true] {
            for listed in LISTED {
                for verified in [false, true] {
                    let got = decide(engine, listed, engine && verified, MAC_UNAVAILABLE);
                    let (status, ready, reason) = before_extraction(engine, listed, verified);
                    assert_eq!(got.status, status, "{engine} {listed:?} {verified}");
                    assert_eq!(got.status == "available", ready);
                    assert_eq!(got.reason.map(String::from), reason);
                }
            }
        }
    }

    #[test]
    fn each_status_has_its_exact_text() {
        let cases = [
            (
                false,
                Some("available"),
                false,
                "unavailable",
                Some(MAC_UNAVAILABLE),
            ),
            (
                true,
                Some("downloading"),
                false,
                "downloading",
                Some(MISSING_REASON),
            ),
            (true, Some("available"), true, "available", None),
            (
                true,
                Some("available"),
                false,
                "pending",
                Some(PENDING_REASON),
            ),
            (
                true,
                Some("missing"),
                false,
                "missing",
                Some(MISSING_REASON),
            ),
            (true, None, false, "missing", Some(MISSING_REASON)),
            (true, Some("failed"), false, "missing", Some(MISSING_REASON)),
        ];
        for (engine, listed, verified, status, reason) in cases {
            let got = decide(engine, listed, verified, MAC_UNAVAILABLE);
            assert_eq!((got.status, got.reason), (status, reason), "{listed:?}");
        }
        assert_eq!(
            PENDING_REASON,
            "The selected voice pack is still being verified. Check again when verification finishes."
        );
        assert_eq!(
            MISSING_REASON,
            "The selected voice pack is missing, downloading or not verified. Check or retry the download."
        );
    }

    #[test]
    fn pending_never_reads_as_missing() {
        let got = decide(true, Some("available"), false, MAC_UNAVAILABLE);
        assert_eq!(got.status, "pending");
        assert_ne!(got.reason, Some(MISSING_REASON));
    }

    #[test]
    fn unavailable_engine_wins_over_any_model_state() {
        for listed in LISTED {
            let got = decide(false, listed, false, "reason");
            assert_eq!((got.status, got.reason), ("unavailable", Some("reason")));
        }
    }

    #[test]
    fn readiness_is_ready_only_when_available() {
        for listed in LISTED {
            for verified in [false, true] {
                let got = decide(true, listed, verified, MAC_UNAVAILABLE);
                assert_eq!(got.reason.is_none(), got.status == "available");
            }
        }
    }

    // Per-platform pins. macOS compares to the expression and text it used
    // before this change, so a Mac build can only differ by editing the pin.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_engine_and_text_are_unchanged() {
        assert_eq!(
            WHISPER_SETUP_ENGINE,
            cfg!(all(target_os = "macos", feature = "whisper"))
        );
        assert_eq!(ENGINE_UNAVAILABLE_REASON, MAC_UNAVAILABLE);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_offers_whisper_when_built_and_names_the_pc() {
        assert_eq!(WHISPER_SETUP_ENGINE, cfg!(feature = "whisper"));
        assert_eq!(
            ENGINE_UNAVAILABLE_REASON,
            "The selected speech engine is unavailable in this build or on this PC."
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn other_platforms_never_offer_whisper_in_setup() {
        assert!(!WHISPER_SETUP_ENGINE);
        assert_eq!(ENGINE_UNAVAILABLE_REASON, MAC_UNAVAILABLE);
    }
}
