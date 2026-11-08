//! Real `TranspilerRunner` implementation backed by `platform::ProcessSpawner`
//! (architecture.md §5/§8, integration round). Added *alongside* the existing, independently
//! verified `runner::NbexecTranspilerRunner` (std::process::Command-based) rather than replacing
//! it - the exit-code interpretation (`exit_code.rs`) and log-line classification (`events.rs`)
//! this crate already proved are reused unchanged; only the process-spawning mechanism itself is
//! swapped for the platform-neutral seam ADR-0004 requires `designer-core` to depend on.

use crate::config::TranspilerConfig;
use crate::error::TranspilerError;
use crate::events::{classify_line, EventSink, LogStream, TranspileEvent};
use crate::exit_code::interpret_exit_code;
use crate::runner::{TranspileOutcome, TranspilerRunner};
use platform::{LineSink, OutputLine, OutputStream, ProcessSpawner, SpawnRequest};
use std::path::Path;
use std::sync::Arc;

/// `TranspilerRunner` that delegates process spawning to any `platform::ProcessSpawner`
/// implementation, keeping this crate free of `std::process::Command` for this path (ADR-0004
/// rule 1: only `platform` may touch OS process APIs directly).
pub struct PlatformTranspilerRunner<P: ProcessSpawner> {
    config: TranspilerConfig,
    spawner: Arc<P>,
}

impl<P: ProcessSpawner> PlatformTranspilerRunner<P> {
    pub fn new(config: TranspilerConfig, spawner: Arc<P>) -> Self {
        PlatformTranspilerRunner { config, spawner }
    }

    /// Builds the same `nbexec64.exe --projecthome ...` argument list as
    /// `runner::NbexecTranspilerRunner::build_command` (official-transpiler-invocation.md),
    /// expressed as a platform-neutral `SpawnRequest` instead of a `std::process::Command`.
    fn build_request(&self, project_home: &Path) -> SpawnRequest {
        SpawnRequest::new(self.config.nbexec_path(), self.config.timeout)
            .arg("--clusters")
            .arg(self.config.clusters_arg())
            .arg("--userdir")
            .arg(self.config.user_dir.to_string_lossy().into_owned())
            .arg("--cachedir")
            .arg(self.config.cachedir().to_string_lossy().into_owned())
            .arg("--jdkhome")
            .arg(self.config.jdkhome().to_string_lossy().into_owned())
            .arg("--nogui")
            .arg("--nosplash")
            .arg("-J-Djava.awt.headless=true")
            .arg("-J-Xms64m")
            .arg("-J-Xmx2048m")
            .arg("--projecthome")
            .arg(project_home.to_string_lossy().into_owned())
    }
}

impl<P: ProcessSpawner> TranspilerRunner for PlatformTranspilerRunner<P> {
    fn run(&self, project_home: &Path, on_event: EventSink) -> Result<TranspileOutcome, TranspilerError> {
        if !project_home.is_dir() {
            return Err(TranspilerError::ProjectHomeNotFound(project_home.to_path_buf()));
        }
        let nbexec_path = self.config.nbexec_path();
        if !nbexec_path.is_file() {
            return Err(TranspilerError::LauncherNotFound(nbexec_path));
        }

        let request = self.build_request(project_home);

        // Translate platform::OutputLine (raw stdout/stderr text) into transpiler::TranspileEvent
        // via the crate's own, already-tested classify_line - the log-line vocabulary and
        // progress-stage detection stay identical regardless of which spawner produced the line.
        let sink = on_event.clone();
        let line_sink: LineSink = Arc::new(move |line: OutputLine| {
            let stream = match line.stream {
                OutputStream::Stdout => LogStream::Stdout,
                OutputStream::Stderr => LogStream::Stderr,
            };
            for event in classify_line(stream, &line.line) {
                sink(event);
            }
        });

        let spawn_outcome = self.spawner.spawn(request, line_sink).map_err(|source| {
            TranspilerError::Spawn(std::io::Error::new(std::io::ErrorKind::Other, source.to_string()))
        })?;

        let outcome = interpret_exit_code(spawn_outcome.exit_code, spawn_outcome.timed_out);
        on_event(TranspileEvent::Done { exit_code: spawn_outcome.exit_code, outcome: outcome.clone() });

        Ok(TranspileOutcome { exit_code: spawn_outcome.exit_code, outcome })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use platform::{PlatformError, SpawnOutcome};

    /// Deterministic `ProcessSpawner` stand-in: instead of starting a real process, immediately
    /// feeds a canned set of output lines to `on_line` and returns a fixed `SpawnOutcome`. Proves
    /// the adapter's translation logic (SpawnRequest shape, OutputLine -> TranspileEvent, exit
    /// code -> ExitOutcome) without needing a real nbexec64.exe.
    struct FakeSpawner {
        lines: Vec<OutputLine>,
        outcome: SpawnOutcome,
    }

    impl ProcessSpawner for FakeSpawner {
        fn spawn(&self, _request: SpawnRequest, on_line: LineSink) -> Result<SpawnOutcome, PlatformError> {
            for line in &self.lines {
                on_line(line.clone());
            }
            Ok(self.outcome.clone())
        }
    }

    fn config() -> TranspilerConfig {
        TranspilerConfig::new(r"C:\install", r"C:\scratch\userdir")
    }

    fn project_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("designer-core-platform-runner-test-{}", std::process::id()))
    }

    #[test]
    fn run_translates_output_lines_and_reports_success_via_the_fake_spawner() {
        let dir = project_dir();
        std::fs::create_dir_all(&dir).unwrap();

        let spawner = Arc::new(FakeSpawner {
            lines: vec![OutputLine {
                stream: OutputStream::Stdout,
                line: "[INFO] Opened project .../testproject successfully".to_string(),
            }],
            outcome: SpawnOutcome { exit_code: Some(0), timed_out: false },
        });
        // build_request would look for nbexec_path().is_file() - point install_dir at this
        // temp project dir's own directory so the pre-flight is skipped by using the project
        // dir itself as a stand-in "installation" only for the file-exists check below.
        let mut cfg = config();
        cfg.install_dir = dir.clone();
        let nbexec_path = cfg.nbexec_path();
        std::fs::create_dir_all(nbexec_path.parent().unwrap()).unwrap();
        std::fs::write(&nbexec_path, b"stand-in launcher").unwrap();

        let runner = PlatformTranspilerRunner::new(cfg, spawner);

        let events: Arc<std::sync::Mutex<Vec<TranspileEvent>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let sink: EventSink = Arc::new(move |event| events_clone.lock().unwrap().push(event));

        let result = runner.run(&dir, sink).expect("fake spawner run must succeed");

        assert!(result.is_success());
        let seen = events.lock().unwrap();
        assert!(seen.iter().any(|e| matches!(e, TranspileEvent::Progress(crate::events::ProgressStage::ProjectOpened))));
        assert!(seen.iter().any(|e| matches!(e, TranspileEvent::Done { exit_code: Some(0), .. })));

        std::fs::remove_dir_all(&dir).ok();
    }
}
