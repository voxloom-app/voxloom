//! Existing Windows/Linux behavior, deliberately not a macOS fallback.
use std::{fs, path::Path};

pub(super) fn load(path: &Path) -> Result<Option<String>, String> {
    crate::store_read::read_store(path, "history.json")
}
pub(super) fn save(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents.as_bytes()).map_err(|e| format!("write history.json.tmp: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename history.json.tmp: {e}")
    })?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_plain_store_round_trip_and_missing_file() {
        let root =
            std::env::temp_dir().join(format!("voxloom-plain-history-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("history.json");
        assert_eq!(load(&path).unwrap(), None);
        let body = "{\"version\":1,\"records\":[]}\n";
        save(&path, body).unwrap();
        assert_eq!(load(&path).unwrap().as_deref(), Some(body));
        fs::remove_dir_all(root).unwrap();
    }
}
