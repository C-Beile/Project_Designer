//! `WatchSession`: ein Thread, der die rohen Events des OS mit dem `Batcher` verbindet und fertige
//! Pakete an einen Callback gibt. `Drop` beendet alles (in C#: `IDisposable`).

use crate::batcher::{Batch, Batcher, RescanReason, WatchConfig};
use crate::watch_set;
use platform::fs::{file_stamp, take_own_write};
use platform::{FileWatcher, PlatformError, WatchEventKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often the loop looks at the stop flag and at the existence of the root.
const TICK: Duration = Duration::from_millis(250);
const ROOT_CHECK: Duration = Duration::from_secs(2);

pub struct WatchSession {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WatchSession {
    /// Starts watching `root`. `on_batch` runs on the session thread; keep it short (hand over to a queue).
    pub fn start(root: &Path, watcher: Arc<dyn FileWatcher>, cfg: WatchConfig, on_batch: impl Fn(Batch) + Send + 'static) -> Result<Self, PlatformError> {
        Self::start_with(root, watcher, cfg, Box::new(|p| take_own_write(p, file_stamp(p))), on_batch)
    }

    /// Like `start`, with your own "was that my write?" check (tests).
    pub fn start_with(
        root: &Path,
        watcher: Arc<dyn FileWatcher>,
        cfg: WatchConfig,
        own: Box<dyn Fn(&Path) -> bool + Send>,
        on_batch: impl Fn(Batch) + Send + 'static,
    ) -> Result<Self, PlatformError> {
        let targets = watch_set::initial_targets(root, &cfg.ignore);
        let handle = watcher.watch_targets(&targets)?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let root: PathBuf = root.to_path_buf();
        let rules = cfg.ignore.clone();
        let mut batcher = Batcher::new(&root, cfg, own);
        let thread = std::thread::Builder::new()
            .name("forge-file-watcher".into())
            .spawn(move || {
                let mut root_gone_reported = false;
                let mut last_root_check = Instant::now();
                loop {
                    if stop_thread.load(Ordering::Relaxed) {
                        return;
                    }
                    let now = Instant::now();
                    let wait = batcher.deadline().map_or(TICK, |d| d.saturating_duration_since(now)).min(TICK);
                    match handle.events.recv_timeout(wait) {
                        Ok(event) => {
                            if event.kind == WatchEventKind::Created {
                                if let Some(t) = watch_set::target_for_created(&root, &event.path, &rules) {
                                    if handle.add(&t).is_err() {
                                        batcher.push_rescan(RescanReason::WatcherError, Instant::now());
                                    }
                                }
                            }
                            batcher.push(event, Instant::now());
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => {
                            batcher.push_rescan(RescanReason::WatcherError, Instant::now());
                            if let Some(batch) = batcher.poll(Instant::now()) {
                                on_batch(batch);
                            }
                            return;
                        }
                    }
                    if !root_gone_reported && last_root_check.elapsed() >= ROOT_CHECK {
                        last_root_check = Instant::now();
                        if !root.exists() {
                            root_gone_reported = true;
                            batcher.push_rescan(RescanReason::WatchRootGone, Instant::now());
                        }
                    }
                    // Overflow suspicion is reported by the batch itself (`verify_after`).
                    while let Some(batch) = batcher.poll(Instant::now()) {
                        on_batch(batch);
                    }
                }
            })
            .map_err(|source| PlatformError::Watch { path: root_for_error(), source })?;
        Ok(Self { stop, thread: Some(thread) })
    }
}

fn root_for_error() -> PathBuf {
    PathBuf::new()
}

impl Drop for WatchSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::batcher::BatchKind;
    use platform::{WatchEvent, WatchHandle, WatchTarget};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;

    /// Watcher that hands the test the sending end of its channel.
    struct FakeWatcher {
        tx: Mutex<Option<Sender<WatchEvent>>>,
        targets: Mutex<Vec<WatchTarget>>,
    }

    impl FileWatcher for FakeWatcher {
        fn watch_targets(&self, targets: &[WatchTarget]) -> Result<WatchHandle, PlatformError> {
            *self.targets.lock().unwrap() = targets.to_vec();
            let (tx, rx) = channel();
            *self.tx.lock().unwrap() = Some(tx);
            Ok(WatchHandle::new(rx, ()))
        }
    }

    fn fast_cfg() -> WatchConfig {
        WatchConfig { quiet: Duration::from_millis(40), max_wait: Duration::from_millis(200), ..WatchConfig::default() }
    }

    #[test]
    fn events_arrive_as_one_batch_and_drop_stops_the_thread() {
        let root = std::env::temp_dir().join(format!("forge-fw-session-{}", std::process::id()));
        std::fs::create_dir_all(root.join("entity")).unwrap();
        let fake = Arc::new(FakeWatcher { tx: Mutex::new(None), targets: Mutex::new(Vec::new()) });
        let got: Arc<Mutex<Vec<Batch>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let session = WatchSession::start_with(&root, fake.clone(), fast_cfg(), Box::new(|_| false), move |b| sink.lock().unwrap().push(b)).unwrap();
        assert!(fake.targets.lock().unwrap().iter().any(|t| t.path == root.join("entity") && t.recursive));

        let tx = fake.tx.lock().unwrap().clone().unwrap();
        let f = root.join("entity").join("A.aod");
        tx.send(WatchEvent { path: f.clone(), kind: WatchEventKind::Modified }).unwrap();
        tx.send(WatchEvent { path: f.clone(), kind: WatchEventKind::Modified }).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        {
            let batches = got.lock().unwrap();
            assert_eq!(batches.len(), 1);
            assert_eq!(batches[0].kind, BatchKind::Normal);
            assert_eq!(batches[0].paths.len(), 1);
        }
        drop(session);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_dead_watcher_channel_becomes_a_rescan() {
        let root = std::env::temp_dir().join(format!("forge-fw-session-dead-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let fake = Arc::new(FakeWatcher { tx: Mutex::new(None), targets: Mutex::new(Vec::new()) });
        let got: Arc<Mutex<Vec<Batch>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let _session = WatchSession::start_with(&root, fake.clone(), fast_cfg(), Box::new(|_| false), move |b| sink.lock().unwrap().push(b)).unwrap();
        fake.tx.lock().unwrap().take(); // drops the only sender
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(got.lock().unwrap()[0].kind, BatchKind::Rescan(RescanReason::WatcherError));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn real_watcher_reports_a_new_file() {
        let root = std::env::temp_dir().join(format!("forge-fw-session-real-{}", std::process::id()));
        std::fs::create_dir_all(root.join("entity")).unwrap();
        let got: Arc<Mutex<Vec<Batch>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = got.clone();
        let session = WatchSession::start_with(&root, Arc::new(platform::native::NotifyFileWatcher::new()), fast_cfg(), Box::new(|_| false), move |b| sink.lock().unwrap().push(b)).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let f = root.join("entity").join("New.aod");
        std::fs::write(&f, b"<x/>").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = false;
        while !seen && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            seen = got.lock().unwrap().iter().any(|b| b.paths.iter().any(|p| platform::fs::path_key(&p.path) == platform::fs::path_key(&f)));
        }
        assert!(seen, "expected a batch with {f:?}");
        drop(session);
        std::fs::remove_dir_all(&root).ok();
    }
}
