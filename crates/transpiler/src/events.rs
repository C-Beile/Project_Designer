// Translates raw TranspilerCLI stdout/stderr lines into structured events a caller can act
// on without re-parsing log text itself. This is the interface the later Tauri integration
// will forward as window events (transpiler-log / transpiler-done); this crate only defines
// the event shape and the pure line->event translation, no GUI dependency.

use crate::exit_code::ExitOutcome;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

/// A recognizable milestone inside the TranspilerCLI's own log output, derived from the log
/// lines recorded in spike-transpiler-wrapper.md's success-case excerpt. Coarse on purpose:
/// enough for a progress indicator, not a full state machine of the transpiler's internals.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum ProgressStage {
    ProjectOpened,
    DefinitionResolved,
    TranspilationStarted,
    CopyingOutput,
    Finished,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind")]
pub enum TranspileEvent {
    Log { stream: LogStream, line: String },
    Progress(ProgressStage),
    Done { exit_code: Option<i32>, outcome: ExitOutcome },
}

/// Callback a caller supplies to receive events as the process runs. `Send + Sync` so it can
/// be shared across the stdout/stderr reader threads and cloned per thread, exactly like the
/// P2 spike's `LineSink`.
pub type EventSink = std::sync::Arc<dyn Fn(TranspileEvent) + Send + Sync>;

/// Pure translation of one log line into the event(s) it produces: always a `Log` event, plus
/// a `Progress` event when the line matches a known milestone marker. Kept side-effect-free
/// and independent of any process/thread so it can be unit-tested against simulated
/// stdout/stderr streams (no real subprocess needed).
pub fn classify_line(stream: LogStream, line: &str) -> Vec<TranspileEvent> {
    let mut events = vec![TranspileEvent::Log { stream, line: line.to_string() }];
    if let Some(stage) = detect_progress_stage(line) {
        events.push(TranspileEvent::Progress(stage));
    }
    events
}

fn detect_progress_stage(line: &str) -> Option<ProgressStage> {
    if line.contains("Opened project") {
        Some(ProgressStage::ProjectOpened)
    } else if line.contains("Resolved definition") {
        Some(ProgressStage::DefinitionResolved)
    } else if line.contains("Started Transpilation") {
        Some(ProgressStage::TranspilationStarted)
    } else if line.contains("Copying") && line.contains("target folder") {
        Some(ProgressStage::CopyingOutput)
    } else if line.contains("Process completed successfully") {
        Some(ProgressStage::Finished)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_line_produces_a_log_event_regardless_of_content() {
        let events = classify_line(LogStream::Stdout, "some unremarkable line");
        assert_eq!(
            events[0],
            TranspileEvent::Log { stream: LogStream::Stdout, line: "some unremarkable line".into() }
        );
        assert_eq!(events.len(), 1, "no progress marker in this line, so no Progress event");
    }

    #[test]
    fn recognizes_project_opened_marker() {
        let events = classify_line(LogStream::Stdout, "[INFO] Opened project .../testproject successfully");
        assert!(events.contains(&TranspileEvent::Progress(ProgressStage::ProjectOpened)));
    }

    #[test]
    fn recognizes_definition_resolved_marker() {
        let events = classify_line(
            LogStream::Stdout,
            "[INFO] Resolved definition @forge-spike/testproject:1.0.0",
        );
        assert!(events.contains(&TranspileEvent::Progress(ProgressStage::DefinitionResolved)));
    }

    #[test]
    fn recognizes_transpilation_started_marker() {
        let events = classify_line(
            LogStream::Stdout,
            "[INFO] Started Transpilation for Project @forge-spike/testproject:1.0.0",
        );
        assert!(events.contains(&TranspileEvent::Progress(ProgressStage::TranspilationStarted)));
    }

    #[test]
    fn recognizes_copying_output_marker() {
        let events = classify_line(
            LogStream::Stdout,
            "[INFO] Copying @forge-spike/testproject:1.0.0 ... to target folder",
        );
        assert!(events.contains(&TranspileEvent::Progress(ProgressStage::CopyingOutput)));
    }

    #[test]
    fn recognizes_finished_marker() {
        let events = classify_line(LogStream::Stdout, "[INFO] Process completed successfully, shutting down...");
        assert!(events.contains(&TranspileEvent::Progress(ProgressStage::Finished)));
    }

    #[test]
    fn stderr_lines_are_tagged_with_the_correct_stream() {
        let events = classify_line(LogStream::Stderr, "[SEVERE] java.lang.NullPointerException");
        assert_eq!(
            events[0],
            TranspileEvent::Log {
                stream: LogStream::Stderr,
                line: "[SEVERE] java.lang.NullPointerException".into()
            }
        );
    }

    #[test]
    fn simulated_success_stream_yields_all_five_progress_stages_in_order() {
        let lines = [
            "[INFO] Opened project .../testproject successfully",
            "[INFO] Resolved definition @forge-spike/testproject:1.0.0",
            "[INFO] Started Transpilation for Project @forge-spike/testproject:1.0.0",
            "[INFO] -------------------- < Full Transpile > --------------------",
            "[INFO] Copying @forge-spike/testproject:1.0.0 ... to target folder",
            "[INFO] Process completed successfully, shutting down...",
            "[INFO] TRANSPILATION SUCCESSFUL",
            "[INFO] Process finished with exit code 0",
        ];
        let stages: Vec<ProgressStage> = lines
            .iter()
            .flat_map(|line| classify_line(LogStream::Stdout, line))
            .filter_map(|event| match event {
                TranspileEvent::Progress(stage) => Some(stage),
                _ => None,
            })
            .collect();
        assert_eq!(
            stages,
            vec![
                ProgressStage::ProjectOpened,
                ProgressStage::DefinitionResolved,
                ProgressStage::TranspilationStarted,
                ProgressStage::CopyingOutput,
                ProgressStage::Finished,
            ]
        );
    }
}
