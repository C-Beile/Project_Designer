// Interpretation of the TranspilerCLI process exit code as a structured business outcome.
// Exit codes are the process's own verdict (see official-transpiler-invocation.md's
// LBL_TranspileSuccessful/LBL_TranspileFailed bundle keys and the P2 spike's reproduction of
// exit 142); this module turns the bare integer into something a caller can match on and
// show a human-readable cause for, instead of re-deriving the meaning at every call site.

/// The verdict of one TranspilerCLI run, independent of how it was obtained (real process
/// or, in tests, a simulated exit code).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub enum ExitOutcome {
    /// `TRANSPILATION SUCCESSFUL`, exit code 0.
    Success,
    /// The process exited with a non-zero code before the watchdog had to intervene.
    Failure(FailureReason),
    /// The watchdog killed the process tree because it produced no result in time.
    TimedOut,
}

impl ExitOutcome {
    pub fn is_success(&self) -> bool {
        matches!(self, ExitOutcome::Success)
    }
}

/// Known causes for a non-zero exit, where the P2 spike already established them by
/// reproducing and diagnosing the failure. Anything else is `Unknown` until someone
/// diagnoses it the same way (see spike-transpiler-wrapper.md for the method: bytecode
/// inspection of TranspilerCLIProcessor/NodePackageManagerFacade).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub enum FailureReason {
    /// Exit 150: `project_home` does not point at a project the platform's project-type
    /// recognizer can resolve (e.g. missing `.aditoprj`/module definition). A NullPointerException
    /// inside `TranspilerCLIProcessor.findDefinition()` is the observed symptom.
    InvalidProject { code: i32 },
    /// Exit 142: the userdir is missing the `de.adito.aditoweb.nbm.nodejs` plugin, so
    /// `INodeJSProvider` cannot resolve a Node.js environment for the project. This is a
    /// userdir setup problem, not a defect in the target project.
    NodeJsPluginMissing { code: i32 },
    /// A non-zero exit code this crate has not diagnosed yet.
    Unknown { code: i32 },
}

impl FailureReason {
    pub fn code(&self) -> i32 {
        match self {
            FailureReason::InvalidProject { code }
            | FailureReason::NodeJsPluginMissing { code }
            | FailureReason::Unknown { code } => *code,
        }
    }

    /// Plain-text cause for display in a wrapper UI/log, mirroring the diagnosis recorded in
    /// spike-transpiler-wrapper.md.
    pub fn explanation(&self) -> &'static str {
        match self {
            FailureReason::InvalidProject { .. } => {
                "project_home does not point to a valid ADITO project \
                 (missing .aditoprj or module definition)"
            }
            FailureReason::NodeJsPluginMissing { .. } => {
                "TranspilerCLI could not resolve a Node.js installation for the project - \
                 the userdir is missing the de.adito.aditoweb.nbm.nodejs plugin seed"
            }
            FailureReason::Unknown { .. } => "unrecognized exit code, cause not yet diagnosed",
        }
    }
}

/// Turns a raw process result into a business-level outcome. `timed_out` takes priority:
/// once the watchdog has killed the process tree, whatever exit code the OS happens to
/// report (often `None`, sometimes a signal-derived value) is no longer meaningful.
pub fn interpret_exit_code(exit_code: Option<i32>, timed_out: bool) -> ExitOutcome {
    if timed_out {
        return ExitOutcome::TimedOut;
    }
    match exit_code {
        Some(0) => ExitOutcome::Success,
        Some(150) => ExitOutcome::Failure(FailureReason::InvalidProject { code: 150 }),
        Some(142) => ExitOutcome::Failure(FailureReason::NodeJsPluginMissing { code: 142 }),
        Some(other) => ExitOutcome::Failure(FailureReason::Unknown { code: other }),
        // No exit code and no timeout flag: the OS gave us nothing usable (e.g. process
        // killed by an external signal outside our own watchdog). Treat conservatively as
        // an unrecognized failure rather than claiming success.
        None => ExitOutcome::Failure(FailureReason::Unknown { code: -1 }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_zero_is_success() {
        assert_eq!(interpret_exit_code(Some(0), false), ExitOutcome::Success);
    }

    #[test]
    fn exit_150_is_invalid_project() {
        let outcome = interpret_exit_code(Some(150), false);
        assert_eq!(outcome, ExitOutcome::Failure(FailureReason::InvalidProject { code: 150 }));
        assert!(!outcome.is_success());
    }

    #[test]
    fn exit_142_is_nodejs_plugin_missing() {
        assert_eq!(
            interpret_exit_code(Some(142), false),
            ExitOutcome::Failure(FailureReason::NodeJsPluginMissing { code: 142 })
        );
    }

    #[test]
    fn unrecognized_code_is_unknown_failure() {
        assert_eq!(
            interpret_exit_code(Some(7), false),
            ExitOutcome::Failure(FailureReason::Unknown { code: 7 })
        );
    }

    #[test]
    fn timed_out_flag_wins_over_any_exit_code() {
        assert_eq!(interpret_exit_code(Some(0), true), ExitOutcome::TimedOut);
        assert_eq!(interpret_exit_code(None, true), ExitOutcome::TimedOut);
    }

    #[test]
    fn missing_exit_code_without_timeout_is_unknown_failure() {
        assert_eq!(
            interpret_exit_code(None, false),
            ExitOutcome::Failure(FailureReason::Unknown { code: -1 })
        );
    }
}
