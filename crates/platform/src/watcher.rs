// Raw path-change events over a channel (architecture.md §5). Debounce and "filter out my own
// atomic_write" live in the `file-watcher` crate, not here - this trait's only job is to deliver
// every raw OS event reliably; a filtering layer above it needs the un-debounced signal.

use crate::error::PlatformError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchEventKind {
    Created,
    Modified,
    Removed,
    /// Anything the OS reports that doesn't cleanly map to the three cases above (renames
    /// reported as a single event, metadata-only changes, ...). Deliberately not dropped -
    /// the debounce layer decides what matters, this trait must not decide for it.
    Other,
    /// Events may have been lost (OS says so, or the watcher failed): the receiver must compare
    /// the whole watched tree with its own state. `path` is the watch root.
    Rescan,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WatchEvent {
    pub path: PathBuf,
    pub kind: WatchEventKind,
}

/// One folder to watch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchTarget {
    pub path: PathBuf,
    pub recursive: bool,
}

impl WatchTarget {
    pub fn recursive(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), recursive: true }
    }
    pub fn flat(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), recursive: false }
    }
}

/// Changes the set of watched folders of a running watch.
pub trait WatchControl: Send + Sync {
    fn add(&self, target: &WatchTarget) -> Result<(), PlatformError>;
    fn remove(&self, path: &Path) -> Result<(), PlatformError>;
}

/// Keeps a watch alive for as long as it is held; dropping it stops the underlying OS watch.
/// The receiver is where raw events arrive.
pub struct WatchHandle {
    pub events: Receiver<WatchEvent>,
    // Type-erased so this struct stays OS-agnostic; the concrete watcher (e.g.
    // notify::RecommendedWatcher) just needs to live exactly as long as this handle.
    _guard: Box<dyn std::any::Any + Send>,
    control: Option<Arc<dyn WatchControl>>,
}

impl WatchHandle {
    pub fn new(events: Receiver<WatchEvent>, guard: impl std::any::Any + Send) -> Self {
        Self { events, _guard: Box::new(guard), control: None }
    }

    pub fn with_control(events: Receiver<WatchEvent>, guard: impl std::any::Any + Send, control: Arc<dyn WatchControl>) -> Self {
        Self { events, _guard: Box::new(guard), control: Some(control) }
    }

    /// Adds a folder to the running watch (error if the watcher cannot do it).
    pub fn add(&self, target: &WatchTarget) -> Result<(), PlatformError> {
        match &self.control {
            Some(c) => c.add(target),
            None => Err(PlatformError::Watch { path: target.path.clone(), source: std::io::Error::other("watcher cannot change its targets") }),
        }
    }

    pub fn remove(&self, path: &Path) -> Result<(), PlatformError> {
        match &self.control {
            Some(c) => c.remove(path),
            None => Err(PlatformError::Watch { path: path.to_path_buf(), source: std::io::Error::other("watcher cannot change its targets") }),
        }
    }
}

pub trait FileWatcher: Send + Sync {
    /// Watches `root` recursively. Events keep arriving on the returned handle's channel until
    /// the handle is dropped.
    fn watch(&self, root: &Path) -> Result<WatchHandle, PlatformError> {
        self.watch_targets(&[WatchTarget::recursive(root)])
    }

    /// Watches several folders, each recursive or not, on one channel.
    fn watch_targets(&self, targets: &[WatchTarget]) -> Result<WatchHandle, PlatformError>;
}
