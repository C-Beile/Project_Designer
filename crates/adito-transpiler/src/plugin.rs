//! Der offizielle ADITO-Transpiler als austauschbare Engine (`plugin_api::Transpiler`, ID `adito`).

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use plugin_api::transpiler::{Progress, ProgressSink, TranspileOptions, TranspileOutcome, Transpiler};

use crate::{cancel_active_run, take_cancelled, EventSink, LogStream, NbexecTranspilerRunner, TranspileEvent, TranspilerConfig, TranspilerRunner};

pub struct AditoTranspiler;

impl Transpiler for AditoTranspiler {
    fn id(&self) -> &'static str {
        "adito"
    }

    fn name(&self) -> &'static str {
        "ADITO Transpiler"
    }

    /// Optionen: `install_dir`, `user_dir` (beide überschreiben die Suche), `forge_data_dir` (Profil der App).
    fn transpile(&self, project_root: &Path, options: &TranspileOptions, progress: &ProgressSink) -> Result<TranspileOutcome, String> {
        // Die installierte App darf nie von einem Entwickler-Ordner abhängen (RISKS.md R43): Installation aus
        // Tools > Options oder Suche, das Profil gehört der App und wird einmal aus dem echten Profil befüllt.
        // `user_dir` bleibt für Tests mit vorbereitetem Profil überschreibbar.
        let (install_dir, user_dir) = match options.path("user_dir") {
            Some(user_dir) => (options.path("install_dir").unwrap_or_default(), user_dir),
            None => {
                let data_dir = options.path("forge_data_dir").unwrap_or_else(|| std::env::temp_dir().join("forge"));
                let setup = crate::setup::resolve(
                    options.path("install_dir").as_deref(),
                    &app_base::designer_paths::default_search_roots(),
                    &data_dir,
                    &app_base::designer_paths::default_profiles_root(),
                )?;
                (setup.install_dir, setup.user_dir)
            }
        };
        let config = TranspilerConfig::new(install_dir, user_dir).with_timeout(Duration::from_secs(300));
        let runner = NbexecTranspilerRunner::new(config);
        let log = Arc::clone(progress);
        let sink: EventSink = Arc::new(move |event| {
            if let TranspileEvent::Log { stream, line } = event {
                log(Progress::Log { error: stream == LogStream::Stderr, line });
            }
        });
        let outcome = runner.run(project_root, sink).map_err(|e| e.to_string())?;
        if take_cancelled() {
            return Err("Build cancelled.".to_string());
        }
        if outcome.is_success() {
            Ok(TranspileOutcome { output_dir: project_root.join("dist") })
        } else {
            Err(format!("official transpiler run did not succeed: {:?}", outcome.outcome))
        }
    }

    fn cancel(&self) -> bool {
        cancel_active_run()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_itself_as_adito() {
        assert_eq!(AditoTranspiler.id(), "adito");
        assert!(!AditoTranspiler.cancel());
    }

    #[test]
    fn a_wrong_install_folder_is_a_clear_error() {
        let dir = std::env::temp_dir().join(format!("forge-adito-plugin-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let options = TranspileOptions::new().with("install_dir", dir.to_string_lossy()).with("forge_data_dir", dir.to_string_lossy());
        let sink: ProgressSink = Arc::new(|_| {});
        let err = AditoTranspiler.transpile(&dir, &options, &sink).unwrap_err();
        assert!(err.contains("Tools > Options"), "{err}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
