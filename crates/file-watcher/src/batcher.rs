//! Bündelt rohe Watch-Events zu Paketen. Reine Logik: keine Threads, kein Dateisystem.
//! Die Uhrzeit (`Instant`) und die Frage "war das mein eigener Schreibvorgang?" kommen von außen.

use crate::ignore::IgnoreRules;
use platform::fs::path_key;
use platform::{WatchEvent, WatchEventKind};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct WatchConfig {
    /// Wie lange es ruhig sein muss, bis ein Paket kommt.
    pub quiet: Duration,
    /// Längste Wartezeit bei Dauerfeuer.
    pub max_wait: Duration,
    /// Mehr rohe Events als das: "Flut", der Empfänger gleicht alles ab.
    pub flood_threshold: usize,
    /// Ab so vielen rohen Events besteht der Verdacht, dass der OS-Puffer übergelaufen ist.
    pub suspect_overflow: usize,
    /// Ruhezeit für npm-Änderungen (ohne Max-Wartezeit).
    pub npm_quiet: Duration,
    pub ignore: IgnoreRules,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            quiet: Duration::from_millis(400),
            max_wait: Duration::from_secs(2),
            flood_threshold: 200,
            suspect_overflow: 64,
            npm_quiet: Duration::from_secs(3),
            ignore: IgnoreRules::standard(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TouchedPath {
    pub path: PathBuf,
    /// Die App hat diese Änderung selbst geschrieben.
    pub own: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloodReason {
    TooManyEvents(usize),
    GitHead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RescanReason {
    OsReported,
    WatcherError,
    SuspectedOverflow,
    WatchRootGone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchKind {
    Normal,
    /// So viele Änderungen, dass einzelne Pfade nichts bringen (`paths` ist leer).
    Flood(FloodReason),
    /// Events können verloren gegangen sein (`paths` ist leer).
    Rescan(RescanReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    pub root: PathBuf,
    pub paths: Vec<TouchedPath>,
    pub kind: BatchKind,
    /// npm hat etwas geändert (`package-lock.json`, `node_modules/.package-lock.json`, `node_modules` selbst).
    pub modules_changed: bool,
    pub raw_events: usize,
    /// Viele Events auf einmal: der Empfänger soll nach dem Einspielen zur Sicherheit abgleichen.
    pub verify_after: bool,
}

type OwnCheck = Box<dyn Fn(&Path) -> bool + Send>;

pub struct Batcher {
    root: PathBuf,
    root_key: String,
    cfg: WatchConfig,
    own: OwnCheck,
    pending: BTreeMap<String, PathBuf>,
    raw: usize,
    first: Option<Instant>,
    last: Option<Instant>,
    flood: Option<FloodReason>,
    rescan: Option<(RescanReason, Instant)>,
    modules_last: Option<Instant>,
}

impl Batcher {
    pub fn new(root: &Path, cfg: WatchConfig, own: OwnCheck) -> Self {
        Self {
            root: root.to_path_buf(),
            root_key: path_key(root),
            cfg,
            own,
            pending: BTreeMap::new(),
            raw: 0,
            first: None,
            last: None,
            flood: None,
            rescan: None,
            modules_last: None,
        }
    }

    /// Path inside the project ('/'-separated, original case) or `None` when outside.
    fn rel_of(&self, path: &Path) -> Option<String> {
        let key = path_key(path);
        let rest = key.strip_prefix(&self.root_key)?;
        if !rest.is_empty() && !rest.starts_with('/') {
            return None;
        }
        // Original case: cut the same number of components off the real path.
        let skip = self.root.components().count();
        let comps: Vec<String> = path.components().skip(skip).map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        Some(comps.join("/"))
    }

    pub fn push_rescan(&mut self, reason: RescanReason, now: Instant) {
        if self.rescan.is_none() {
            self.rescan = Some((reason, now));
        }
    }

    pub fn push(&mut self, event: WatchEvent, now: Instant) {
        if event.kind == WatchEventKind::Rescan {
            self.push_rescan(RescanReason::OsReported, now);
            return;
        }
        let Some(rel) = self.rel_of(&event.path) else { return };
        let lower = rel.to_lowercase();

        // npm: only a trigger, never a path.
        if matches!(lower.as_str(), "package-lock.json" | "node_modules/.package-lock.json" | "node_modules") {
            self.modules_last = Some(now);
            return;
        }
        // A branch switch: Git writes HEAD (and ORIG_HEAD on pull/reset).
        if lower == ".git/head" || lower == ".git/orig_head" {
            self.count(now);
            self.flood.get_or_insert(FloodReason::GitHead);
            self.pending.clear();
            return;
        }
        if self.cfg.ignore.is_ignored(&rel) {
            return;
        }
        self.count(now);
        if self.flood.is_some() {
            return;
        }
        if self.raw > self.cfg.flood_threshold {
            self.flood = Some(FloodReason::TooManyEvents(self.raw));
            self.pending.clear();
            return;
        }
        self.pending.entry(path_key(&event.path)).or_insert(event.path);
    }

    fn count(&mut self, now: Instant) {
        self.raw += 1;
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    fn has_normal(&self) -> bool {
        self.first.is_some()
    }

    fn normal_deadline(&self) -> Option<Instant> {
        let (first, last) = (self.first?, self.last?);
        Some((last + self.cfg.quiet).min(first + self.cfg.max_wait))
    }

    /// Wann `poll` frühestens etwas liefert (für `recv_timeout`).
    pub fn deadline(&self) -> Option<Instant> {
        let mut best: Option<Instant> = self.rescan.map(|(_, at)| at);
        for d in [self.normal_deadline(), self.modules_last.map(|t| t + self.cfg.npm_quiet)].into_iter().flatten() {
            best = Some(best.map_or(d, |b| b.min(d)));
        }
        best
    }

    pub fn poll(&mut self, now: Instant) -> Option<Batch> {
        let rescan = self.rescan.take();
        let normal_due = self.has_normal() && self.normal_deadline().is_some_and(|d| now >= d);
        let modules_due = self.modules_last.is_some_and(|t| now >= t + self.cfg.npm_quiet);
        if rescan.is_none() && !normal_due && !modules_due {
            return None;
        }
        if modules_due {
            self.modules_last = None;
        }
        let mut batch = Batch { root: self.root.clone(), paths: Vec::new(), kind: BatchKind::Normal, modules_changed: modules_due, raw_events: 0, verify_after: false };
        if rescan.is_some() || normal_due {
            batch.raw_events = self.raw;
            batch.verify_after = self.raw >= self.cfg.suspect_overflow;
            batch.kind = match (rescan, self.flood) {
                (Some((reason, _)), _) => BatchKind::Rescan(reason),
                (None, Some(f)) => BatchKind::Flood(f),
                (None, None) => BatchKind::Normal,
            };
            if batch.kind == BatchKind::Normal {
                batch.paths = std::mem::take(&mut self.pending)
                    .into_values()
                    .map(|path| {
                        let own = (self.own)(&path);
                        TouchedPath { path, own }
                    })
                    .collect();
            }
            self.pending.clear();
            self.raw = 0;
            self.first = None;
            self.last = None;
            self.flood = None;
        }
        Some(batch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(path: &str, kind: WatchEventKind) -> WatchEvent {
        WatchEvent { path: PathBuf::from(path), kind }
    }

    fn batcher() -> Batcher {
        Batcher::new(Path::new("C:/proj"), WatchConfig::default(), Box::new(|_| false))
    }

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    #[test]
    fn quiet_period_gives_one_batch_with_merged_paths() {
        let t0 = Instant::now();
        let mut b = batcher();
        b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), t0);
        b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), ms(t0, 50));
        b.push(ev("C:/proj/entity/B/B.aod", WatchEventKind::Created), ms(t0, 100));
        assert!(b.poll(ms(t0, 300)).is_none(), "still within the quiet period");
        let batch = b.poll(ms(t0, 501)).unwrap();
        assert_eq!(batch.kind, BatchKind::Normal);
        assert_eq!(batch.paths.len(), 2);
        assert_eq!(batch.raw_events, 3);
        assert!(b.poll(ms(t0, 600)).is_none());
    }

    #[test]
    fn steady_fire_is_cut_after_max_wait() {
        let t0 = Instant::now();
        let mut b = batcher();
        for i in 0..30 {
            b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), ms(t0, i * 100));
        }
        // last event at 2900 ms; quiet would end at 3300, max wait ended at 2000
        let batch = b.poll(ms(t0, 3000)).unwrap();
        assert_eq!(batch.kind, BatchKind::Normal);
        let mut b = batcher();
        for i in 0..15 {
            b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), ms(t0, i * 100));
        }
        assert!(b.poll(ms(t0, 1500)).is_none());
        assert!(b.poll(ms(t0, 2000)).is_some());
    }

    #[test]
    fn too_many_events_is_a_flood_without_paths() {
        let t0 = Instant::now();
        let mut b = batcher();
        for i in 0..201 {
            b.push(ev(&format!("C:/proj/entity/E{i}/E{i}.aod"), WatchEventKind::Modified), t0);
        }
        let batch = b.poll(ms(t0, 500)).unwrap();
        assert_eq!(batch.kind, BatchKind::Flood(FloodReason::TooManyEvents(201)));
        assert!(batch.paths.is_empty());
        assert!(batch.verify_after);
    }

    #[test]
    fn git_head_is_a_flood() {
        let t0 = Instant::now();
        let mut b = batcher();
        b.push(ev("C:/proj/.git/HEAD", WatchEventKind::Modified), t0);
        b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), t0);
        let batch = b.poll(ms(t0, 500)).unwrap();
        assert_eq!(batch.kind, BatchKind::Flood(FloodReason::GitHead));
    }

    #[test]
    fn suspicious_event_count_asks_for_verification() {
        let t0 = Instant::now();
        let mut b = batcher();
        for i in 0..64 {
            b.push(ev(&format!("C:/proj/entity/E{i}/E{i}.aod"), WatchEventKind::Modified), t0);
        }
        let batch = b.poll(ms(t0, 500)).unwrap();
        assert_eq!(batch.kind, BatchKind::Normal);
        assert_eq!(batch.paths.len(), 64);
        assert!(batch.verify_after);
    }

    #[test]
    fn rescan_goes_through_at_once() {
        let t0 = Instant::now();
        let mut b = batcher();
        b.push(ev("C:/proj", WatchEventKind::Rescan), t0);
        let batch = b.poll(t0).unwrap();
        assert_eq!(batch.kind, BatchKind::Rescan(RescanReason::OsReported));
        assert!(batch.paths.is_empty());
    }

    #[test]
    fn ignored_paths_never_count() {
        let t0 = Instant::now();
        let mut b = batcher();
        b.push(ev("C:/proj/node_modules/x/y.aod", WatchEventKind::Modified), t0);
        b.push(ev("C:/proj/dist/a.js", WatchEventKind::Modified), t0);
        b.push(ev("C:/proj/entity/A/.A.aod.1.2.tmp", WatchEventKind::Created), t0);
        b.push(ev("D:/elsewhere/a.aod", WatchEventKind::Modified), t0);
        assert!(b.deadline().is_none());
        assert!(b.poll(ms(t0, 5000)).is_none());
    }

    #[test]
    fn own_writes_are_marked() {
        let t0 = Instant::now();
        let mut b = Batcher::new(Path::new("C:/proj"), WatchConfig::default(), Box::new(|p| p.ends_with("A.aod")));
        b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), t0);
        b.push(ev("C:/proj/entity/B/B.aod", WatchEventKind::Modified), t0);
        let batch = b.poll(ms(t0, 500)).unwrap();
        let own: Vec<bool> = batch.paths.iter().map(|p| p.own).collect();
        assert_eq!(own, vec![true, false]);
    }

    #[test]
    fn npm_install_over_20_seconds_gives_exactly_one_modules_changed() {
        let t0 = Instant::now();
        let mut b = batcher();
        let mut modules_batches = 0;
        for i in 0..200u64 {
            let now = ms(t0, i * 100);
            b.push(ev("C:/proj/node_modules/.package-lock.json", WatchEventKind::Modified), now);
            b.push(ev("C:/proj/node_modules", WatchEventKind::Modified), now);
            if let Some(batch) = b.poll(now) {
                if batch.modules_changed {
                    modules_batches += 1;
                }
            }
        }
        assert_eq!(modules_batches, 0, "no batch while npm still writes");
        let batch = b.poll(ms(t0, 20_000 + 3_001)).unwrap();
        assert!(batch.modules_changed);
        assert!(batch.paths.is_empty());
        assert!(b.poll(ms(t0, 40_000)).is_none());
    }

    #[test]
    fn deadline_matches_the_next_due_time() {
        let t0 = Instant::now();
        let mut b = batcher();
        assert!(b.deadline().is_none());
        b.push(ev("C:/proj/entity/A/A.aod", WatchEventKind::Modified), t0);
        assert_eq!(b.deadline(), Some(ms(t0, 400)));
    }
}
