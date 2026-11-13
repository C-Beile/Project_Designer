// Wraps the `notify` crate (ReadDirectoryChangesW backend on Windows) to satisfy FileWatcher.
// Only translates event shapes - no debounce/self-write filtering here, that is the job of the
// `file-watcher` crate (see module doc in ../watcher.rs). Errors are never swallowed: they become
// `Rescan` events, because an overflowing OS buffer means events were lost.

use crate::error::PlatformError;
use crate::watcher::{FileWatcher, WatchControl, WatchEvent, WatchEventKind, WatchHandle, WatchTarget};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct NotifyFileWatcher;

impl NotifyFileWatcher {
    pub fn new() -> Self {
        Self
    }
}

/// Maps one notify result to our events. `root` is the path given with `Rescan` events.
pub(crate) fn to_watch_events(result: notify::Result<Event>, root: &Path) -> Vec<WatchEvent> {
    let event = match result {
        Ok(event) => event,
        // The OS or notify failed: events may be lost. Never drop this silently.
        Err(_) => return vec![WatchEvent { path: root.to_path_buf(), kind: WatchEventKind::Rescan }],
    };
    if event.need_rescan() {
        return vec![WatchEvent { path: root.to_path_buf(), kind: WatchEventKind::Rescan }];
    }
    let kind = match event.kind {
        EventKind::Create(_) => WatchEventKind::Created,
        EventKind::Modify(_) => WatchEventKind::Modified,
        EventKind::Remove(_) => WatchEventKind::Removed,
        _ => WatchEventKind::Other,
    };
    event.paths.into_iter().map(|path| WatchEvent { path, kind }).collect()
}

fn mode(target: &WatchTarget) -> RecursiveMode {
    if target.recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    }
}

struct NotifyControl(Arc<Mutex<RecommendedWatcher>>);

impl WatchControl for NotifyControl {
    fn add(&self, target: &WatchTarget) -> Result<(), PlatformError> {
        let mut w = self.0.lock().unwrap_or_else(|p| p.into_inner());
        w.watch(&target.path, mode(target)).map_err(|source| PlatformError::Watch { path: target.path.clone(), source: to_io_error(source) })
    }

    fn remove(&self, path: &Path) -> Result<(), PlatformError> {
        let mut w = self.0.lock().unwrap_or_else(|p| p.into_inner());
        w.unwatch(path).map_err(|source| PlatformError::Watch { path: path.to_path_buf(), source: to_io_error(source) })
    }
}

impl FileWatcher for NotifyFileWatcher {
    fn watch_targets(&self, targets: &[WatchTarget]) -> Result<WatchHandle, PlatformError> {
        let root: PathBuf = targets.first().map(|t| t.path.clone()).unwrap_or_default();
        let (raw_tx, raw_rx) = channel::<notify::Result<Event>>();
        let mut watcher = RecommendedWatcher::new(raw_tx, notify::Config::default())
            .map_err(|source| PlatformError::Watch { path: root.clone(), source: to_io_error(source) })?;
        for t in targets {
            watcher.watch(&t.path, mode(t)).map_err(|source| PlatformError::Watch { path: t.path.clone(), source: to_io_error(source) })?;
        }
        let watcher = Arc::new(Mutex::new(watcher));

        let (tx, rx) = channel::<WatchEvent>();
        // Bridges the notify callback thread to a plain std::sync::mpsc::Receiver<WatchEvent>,
        // so FileWatcher's trait surface never leaks the notify crate to callers.
        std::thread::spawn(move || {
            for result in raw_rx {
                for watch_event in to_watch_events(result, &root) {
                    if tx.send(watch_event).is_err() {
                        return;
                    }
                }
            }
        });

        Ok(WatchHandle::with_control(rx, watcher.clone(), Arc::new(NotifyControl(watcher))))
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
    fn notify_errors_and_rescan_flags_become_rescan_events() {
        let root = Path::new("C:/proj");
        let err = to_watch_events(Err(notify::Error::generic("boom")), root);
        assert_eq!(err, vec![WatchEvent { path: root.to_path_buf(), kind: WatchEventKind::Rescan }]);

        let ev = Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan);
        assert_eq!(to_watch_events(Ok(ev), root)[0].kind, WatchEventKind::Rescan);

        let ev = Event::new(EventKind::Create(notify::event::CreateKind::File)).add_path(PathBuf::from("C:/proj/a"));
        let out = to_watch_events(Ok(ev), root);
        assert_eq!(out[0].kind, WatchEventKind::Created);
    }

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

    #[test]
    fn a_folder_added_later_is_watched_too() {
        let dir = std::env::temp_dir().join(format!("forge-platform-watcher-add-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let watcher = NotifyFileWatcher::new();
        let handle = watcher.watch_targets(&[WatchTarget::flat(&dir)]).unwrap();
        handle.add(&WatchTarget::recursive(&sub)).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let f = sub.join("x.aod");
        std::fs::write(&f, b"x").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut saw = false;
        while std::time::Instant::now() < deadline {
            if let Ok(e) = handle.events.recv_timeout(Duration::from_millis(500)) {
                if e.path == f {
                    saw = true;
                    break;
                }
            }
        }
        assert!(saw);
        handle.remove(&sub).unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }
}
