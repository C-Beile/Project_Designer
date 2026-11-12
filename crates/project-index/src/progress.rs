//! Fortschritt des Aufbaus: der Empfänger und die Drosselung.

use crate::events::IndexPhase;
use std::time::{Duration, Instant};

/// Receives progress while an index is built. Called from many threads.
pub trait ProgressSink: Sync {
    /// `current` is the file that was finished last (may be skipped by a busy sink).
    fn report(&self, phase: IndexPhase, done: u32, total: u32, current: Option<&str>);
}

pub struct NullProgress;

impl ProgressSink for NullProgress {
    fn report(&self, _phase: IndexPhase, _done: u32, _total: u32, _current: Option<&str>) {}
}

/// Lets through at most one report per `interval`, plus every change of phase.
pub struct Throttle {
    interval: Duration,
    last_at: Option<Instant>,
    last_phase: Option<IndexPhase>,
}

impl Throttle {
    pub fn new(interval: Duration) -> Self {
        Self { interval, last_at: None, last_phase: None }
    }

    /// The clock comes from outside, so this is testable.
    pub fn allow(&mut self, now: Instant, phase: IndexPhase) -> bool {
        let phase_changed = self.last_phase != Some(phase);
        let due = self.last_at.is_none_or(|t| now.saturating_duration_since(t) >= self.interval);
        if phase_changed || due {
            self.last_at = Some(now);
            self.last_phase = Some(phase);
            true
        } else {
            false
        }
    }
}

/// Percent for a phase: reading 5..90, linking 90..99, ready 100; listing has none (running stripe).
pub fn percent_of(phase: IndexPhase, done: u32, total: u32) -> Option<u8> {
    match phase {
        IndexPhase::Reading if total > 0 => Some((5 + (85 * u64::from(done.min(total)) / u64::from(total))) as u8),
        IndexPhase::Reading => Some(5),
        IndexPhase::Linking => Some(95),
        IndexPhase::Ready => Some(100),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_lets_one_per_interval_and_every_phase_change() {
        let t0 = Instant::now();
        let mut t = Throttle::new(Duration::from_millis(100));
        assert!(t.allow(t0, IndexPhase::Reading));
        assert!(!t.allow(t0 + Duration::from_millis(10), IndexPhase::Reading));
        assert!(!t.allow(t0 + Duration::from_millis(99), IndexPhase::Reading));
        assert!(t.allow(t0 + Duration::from_millis(100), IndexPhase::Reading));
        assert!(t.allow(t0 + Duration::from_millis(101), IndexPhase::Linking));
    }

    #[test]
    fn percent_only_rises() {
        assert_eq!(percent_of(IndexPhase::Listing, 5, 0), None);
        assert_eq!(percent_of(IndexPhase::Reading, 0, 100), Some(5));
        assert_eq!(percent_of(IndexPhase::Reading, 100, 100), Some(90));
        assert_eq!(percent_of(IndexPhase::Linking, 0, 0), Some(95));
        assert_eq!(percent_of(IndexPhase::Ready, 0, 0), Some(100));
    }
}
