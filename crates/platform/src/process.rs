// Subprocess start with streamed stdout/stderr and a watchdog/timeout kill. Trait shape and
// the whole threading pattern (two reader threads + a watchdog thread + taskkill-based tree
// kill) are ported from the already-verified transpiler::runner::NbexecTranspilerRunner
// (spike-transpiler-wrapper.md / architecture.md §5) - that code proved this exact mechanism
// against a real ~5 minute subprocess (the official TranspilerCLI). This trait generalizes it
// so ProcessSpawner can run the transpiler, the LSP sidecar, or node/npm alike, behind one
// platform-neutral seam.

use crate::error::PlatformError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OutputLine {
    pub stream: OutputStream,
    pub line: String,
}

/// Callback a caller supplies to receive output lines as the process runs. `Send + Sync` so it
/// can be shared across the stdout/stderr reader threads and cloned per thread - the same
/// shape as transpiler::EventSink.
pub type LineSink = Arc<dyn Fn(OutputLine) + Send + Sync>;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SpawnOutcome {
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

impl SpawnOutcome {
    pub fn success(&self) -> bool {
        !self.timed_out && self.exit_code == Some(0)
    }
}

#[derive(Clone, Debug)]
pub struct SpawnRequest {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
    /// Killed (whole process tree) if still running after this long. Callers pick the budget -
    /// the transpiler spike used 300s against an observed 480s hang, an LSP sidecar would want
    /// no timeout at all (long-lived process), so this trait leaves the choice to the caller
    /// rather than baking in one default.
    pub timeout: Duration,
}

impl SpawnRequest {
    pub fn new(program: impl Into<PathBuf>, timeout: Duration) -> Self {
        Self { program: program.into(), args: Vec::new(), working_dir: None, timeout }
    }

    pub fn arg(mut self, arg: impl Into<String>) -> Self {
        self.args.push(arg.into());
        self
    }

    pub fn args(mut self, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }

    pub fn working_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.working_dir = Some(dir.into());
        self
    }
}

/// Narrow seam around "start a process, stream its output, enforce a timeout". Deliberately
/// hides `std::process`/OS details behind this trait per ADR-0004 rule 1 - `forge-core` must
/// never depend on `std::process::Command` directly, only on this trait.
pub trait ProcessSpawner: Send + Sync {
    fn spawn(&self, request: SpawnRequest, on_line: LineSink) -> Result<SpawnOutcome, PlatformError>;
}

/// Resolves `program` against `PATH` first, since `Command::new` on Windows only implicitly
/// searches `PATH` for bare executable names when no directory separator is present - callers
/// that pass an absolute path (the common case for e.g. `nbexec64.exe`) are unaffected.
pub(crate) fn program_exists(program: &Path) -> bool {
    if program.components().count() > 1 {
        return program.is_file();
    }
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let candidate = dir.join(program);
                candidate.is_file() || candidate.with_extension("exe").is_file()
            })
        })
        .unwrap_or(false)
        || program.is_file()
}

/// Ends a child process together with everything it started (the transpiler launcher starts a
/// JVM child that a plain kill of the launcher would leave running). Windows uses `taskkill /T`;
/// elsewhere the child was started as leader of its own process group (see
/// [`own_process_group`]), so the whole group is killed.
pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = crate::console::command("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
    }
    #[cfg(not(windows))]
    {
        let group = format!("-{pid}");
        let _ = std::process::Command::new("kill").args(["-KILL", "--", &group]).status();
        let _ = std::process::Command::new("kill").args(["-KILL", &pid.to_string()]).status();
    }
}

/// Makes the child the leader of a new process group on Unix so [`kill_process_tree`] can end
/// it with all of its children; a no-op on Windows.
pub fn own_process_group(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    cmd
}
