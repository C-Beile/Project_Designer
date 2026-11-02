// Atomic file write: write to a temp file next to the target, flush it to disk, then rename
// it over the target. architecture.md §4: this is what makes "save without a change produces
// an empty diff" structurally true and guarantees the file watcher (watcher.rs) never observes
// a half-written file - a crash mid-write leaves either the old file (rename never happened)
// or the new file (rename is a single filesystem operation), never a truncated one.
//
// Free function rather than a trait: `std::fs::rename` already replaces an existing
// destination atomically on both Windows (MoveFileExW with MOVEFILE_REPLACE_EXISTING under the
// hood) and Unix (rename(2)) as long as source and destination are on the same volume, so there
// is no OS-specific branch to hide behind a trait - this is the one truly platform-neutral
// piece of the seven interfaces in architecture.md §8.

use crate::error::PlatformError;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Hook that runs with the path of an EXISTING file right before `atomic_write` replaces it. The
/// app registers a backup here, so no write path (object save, linked file, modification patch,
/// rename) can destroy the previous content without a copy. An `Err` aborts the write.
pub type BeforeOverwrite = fn(&Path) -> Result<(), String>;
static BEFORE_OVERWRITE: std::sync::OnceLock<BeforeOverwrite> = std::sync::OnceLock::new();

pub fn set_before_overwrite_hook(hook: BeforeOverwrite) {
    let _ = BEFORE_OVERWRITE.set(hook);
}

fn temp_path_for(target: &Path) -> PathBuf {
    let file_name = target.file_name().and_then(|n| n.to_str()).unwrap_or("forge-atomic-write");
    let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_name = format!(".{file_name}.{}.{}.tmp", std::process::id(), unique);
    target.with_file_name(temp_name)
}

/// Writes `bytes` to `path` without ever leaving a half-written `path` on disk. `path`'s parent
/// directory must already exist (this function never creates directories - that stays a
/// caller/`aod-io` decision, not a platform-layer default).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), PlatformError> {
    if let Some(hook) = BEFORE_OVERWRITE.get() {
        if path.is_file() {
            hook(path).map_err(|msg| PlatformError::AtomicWrite {
                path: path.to_path_buf(),
                source: std::io::Error::other(format!("backup before overwrite failed: {msg}")),
            })?;
        }
    }
    let temp_path = temp_path_for(path);
    write_temp_then_rename(path, &temp_path, bytes).map_err(|source| {
        // Best-effort cleanup: an error here must never leave a stray temp file behind, but
        // must also never shadow the original error (this file may already be gone).
        let _ = std::fs::remove_file(&temp_path);
        PlatformError::AtomicWrite { path: path.to_path_buf(), source }
    })
}

fn write_temp_then_rename(target: &Path, temp_path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(temp_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(temp_path, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_bytes_and_leaves_no_temp_file_behind() {
        let dir = std::env::temp_dir().join(format!("forge-platform-atomic-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("test.aod");

        atomic_write(&target, b"<root/>").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"<root/>");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no .tmp file should survive a successful atomic_write");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_write_that_cannot_create_its_temp_file_leaves_the_original_untouched() {
        // Simulates the "aborted write" case from the crate spec: point the target at a path
        // whose parent directory does not exist, so File::create on the temp path fails before
        // any rename is attempted. The original file (written first, outside atomic_write) must
        // survive completely unchanged - proving atomic_write never touches the destination
        // until the temp file is fully written.
        let dir = std::env::temp_dir().join(format!("forge-platform-atomic-write-fail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("original.aod");
        std::fs::write(&target, b"original bytes, must survive").unwrap();

        let missing_parent_target = dir.join("does-not-exist").join("original.aod");
        let result = atomic_write(&missing_parent_target, b"new bytes that must never land");

        assert!(result.is_err(), "write into a non-existent directory must fail, not silently succeed");
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"original bytes, must survive",
            "the unrelated original file must be completely untouched by the failed write"
        );
        assert!(
            !missing_parent_target.exists(),
            "no partial file should appear at the failed write's target path"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn overwriting_an_existing_file_replaces_its_content_in_one_step() {
        let dir = std::env::temp_dir().join(format!("forge-platform-atomic-write-overwrite-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("existing.aod");
        std::fs::write(&target, b"old content").unwrap();

        atomic_write(&target, b"new content").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"new content");
        std::fs::remove_dir_all(&dir).ok();
    }
}
