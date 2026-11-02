// Wraps the `notify` crate (ReadDirectoryChangesW backend on Windows) to satisfy FileWatcher.
// Only translates event shapes - no debounce/self-write filtering here, that is `index`'s job
// per architecture.md §5 (see module doc in ../watcher.rs).

use crate::error::PlatformError;
use crate::watcher::{FileWatcher, WatchEvent, WatchEventKind, WatchHandle};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::channel;

#[derive(Default)]
pub struct NotifyFileWatcher;

impl NotifyFileWatcher {
    pub fn new() -> Self {
        Self
    }
}

fn to_watch_event(event: Event) -> Vec<WatchEvent> {
    let kind = match event.kind {
        EventKind::Create(_) => WatchEventKind::Created,
        EventKind::Modify(_) => WatchEventKind::Modified,
        EventKind::Remove(_) => WatchEventKind::Removed,
        _ => WatchEventKind::Other,
    };
    event.paths.into_iter().map(|path| WatchEvent { path, kind }).collect()
}

impl FileWatcher for NotifyFileWatcher {
    fn watch(&self, root: &Path) -> Result<WatchHandle, PlatformError> {
        let (raw_tx, raw_rx) = channel::<notify::Result<Event>>();
        let mut watcher = RecommendedWatcher::new(raw_tx, notify::Config::default())
            .map_err(|source| PlatformError::Watch { path: root.to_path_buf(), source: to_io_error(source) })?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|source| PlatformError::Watch { path: root.to_path_buf(), source: to_io_error(source) })?;

        let (tx, rx) = channel::<WatchEvent>();
        // Bridges the notify callback thread to a plain std::sync::mpsc::Receiver<WatchEvent>,
        // so FileWatcher's trait surface never leaks the notify crate to callers (forge-core
        // depends only on platform's own types, per ADR-0004 rule 1).
        std::thread::spawn(move || {
            for result in raw_rx {
                if let Ok(event) = result {
                    for watch_event in to_watch_event(event) {
                        if tx.send(watch_event).is_err() {
                            return;
                        }
                    }
                }
            }
        });

        Ok(WatchHandle::new(rx, watcher))
    }
}

fn to_io_error(err: notify::Error) -> std::io::Error {
    std::io::Error::other(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn observes_a_real_file_creation_in_a_scratch_directory() {
        let dir = std::env::temp_dir().join(format!("forge-platform-watcher-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let watcher = NotifyFileWatcher::new();
        let handle = watcher.watch(&dir).unwrap();

        // Give the OS watch a moment to fully register before triggering the change - avoids
        // flakiness from a change happening before ReadDirectoryChangesW is actually armed.
        std::thread::sleep(Duration::from_millis(200));

        let new_file = dir.join("watched.aod");
        std::fs::write(&new_file, b"<root/>").unwrap();

        let mut saw_it = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            if let Ok(event) = handle.events.recv_timeout(Duration::from_millis(500)) {
                if event.path == new_file {
                    saw_it = true;
                    break;
                }
            }
        }

        assert!(saw_it, "expected a watch event for {new_file:?} within the timeout");
        std::fs::remove_dir_all(&dir).ok();
    }
}
