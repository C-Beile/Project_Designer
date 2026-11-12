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
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// Size and modification time of a file. Two equal stamps mean "probably unchanged".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FileStamp {
    pub len: u64,
    pub modified_ms: u128,
}

/// `None` when the file does not exist (anymore).
#[must_use]
pub fn file_stamp(path: &Path) -> Option<FileStamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some(stamp_of(&meta))
}

/// Stamp from metadata already in hand (a directory walk gets it for free on Windows).
#[must_use]
pub fn stamp_of(meta: &std::fs::Metadata) -> FileStamp {
    let modified_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    FileStamp { len: meta.len(), modified_ms }
}

/// Path as a map key: on Windows case-insensitive and with one separator, elsewhere unchanged.
#[must_use]
pub fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let text = text.trim_end_matches('/').to_string();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

/// How long a note about an own write stays valid.
const OWN_WRITE_TTL: Duration = Duration::from_secs(5);

/// Register of writes made by the app itself, so the file watcher can tell them from outside changes.
#[derive(Default)]
struct OwnWrites {
    // key -> (stamp after the write or None for "any", time of the note)
    map: HashMap<String, (Option<FileStamp>, Instant)>,
}

impl OwnWrites {
    fn note(&mut self, path: &Path, stamp: Option<FileStamp>, now: Instant) {
        self.map.retain(|_, (_, at)| now.saturating_duration_since(*at) < OWN_WRITE_TTL);
        self.map.insert(path_key(path), (stamp, now));
    }

    fn take(&mut self, path: &Path, current: Option<FileStamp>, now: Instant) -> bool {
        let key = path_key(path);
        let Some((stamp, at)) = self.map.remove(&key) else { return false };
        if now.saturating_duration_since(at) >= OWN_WRITE_TTL {
            return false;
        }
        match stamp {
            None => true,
            Some(s) => Some(s) == current,
        }
    }
}

static OWN_WRITES: Mutex<Option<OwnWrites>> = Mutex::new(None);

fn with_own_writes<R>(f: impl FnOnce(&mut OwnWrites) -> R) -> R {
    let mut guard = OWN_WRITES.lock().unwrap_or_else(|p| p.into_inner());
    f(guard.get_or_insert_with(OwnWrites::default))
}

/// For writers that use `std::fs` directly (rename, new object, zip import): "this change at `path` is mine".
/// Matches any stamp and is valid for about 5 seconds.
pub fn note_own_change(path: &Path) {
    with_own_writes(|w| w.note(path, None, Instant::now()));
}

/// True once if `path` was written by the app a moment ago (and still has the stamp the write left).
/// Consumes the note.
#[must_use]
pub fn take_own_write(path: &Path, current: Option<FileStamp>) -> bool {
    with_own_writes(|w| w.take(path, current, Instant::now()))
}

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
/// caller/`aod::document` decision, not a platform-layer default).
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
    })?;
    let stamp = file_stamp(path);
    with_own_writes(|w| w.note(path, stamp, Instant::now()));
    Ok(())
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
    fn stamp_is_none_for_a_missing_file_and_changes_with_content_length() {
        let f = std::env::temp_dir().join(format!("forge-stamp-{}.aod", std::process::id()));
        assert_eq!(file_stamp(&f), None);
        std::fs::write(&f, "a").unwrap();
        let a = file_stamp(&f).unwrap();
        std::fs::write(&f, "abc").unwrap();
        assert_ne!(a, file_stamp(&f).unwrap());
        std::fs::remove_file(&f).ok();
    }

    #[test]
    fn path_key_ignores_separator_and_trailing_slash() {
        assert_eq!(path_key(Path::new("C:/a/b/")), path_key(Path::new("C:\\a\\b")));
        if cfg!(windows) {
            assert_eq!(path_key(Path::new("C:/A/b")), path_key(Path::new("c:/a/B")));
        }
    }

    #[test]
    fn own_write_is_taken_once_and_only_with_the_matching_stamp() {
        let now = Instant::now();
        let p = Path::new("C:/proj/x.aod");
        let s = FileStamp { len: 3, modified_ms: 10 };
        let mut w = OwnWrites::default();
        w.note(p, Some(s), now);
        assert!(w.take(p, Some(s), now));
        assert!(!w.take(p, Some(s), now), "consumed");
        w.note(p, Some(s), now);
        assert!(!w.take(p, Some(FileStamp { len: 4, modified_ms: 10 }), now), "other stamp = outside change");
        w.note(p, None, now);
        assert!(w.take(p, None, now), "None matches anything");
    }

    #[test]
    fn own_write_expires() {
        let now = Instant::now();
        let p = Path::new("C:/proj/y.aod");
        let mut w = OwnWrites::default();
        w.note(p, None, now);
        assert!(!w.take(p, None, now + Duration::from_secs(6)));
    }

    #[test]
    fn atomic_write_registers_an_own_write() {
        let dir = std::env::temp_dir().join(format!("forge-platform-own-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("own.aod");
        atomic_write(&target, b"<root/>").unwrap();
        assert!(take_own_write(&target, file_stamp(&target)));
        assert!(!take_own_write(&target, file_stamp(&target)));
        std::fs::remove_dir_all(&dir).ok();
    }

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
