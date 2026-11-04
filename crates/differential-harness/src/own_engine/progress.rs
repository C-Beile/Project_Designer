//! Progress of a transpile run: the stages report how far they are (0 to 100) and what they do; the
//! application shows it in a progress bar. Without a reporter nothing happens.

use std::sync::{Arc, Mutex};

type Reporter = Arc<dyn Fn(u8, &str) + Send + Sync>;

static REPORTER: Mutex<Option<Reporter>> = Mutex::new(None);

/// Installs (or, with `None`, removes) the function that receives the progress of the next runs.
pub fn set_reporter(reporter: Option<Reporter>) {
    if let Ok(mut slot) = REPORTER.lock() {
        *slot = reporter;
    }
}

/// Reports `percent` (0 to 100) and the stage that is running now.
pub fn report(percent: u8, stage: &str) {
    let reporter = REPORTER.lock().ok().and_then(|slot| slot.clone());
    if let Some(reporter) = reporter {
        reporter(percent.min(100), stage);
    }
}

/// `from` to `to` percent, `done` of `total` steps finished.
pub fn report_between(from: u8, to: u8, done: usize, total: usize, stage: &str) {
    let span = f64::from(to.saturating_sub(from));
    let fraction = if total == 0 { 1.0 } else { done as f64 / total as f64 };
    report(from + (span * fraction) as u8, stage);
}
