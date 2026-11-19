//! Non-macOS stub — Accessibility insert is not available.

use super::types::{PasteBindingDto, TargetSnapshotDto};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn snapshot_target() -> Result<TargetSnapshotDto, String> {
    Ok(TargetSnapshotDto::unavailable(
        "Accessibility insert is macOS-only in this build",
        now_ms(),
    ))
}

pub fn validate_target(intended: TargetSnapshotDto) -> Result<TargetSnapshotDto, String> {
    Ok(TargetSnapshotDto {
        insertable: false,
        shared_paste_token: None,
        paste_terminal: false,
        paste_app: None,
        kind: if intended.kind == "insertable" {
            "unavailable".into()
        } else {
            intended.kind
        },
        reason: Some(
            intended
                .reason
                .unwrap_or_else(|| "Accessibility insert is macOS-only in this build".into()),
        ),
        ..intended
    })
}

pub fn insert_text(
    _text: &str,
    _intended: &TargetSnapshotDto,
) -> Result<super::decide::InsertReport, String> {
    Err(super::decide::shared_target::refused(
        "insert unavailable on this platform (macOS AX adapter required)",
    ))
}

pub fn paste_target(
    _text: &str,
    _intended: &TargetSnapshotDto,
) -> Result<super::decide::report::PasteReport, String> {
    Err(super::decide::shared_target::refused(
        "paste unavailable on this platform",
    ))
}

pub fn paste_binding() -> Option<PasteBindingDto> {
    None
}

pub fn paste_text(
    _text: &str,
    _bound: &PasteBindingDto,
) -> Result<super::decide::report::PasteReport, String> {
    Err(super::decide::shared_target::refused(
        "paste unavailable on this platform (macOS adapter required)",
    ))
}
