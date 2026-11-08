//! Crash and error log of the app: a panic anywhere (backend thread, actor, command) is written
//! to a log file in the app data folder instead of vanishing, so a user can send it in. The log
//! never contains credentials: tunnel passwords and database passwords only live in memory and
//! are additionally masked by `scrub` before any text reaches the file.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::scrub::scrub;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static ON_PANIC: Mutex<Option<Box<dyn Fn(&str, &Path) + Send + Sync>>> = Mutex::new(None);

/// Sets the folder the log files go to (`<app data>/logs`) and creates it.
pub fn set_log_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_DIR.set(dir);
}

#[must_use]
pub fn log_dir() -> PathBuf {
    LOG_DIR.get().cloned().unwrap_or_else(|| std::env::temp_dir().join("dito-designer-logs"))
}

/// Registers what the app does after a panic was logged (show an error dialog to the user).
pub fn set_panic_notifier(f: impl Fn(&str, &Path) + Send + Sync + 'static) {
    if let Ok(mut slot) = ON_PANIC.lock() {
        *slot = Some(Box::new(f));
    }
}

/// `YYYY-MM-DD HH:MM:SS` in UTC from the system clock (no time zone database needed for a log).
#[must_use]
pub fn timestamp_utc() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

static APP_VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// The version of the app (not of this library) that the log entries name.
pub fn set_app_version(version: &str) {
    let _ = APP_VERSION.set(version.to_string());
}

/// Appends one entry to today's log file and returns the file path.
pub fn write_entry(kind: &str, message: &str) -> Option<PathBuf> {
    let dir = log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let stamp = timestamp_utc();
    let file = dir.join(format!("dito-designer-{}.log", &stamp[..10]));
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&file).ok()?;
    let text = scrub(message);
    writeln!(f, "[{stamp} UTC] [{kind}] version {}\n{text}\n", APP_VERSION.get().map(String::as_str).unwrap_or(env!("CARGO_PKG_VERSION"))).ok()?;
    Some(file)
}

fn panic_text(info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    let message = payload.downcast_ref::<&str>().map(|s| (*s).to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic without message".to_string());
    let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "unknown location".to_string());
    let thread = std::thread::current();
    format!("thread '{}' panicked at {location}\n{message}\n{}", thread.name().unwrap_or("<unnamed>"), std::backtrace::Backtrace::force_capture())
}

/// Replaces the default panic output (which is invisible in a windowed release build) by a log
/// entry plus the registered notifier. Idempotent in effect: the previous hook is still called.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let text = panic_text(info);
        let file = write_entry("PANIC", &text);
        if let (Some(file), Ok(slot)) = (file, ON_PANIC.lock()) {
            if let Some(notify) = slot.as_ref() {
                notify(&scrub(&text.lines().take(2).collect::<Vec<_>>().join(" ")), &file);
            }
        }
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_has_the_expected_shape_and_epoch_math_is_right() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_000), (2024, 10, 4));
        assert_eq!(timestamp_utc().len(), 19);
    }

    #[test]
    fn a_panic_is_written_to_the_log_with_message_and_location() {
        let dir = std::env::temp_dir().join(format!("forge-crashlog-{}", std::process::id()));
        set_log_dir(dir.clone());
        install_panic_hook();
        let handle = std::thread::Builder::new().name("log-test".into()).spawn(|| panic!("boom password=abc123")).unwrap();
        assert!(handle.join().is_err());
        let log = std::fs::read_dir(log_dir()).unwrap().flatten().map(|e| std::fs::read_to_string(e.path()).unwrap()).collect::<String>();
        assert!(log.contains("[PANIC]") && log.contains("boom password=***") && log.contains("crashlog.rs"), "{log}");
        assert!(!log.contains("abc123"));
    }
}
