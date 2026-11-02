// Ported from transpiler::runner::NbexecTranspilerRunner (see module doc in ../process.rs):
// two reader threads for stdout/stderr, a watchdog thread that `taskkill /T /F`s the whole
// process tree on timeout. The transpiler crate proved this exact pattern against a real
// multi-minute nbexec64.exe run (spike-transpiler-wrapper.md); this is the same mechanism
// generalized to an arbitrary program/args/timeout instead of one hardcoded nbexec64.exe
// invocation.

use crate::error::PlatformError;
use crate::process::{program_exists, LineSink, OutputLine, OutputStream, ProcessSpawner, SpawnOutcome, SpawnRequest};
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct CommandProcessSpawner;

impl CommandProcessSpawner {
    pub fn new() -> Self {
        Self
    }
}

impl ProcessSpawner for CommandProcessSpawner {
    fn spawn(&self, request: SpawnRequest, on_line: LineSink) -> Result<SpawnOutcome, PlatformError> {
        if !program_exists(&request.program) {
            return Err(PlatformError::ProgramNotFound(request.program));
        }

        let mut command = crate::console::command(&request.program);
        crate::process::own_process_group(&mut command);
        command.args(&request.args).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(dir) = &request.working_dir {
            command.current_dir(dir);
        }

        let program_display = request.program.display().to_string();
        let mut child = command
            .spawn()
            .map_err(|source| PlatformError::Spawn { program: program_display, source })?;

        let pid = child.id();
        let stdout = child.stdout.take().ok_or(PlatformError::MissingStdioHandle)?;
        let stderr = child.stderr.take().ok_or(PlatformError::MissingStdioHandle)?;

        let sink_out = on_line.clone();
        let out_handle = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                sink_out(OutputLine { stream: OutputStream::Stdout, line });
            }
        });

        let sink_err = on_line.clone();
        let err_handle = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                sink_err(OutputLine { stream: OutputStream::Stderr, line });
            }
        });

        let finished = Arc::new(AtomicBool::new(false));
        let finished_watchdog = finished.clone();
        // Tracked separately from `exit_code.is_none()`: a killed Windows process still reports
        // a concrete (OS/taskkill-assigned) exit code through `wait()`, not `None` - so
        // "timed out" has to be a fact the watchdog records itself, not something inferred from
        // the exit status after the fact.
        let killed_by_watchdog = Arc::new(AtomicBool::new(false));
        let killed_flag = killed_by_watchdog.clone();
        let timeout = request.timeout;
        let watchdog = std::thread::spawn(move || {
            std::thread::sleep(timeout);
            if !finished_watchdog.load(Ordering::SeqCst) {
                // /T kills the whole process tree, matching the transpiler spike's finding that
                // nbexec64.exe spawns a JVM child which the plain PID kill would otherwise miss.
                killed_flag.store(true, Ordering::SeqCst);
                crate::process::kill_process_tree(pid);
            }
        });

        let wait_result = child.wait();
        finished.store(true, Ordering::SeqCst);

        let _ = out_handle.join();
        let _ = err_handle.join();
        let _ = watchdog.join();

        let status = wait_result.map_err(PlatformError::Wait)?;
        let exit_code = status.code();
        let timed_out = killed_by_watchdog.load(Ordering::SeqCst);

        Ok(SpawnOutcome { exit_code, timed_out })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    fn collecting_sink() -> (LineSink, Arc<Mutex<Vec<OutputLine>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink_lines = lines.clone();
        let sink: LineSink = Arc::new(move |line| sink_lines.lock().unwrap().push(line));
        (sink, lines)
    }

    #[test]
    fn runs_cmd_echo_and_collects_exit_code_and_output() {
        let spawner = CommandProcessSpawner::new();
        let request = SpawnRequest::new(PathBuf::from("cmd"), Duration::from_secs(10))
            .args(["/C", "echo hello-from-platform-test"]);
        let (sink, lines) = collecting_sink();

        let outcome = spawner.spawn(request, sink).unwrap();

        assert!(outcome.success(), "outcome = {outcome:?}");
        assert_eq!(outcome.exit_code, Some(0));
        let collected = lines.lock().unwrap();
        assert!(
            collected.iter().any(|l| l.line.contains("hello-from-platform-test")),
            "expected echoed line in captured output, got: {collected:?}"
        );
    }

    #[test]
    fn nonzero_exit_code_is_reported_faithfully() {
        let spawner = CommandProcessSpawner::new();
        let request = SpawnRequest::new(PathBuf::from("cmd"), Duration::from_secs(10)).args(["/C", "exit 7"]);
        let (sink, _lines) = collecting_sink();

        let outcome = spawner.spawn(request, sink).unwrap();

        assert!(!outcome.success());
        assert_eq!(outcome.exit_code, Some(7));
        assert!(!outcome.timed_out);
    }

    #[test]
    fn a_process_that_outlives_its_timeout_is_killed_and_reported_as_timed_out() {
        let spawner = CommandProcessSpawner::new();
        // Ping loopback with an interval well past the 2s timeout below - a resident process
        // the watchdog has to actually kill rather than something that would exit on its own
        // before the timeout fires.
        let request = SpawnRequest::new(PathBuf::from("ping"), Duration::from_secs(2))
            .args(["-n", "30", "127.0.0.1"]);
        let (sink, _lines) = collecting_sink();

        let started = std::time::Instant::now();
        let outcome = spawner.spawn(request, sink).unwrap();
        let elapsed = started.elapsed();

        assert!(outcome.timed_out, "outcome = {outcome:?}");
        assert!(!outcome.success());
        assert!(
            elapsed < Duration::from_secs(25),
            "watchdog should have killed the process well before ping's own ~30s runtime, elapsed = {elapsed:?}"
        );
    }

    #[test]
    fn an_unknown_program_is_rejected_before_spawning() {
        let spawner = CommandProcessSpawner::new();
        let request = SpawnRequest::new(
            PathBuf::from(r"C:\this\program\does\not\exist.exe"),
            Duration::from_secs(1),
        );
        let (sink, _lines) = collecting_sink();

        let result = spawner.spawn(request, sink);

        assert!(matches!(result, Err(PlatformError::ProgramNotFound(_))));
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn echo_output_and_exit_code_are_reported() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink_lines = lines.clone();
        let sink: LineSink = Arc::new(move |l| sink_lines.lock().unwrap().push(l));
        let request = SpawnRequest::new(PathBuf::from("sh"), Duration::from_secs(10)).args(["-c", "echo hello-from-platform-test; exit 3"]);
        let outcome = CommandProcessSpawner::new().spawn(request, sink).unwrap();
        assert_eq!(outcome.exit_code, Some(3));
        assert!(lines.lock().unwrap().iter().any(|l| l.line.contains("hello-from-platform-test")));
    }

    #[test]
    fn a_process_that_outlives_its_timeout_is_killed() {
        let sink: LineSink = Arc::new(|_| {});
        let request = SpawnRequest::new(PathBuf::from("sleep"), Duration::from_secs(1)).args(["30"]);
        let started = std::time::Instant::now();
        let outcome = CommandProcessSpawner::new().spawn(request, sink).unwrap();
        assert!(outcome.timed_out);
        assert!(started.elapsed() < Duration::from_secs(20));
    }
}
