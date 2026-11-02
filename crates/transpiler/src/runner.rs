// Runs the official headless TranspilerCLI (nbexec64.exe --projecthome ...) as a child
// process and reports the outcome. Built directly on std::process::Command per this round's
// scope decision: the later, platform-neutral `platform::ProcessSpawner` abstraction
// (architecture.md §8) does not exist yet, and wiring this crate to it is a separate
// integration round. `TranspilerRunner` is the seam that integration will need: it lets a
// caller swap the process-spawning mechanism without touching exit-code interpretation or
// event translation, both of which are pure/tested independent of how the process was
// spawned (see exit_code.rs, events.rs).

use crate::config::TranspilerConfig;
use crate::error::TranspilerError;
use crate::events::{classify_line, EventSink, LogStream, TranspileEvent};
use crate::exit_code::{interpret_exit_code, ExitOutcome};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

static ACTIVE_PID: AtomicU32 = AtomicU32::new(0);
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Ends the running TranspilerCLI with its whole process tree (the JVM is a child of nbexec).
/// False when no run is active. The run then returns with a failure outcome; `take_cancelled`
/// tells a cancelled run from a failed one.
pub fn cancel_active_run() -> bool {
    let pid = ACTIVE_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return false;
    }
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    platform::process::kill_process_tree(pid);
    true
}

/// True once if the last run ended because of `cancel_active_run`.
pub fn take_cancelled() -> bool {
    CANCEL_REQUESTED.swap(false, Ordering::SeqCst)
}

/// Final result of one TranspilerCLI run.
#[derive(Clone, Debug)]
pub struct TranspileOutcome {
    pub exit_code: Option<i32>,
    pub outcome: ExitOutcome,
}

impl TranspileOutcome {
    pub fn is_success(&self) -> bool {
        self.outcome.is_success()
    }
}

/// Narrow seam around "run the transpiler against a project and stream events back".
/// Deliberately does not expose process/command details - a future implementation backed by
/// `platform::ProcessSpawner` can satisfy this trait without changing any caller.
pub trait TranspilerRunner {
    fn run(&self, project_home: &Path, on_event: EventSink) -> Result<TranspileOutcome, TranspilerError>;
}

/// `TranspilerRunner` implementation using the verified `nbexec64.exe --projecthome ...`
/// invocation (official-transpiler-invocation.md), spawned directly via
/// `std::process::Command`.
pub struct NbexecTranspilerRunner {
    config: TranspilerConfig,
}

impl NbexecTranspilerRunner {
    pub fn new(config: TranspilerConfig) -> Self {
        Self { config }
    }

    fn build_command(&self, project_home: &Path) -> Command {
        let mut cmd = platform::console::command(self.config.nbexec_path());
        platform::process::own_process_group(&mut cmd);
        cmd.arg("--clusters")
            .arg(self.config.clusters_arg())
            .arg("--userdir")
            .arg(&self.config.user_dir)
            .arg("--cachedir")
            .arg(self.config.cachedir())
            .arg("--jdkhome")
            .arg(self.config.jdkhome())
            .arg("--nogui")
            .arg("--nosplash")
            .arg("-J-Djava.awt.headless=true")
            .arg("-J-Xms64m")
            .arg("-J-Xmx2048m")
            .arg("--projecthome")
            .arg(project_home)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }
}

impl TranspilerRunner for NbexecTranspilerRunner {
    fn run(&self, project_home: &Path, on_event: EventSink) -> Result<TranspileOutcome, TranspilerError> {
        if !project_home.is_dir() {
            return Err(TranspilerError::ProjectHomeNotFound(project_home.to_path_buf()));
        }
        let nbexec_path = self.config.nbexec_path();
        if !nbexec_path.is_file() {
            return Err(TranspilerError::LauncherNotFound(nbexec_path));
        }

        // The NetBeans launcher behind TranspilerCLI is single-instance per userdir: a second
        // run against the same userdir does not start its own transpilation but hands its
        // arguments to the already running instance, which then fails both runs (observed:
        // exit 150 for the first, -255 for the second, RISKS.md R43). Runs sharing a userdir
        // therefore have to be strictly one after another, also across separate processes.
        let _userdir_guard = acquire_userdir_lock(&self.config.user_dir)?;

        let mut child = self.build_command(project_home).spawn().map_err(TranspilerError::Spawn)?;

        let pid = child.id();
        CANCEL_REQUESTED.store(false, Ordering::SeqCst);
        ACTIVE_PID.store(pid, Ordering::SeqCst);
        let stdout = child.stdout.take().ok_or(TranspilerError::MissingStdioHandle)?;
        let stderr = child.stderr.take().ok_or(TranspilerError::MissingStdioHandle)?;

        let sink_out = on_event.clone();
        let out_handle = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                for event in classify_line(LogStream::Stdout, &line) {
                    sink_out(event);
                }
            }
        });

        let sink_err = on_event.clone();
        let err_handle = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                for event in classify_line(LogStream::Stderr, &line) {
                    sink_err(event);
                }
            }
        });

        let finished = Arc::new(AtomicBool::new(false));
        let finished_watchdog = finished.clone();
        let timeout = self.config.timeout;
        std::thread::spawn(move || {
            std::thread::sleep(timeout);
            if !finished_watchdog.load(Ordering::SeqCst) {
                // The whole process tree is killed (the launcher spawns a JVM child that does
                // the actual transpilation work).
                platform::process::kill_process_tree(pid);
            }
        });

        let wait_result = child.wait();
        finished.store(true, Ordering::SeqCst);
        ACTIVE_PID.store(0, Ordering::SeqCst);

        let _ = out_handle.join();
        let _ = err_handle.join();

        let status = wait_result.map_err(TranspilerError::Wait)?;
        let exit_code = status.code();
        let timed_out = exit_code.is_none();
        let outcome = interpret_exit_code(exit_code, timed_out);

        on_event(TranspileEvent::Done { exit_code, outcome: outcome.clone() });

        Ok(TranspileOutcome { exit_code, outcome })
    }
}

/// Name of the lock file Forge keeps inside a transpiler userdir. Not a NetBeans file - the
/// platform ignores unknown files in its userdir root.
pub const USERDIR_LOCK_FILE_NAME: &str = "forge-transpile.lock";

/// Blocks until this process holds the exclusive right to run TranspilerCLI against `user_dir`.
/// The returned file keeps the OS-level lock until it is dropped.
pub fn acquire_userdir_lock(user_dir: &Path) -> Result<std::fs::File, TranspilerError> {
    std::fs::create_dir_all(user_dir).map_err(TranspilerError::UserdirLock)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(user_dir.join(USERDIR_LOCK_FILE_NAME))
        .map_err(TranspilerError::UserdirLock)?;
    file.lock().map_err(TranspilerError::UserdirLock)?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_rejects_a_project_home_that_does_not_exist() {
        let config = TranspilerConfig::new(r"C:\install", r"C:\scratch\userdir");
        let runner = NbexecTranspilerRunner::new(config);
        let sink: EventSink = Arc::new(|_event| {});
        let result = runner.run(Path::new(r"C:\this\path\does\not\exist"), sink);
        assert!(matches!(result, Err(TranspilerError::ProjectHomeNotFound(_))));
    }

    #[test]
    fn a_second_run_against_the_same_userdir_waits_for_the_first() {
        let user_dir = std::env::temp_dir().join(format!("forge-userdir-lock-test-{}", std::process::id()));
        let first = acquire_userdir_lock(&user_dir).expect("first lock");
        let other_handle = std::fs::OpenOptions::new()
            .write(true)
            .open(user_dir.join(USERDIR_LOCK_FILE_NAME))
            .unwrap();
        assert!(other_handle.try_lock().is_err(), "userdir must be busy while the first run holds it");
        drop(first);
        assert!(other_handle.try_lock().is_ok(), "userdir must be free again once the first run ended");
        drop(other_handle);
        let _ = std::fs::remove_dir_all(&user_dir);
    }
}
