//! BUS-232 first cut: the B (focus refinement) and C (editable-caret ⌘V)
//! paths for container and unknown/custom roles run ONLY for these five
//! apps, matched by exact bundle id. Every other app takes the pre-BUS-232
//! decision unchanged (`path=old`), so the shared delivery path stays the
//! one #182 was reviewed on. Widening to every app once `[snapshot]` and
//! `[bus232]` evidence is in: BUS-234.

use super::focus_refine::may_refine;
use super::paste_role::{
    classify_gated_target, classify_target, container_or_custom, EditFacts, WideFacts,
};
use super::snapshot_diag::{kind_label, AxName};

/// Exact bundle ids (case-sensitive string equality, never a prefix: Excel,
/// Keynote and other Office/iWork apps stay on the old path).
pub const GATED_BUNDLES: [&str; 5] = [
    "com.microsoft.Word",
    "com.microsoft.Powerpoint",
    "com.apple.mail",
    "com.apple.iWork.Numbers",
    "com.apple.iWork.Pages",
];

pub fn gated(bundle: Option<&str>) -> bool {
    bundle.is_some_and(|b| GATED_BUNDLES.contains(&b))
}

/// Which branch a container/unknown-role decision took.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    /// Not gated: the pre-BUS-232 `classify_target` decision.
    Old,
    /// Gated: a focused text child became the target (B).
    Refine,
    /// Gated: paste-only on editable-caret evidence (C).
    Paste,
    /// Gated: neither B nor C; stays Copy.
    Copy,
}

impl Path {
    pub fn label(self) -> &'static str {
        match self {
            Path::Old => "old",
            Path::Refine => "refine",
            Path::Paste => "paste",
            Path::Copy => "copy",
        }
    }
}

pub type Class = (&'static str, bool, Option<&'static str>);

/// A focus classification. `path` is None for roles outside the gate's scope
/// (text, secure, grid, never-paste): those print no `[bus232]` line.
#[derive(Debug)]
pub struct Decision<T> {
    /// The focused element's classification; unused when `refined` is set
    /// (the child is classified on its own).
    pub class: Class,
    pub path: Option<Path>,
    /// Read only for container/unknown roles.
    pub bundle: Option<String>,
    /// B's chosen child.
    pub refined: Option<T>,
}

/// The one place B and C are chosen. For anything but a container or an
/// unknown/custom role in a gated app this is exactly `classify_target` with
/// the same lazy inputs (`wide` and `refine` are never called). `refine`
/// returns the walk's target (and records its own diagnostics).
pub fn decide<T>(
    role: &str,
    subrole: Option<&str>,
    bundle: impl FnOnce() -> Option<String>,
    facts: impl FnOnce() -> EditFacts,
    wide: impl FnOnce() -> WideFacts,
    ancestors: impl FnOnce() -> Vec<String>,
    refine: impl FnOnce() -> Option<T>,
) -> Decision<T> {
    let plain = |class, path, bundle| Decision {
        class,
        path,
        bundle,
        refined: None,
    };
    if !container_or_custom(role, subrole) {
        return plain(classify_target(role, subrole, facts, ancestors), None, None);
    }
    let bundle = bundle();
    if !gated(bundle.as_deref()) {
        let class = classify_target(role, subrole, facts, ancestors);
        return plain(class, Some(Path::Old), bundle);
    }
    let ancestors = ancestors();
    if may_refine(role, &ancestors) {
        if let Some(child) = refine() {
            return Decision {
                class: ("insertable", true, None),
                path: Some(Path::Refine),
                bundle,
                refined: Some(child),
            };
        }
    }
    let class = classify_gated_target(role, subrole, wide, || ancestors);
    let path = if class.1 { Path::Paste } else { Path::Copy };
    plain(class, Some(path), bundle)
}

/// Everything the `[bus232]` line may contain. No field takes free text:
/// roles and the bundle id are `AxName`s, `refine` is
/// `focus_refine::Refinement::label` (labels and counters).
#[derive(Clone, Debug)]
pub struct GateLine {
    pub path: Path,
    pub gated: bool,
    /// The completion snapshot (`true`) or a later re-check.
    pub completion: bool,
    pub bundle: Option<AxName>,
    pub pid: Option<i32>,
    /// The focused element's role and subrole, as read before any refinement.
    pub role: AxName,
    pub subrole: Option<AxName>,
    /// Resulting snapshot kind (`snapshot_diag::kind_label`).
    pub kind: &'static str,
    /// Refinement outcome; None when it did not run (not gated, or a grid).
    pub refine: Option<String>,
    pub refine_ms: u128,
}

impl GateLine {
    pub fn new(path: Path, gated: bool, completion: bool, kind: &str) -> Self {
        Self {
            path,
            gated,
            completion,
            bundle: None,
            pid: None,
            role: AxName::new("unknown"),
            subrole: None,
            kind: kind_label(kind),
            refine: None,
            refine_ms: 0,
        }
    }

    pub fn line(&self) -> String {
        let name = |n: &Option<AxName>| n.as_ref().map_or("-", AxName::as_str).to_string();
        format!(
            "[bus232] path={} gated={} at={} bundle={} pid={} role={} subrole={} kind={} \
             refine=[{}] refine_ms={}",
            self.path.label(),
            self.gated,
            if self.completion {
                "completion"
            } else {
                "recheck"
            },
            name(&self.bundle),
            self.pid.map_or_else(|| "-".to_string(), |p| p.to_string()),
            self.role.as_str(),
            name(&self.subrole),
            self.kind,
            self.refine.as_deref().unwrap_or("-"),
            self.refine_ms,
        )
    }
}

#[cfg(test)]
#[path = "container_gate_tests.rs"]
mod tests;
