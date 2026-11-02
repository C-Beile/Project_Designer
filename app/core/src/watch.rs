//! Detection of changes made outside the app (Git checkout, another editor): a cheap stat-based
//! fingerprint of the project's own files and a size/time stamp per opened file. Polling instead
//! of OS notifications keeps it independent of the platform and immune to the event floods a
//! `git checkout` produces; a poll costs a few milliseconds on real projects.

use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FileStamp {
    pub len: u64,
    pub modified_ms: u128,
}

/// `None` when the file does not exist (anymore).
#[must_use]
pub fn file_stamp(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    Some(FileStamp { len: meta.len(), modified_ms })
}

fn skipped(name: &str) -> bool {
    matches!(name, "node_modules" | "dist" | ".git" | ".forge-incremental-cache" | "target" | ".claude")
}

/// Order-independent hash over path, size and modification time of every file of the project
/// except `node_modules`, `dist` and `.git`. Differs after files were added, removed or edited.
#[must_use]
pub fn project_fingerprint(root: &Path) -> u64 {
    let mut acc: u64 = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name();
            let path = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if !skipped(&name.to_string_lossy()) {
                    stack.push(path);
                }
            } else if let Some((len, ms)) = e.metadata().ok().and_then(|m| {
                let ms = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
                Some((m.len(), ms as u64))
            }) {
                let mut h: u64 = 0xcbf2_9ce4_8422_2325;
                for b in path.to_string_lossy().as_bytes().iter().copied().chain(len.to_le_bytes()).chain(ms.to_le_bytes()) {
                    h ^= u64::from(b);
                    h = h.wrapping_mul(0x0100_0000_01b3);
                }
                acc = acc.wrapping_add(h);
            }
        }
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_changes_on_edit_add_and_remove_but_not_inside_node_modules() {
        let root = std::env::temp_dir().join(format!("forge-watch-{}", std::process::id()));
        std::fs::create_dir_all(root.join("entity/A_entity")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        let f = root.join("entity/A_entity/A_entity.aod");
        std::fs::write(&f, "one").unwrap();
        let base = project_fingerprint(&root);
        assert_eq!(base, project_fingerprint(&root));

        std::fs::write(root.join("node_modules/x/m.aod"), "ignored").unwrap();
        assert_eq!(base, project_fingerprint(&root));

        std::fs::write(&f, "two-longer").unwrap();
        let edited = project_fingerprint(&root);
        assert_ne!(base, edited);

        std::fs::write(root.join("entity/B.aod"), "b").unwrap();
        let added = project_fingerprint(&root);
        assert_ne!(edited, added);
        std::fs::remove_file(root.join("entity/B.aod")).unwrap();
        assert_ne!(added, project_fingerprint(&root));
    }

    #[test]
    fn stamp_is_none_for_a_missing_file_and_changes_with_content_length() {
        let f = std::env::temp_dir().join(format!("forge-stamp-{}.aod", std::process::id()));
        assert_eq!(file_stamp(&f), None);
        std::fs::write(&f, "a").unwrap();
        let a = file_stamp(&f).unwrap();
        std::fs::write(&f, "abc").unwrap();
        assert_ne!(a, file_stamp(&f).unwrap());
    }
}
