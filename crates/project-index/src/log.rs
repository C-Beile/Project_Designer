//! Logging des Index ins IDE-Log (`crashlog::write_entry`). Nie XML-Inhalte oder Werte loggen
//! (Aliase und Systeme können Passwörter enthalten), nur Pfade und Parser-Meldungen.

use std::sync::atomic::{AtomicUsize, Ordering};

/// Stufen: `INFO`, `WARN`, `ERROR`, `PERF`.
pub trait IndexLog: Send + Sync {
    fn write(&self, kind: &str, message: &str);
}

/// Schreibt über `app_base::crashlog::write_entry` (Datei + Output-Reiter "IDE Log").
pub struct CrashlogIndexLog;

impl IndexLog for CrashlogIndexLog {
    fn write(&self, kind: &str, message: &str) {
        let _ = app_base::crashlog::write_entry(kind, message);
    }
}

/// Log that throws everything away.
pub struct NullLog;

impl IndexLog for NullLog {
    fn write(&self, _kind: &str, _message: &str) {}
}

/// At most `limit` warnings per build; the rest is summed up by `finish`.
pub struct WarnBudget {
    limit: usize,
    count: AtomicUsize,
}

impl WarnBudget {
    pub fn new(limit: usize) -> Self {
        Self { limit, count: AtomicUsize::new(0) }
    }

    pub fn warn(&self, log: &dyn IndexLog, message: &str) {
        let n = self.count.fetch_add(1, Ordering::Relaxed);
        if n < self.limit {
            log.write("WARN", message);
        }
    }

    /// Writes the "... and N more" line when warnings were held back.
    pub fn finish(&self, log: &dyn IndexLog, prefix: &str) {
        let n = self.count.load(Ordering::Relaxed);
        if n > self.limit {
            log.write("WARN", &format!("{prefix}: ... and {} more (see Problems tab)", n - self.limit));
        }
    }
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use std::sync::Mutex;

    /// Collects the entries.
    #[derive(Default)]
    pub struct FakeLog(pub Mutex<Vec<(String, String)>>);

    impl IndexLog for FakeLog {
        fn write(&self, kind: &str, message: &str) {
            self.0.lock().unwrap().push((kind.to_string(), message.to_string()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::FakeLog;
    use super::*;

    #[test]
    fn warnings_are_capped_and_summed_up() {
        let log = FakeLog::default();
        let budget = WarnBudget::new(20);
        for i in 0..57 {
            budget.warn(&log, &format!("broken {i}"));
        }
        budget.finish(&log, "index x");
        let entries = log.0.lock().unwrap();
        assert_eq!(entries.len(), 21);
        assert!(entries[20].1.contains("and 37 more"));
    }
}
