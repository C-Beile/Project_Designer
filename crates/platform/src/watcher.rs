// Raw path-change events over a channel (architecture.md §5). Debounce and "filter out my own
// atomic_write" live in `index`, not here - this trait's only job is to deliver every raw OS
// event reliably; a filtering layer above it needs the un-debounced signal to do its job
// correctly (e.g. to correlate a Modify event with the timestamp atomic_write recorded).

use crate::error::PlatformError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchEventKind {
    Created,
    Modified,
    Removed,
    /// Anything the OS reports that doesn't cleanly map to the three cases above (renames
    /// reported as a single event, metadata-only changes, ...). Deliberately not dropped -
    /// `index`'s debounce layer decides what matters, this trait must not decide for it.
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WatchEvent {
    pub path: PathBuf,
    pub kind: WatchEventKind,
}

/// Keeps a watch alive for as long as it is held; dropping it stops the underlying OS watch.
/// The receiver is where raw events arrive - `index` owns polling/select-ing it.
pub struct WatchHandle {
    pub events: Receiver<WatchEvent>,
    // Type-erased so this struct stays OS-agnostic; the concrete watcher (e.g.
    // notify::RecommendedWatcher) just needs to live exactly as long as this handle.
    _guard: Box<dyn std::any::Any + Send>,
}

impl WatchHandle {
    pub fn new(events: Receiver<WatchEvent>, guard: impl std::any::Any + Send) -> Self {
        Self { events, _guard: Box::new(guard) }
    }
}

pub trait FileWatcher: Send + Sync {
    /// Watches `root` recursively. Events keep arriving on the returned handle's channel until
    /// the handle is dropped.
    fn watch(&self, root: &Path) -> Result<WatchHandle, PlatformError>;
}
