//! Windows guided-setup permission answers (BUS-251). Pure: nothing here reads
//! the registry or Windows Settings, prompts, opens a page or touches the
//! microphone. The real privacy probe and endpoint lifecycle belong to BUS-238.
use super::{PermissionKind, PermissionState};

const MICROPHONE_REQUEST_REASON: &str = "Windows does not ask for microphone access. To check it, open Windows Settings > Privacy & security > Microphone and turn on Let desktop apps access your microphone.";
const SETTINGS_NOT_OPENED_REASON: &str = "Voxloom does not open Windows Settings from setup. To check microphone access, open Windows Settings > Privacy & security > Microphone.";

/// Windows has no Accessibility grant to ask for. Microphone access is a
/// Windows privacy setting that only a real capture can test, so it is never
/// reported as granted, denied or restricted here.
pub(super) fn query(kind: PermissionKind) -> PermissionState {
    match kind {
        PermissionKind::Microphone => PermissionState::Unverified,
        PermissionKind::Accessibility => PermissionState::NotRequired,
    }
}

/// Nothing to request on Windows: no prompt exists to show and no page is
/// opened that could not be verified.
pub(super) fn request(kind: PermissionKind) -> Result<(), &'static str> {
    match kind {
        PermissionKind::Microphone => Err(MICROPHONE_REQUEST_REASON),
        PermissionKind::Accessibility => Ok(()),
    }
}

pub(super) fn open_settings(_kind: PermissionKind) -> Result<(), &'static str> {
    Err(SETTINGS_NOT_OPENED_REASON)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KINDS: [PermissionKind; 2] = [PermissionKind::Microphone, PermissionKind::Accessibility];

    #[test]
    fn each_kind_gets_its_own_honest_answer() {
        assert_eq!(
            query(PermissionKind::Microphone),
            PermissionState::Unverified
        );
        assert_eq!(
            query(PermissionKind::Accessibility),
            PermissionState::NotRequired
        );
    }

    #[test]
    fn no_answer_claims_or_denies_a_grant_it_cannot_know() {
        for kind in KINDS {
            assert!(!matches!(
                query(kind),
                PermissionState::Authorized
                    | PermissionState::Denied
                    | PermissionState::Restricted
                    | PermissionState::NotGranted
                    | PermissionState::NotDetermined
            ));
        }
    }

    #[test]
    fn requests_open_nothing_and_name_windows_settings() {
        assert_eq!(request(PermissionKind::Accessibility), Ok(()));
        assert_eq!(
            request(PermissionKind::Microphone),
            Err("Windows does not ask for microphone access. To check it, open Windows Settings > Privacy & security > Microphone and turn on Let desktop apps access your microphone.")
        );
        for kind in KINDS {
            assert_eq!(
                open_settings(kind),
                Err("Voxloom does not open Windows Settings from setup. To check microphone access, open Windows Settings > Privacy & security > Microphone.")
            );
        }
    }

    #[test]
    fn copy_is_windows_only() {
        for text in [MICROPHONE_REQUEST_REASON, SETTINGS_NOT_OPENED_REASON] {
            assert!(
                !text.contains("macOS")
                    && !text.contains("Mac")
                    && !text.contains("System Settings")
            );
        }
    }
}
