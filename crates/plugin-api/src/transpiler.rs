//! Austauschbare Transpiler-Engines (z. B. `native`, `adito`). Die App meldet sie beim Start in einer
//! [`TranspilerRegistry`] an; der Kern kennt nur diesen Trait, nicht die Engines selbst.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Einstellungen für einen Lauf als Name/Wert-Paare (z. B. `forge_data_dir`, `install_dir`, `user_dir`).
/// Jede Engine liest nur die Namen, die sie kennt.
#[derive(Clone, Debug, Default)]
pub struct TranspileOptions {
    pub values: HashMap<String, String>,
}

impl TranspileOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(mut self, name: &str, value: impl Into<String>) -> Self {
        self.values.insert(name.to_string(), value.into());
        self
    }

    /// Wert als Pfad. Fehlende oder leere Werte ergeben `None`.
    pub fn path(&self, name: &str) -> Option<PathBuf> {
        self.values.get(name).filter(|v| !v.trim().is_empty()).map(PathBuf::from)
    }
}

/// Meldung eines laufenden Transpilers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Progress {
    /// Eine Ausgabezeile (`error` = stderr).
    Log { error: bool, line: String },
    /// Fortschritt 0 bis 100 mit der laufenden Stufe.
    Stage { percent: u8, stage: String },
}

/// Empfänger der Meldungen während eines Laufs.
pub type ProgressSink = Arc<dyn Fn(Progress) + Send + Sync>;

/// Ergebnis eines erfolgreichen Laufs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TranspileOutcome {
    /// Ordner mit dem Ergebnis (`dist`).
    pub output_dir: PathBuf,
}

/// Eine Transpiler-Engine. Fehler (auch Abbruch und ein fehlgeschlagener Lauf) sind Fehlertexte.
pub trait Transpiler: Send + Sync {
    /// Kurze, stabile ID (z. B. `native`).
    fn id(&self) -> &'static str;
    /// Anzeigename.
    fn name(&self) -> &'static str;
    /// Transpiliert das Projekt in `project_root` und meldet den Verlauf an `progress`.
    fn transpile(&self, project_root: &Path, options: &TranspileOptions, progress: &ProgressSink) -> Result<TranspileOutcome, String>;
    /// Bricht einen laufenden Lauf ab. `false`, wenn keiner läuft oder die Engine das nicht kann.
    fn cancel(&self) -> bool {
        false
    }
}

/// Angemeldete Transpiler in der Reihenfolge der Anmeldung. Der erste angemeldete ist die Vorgabe,
/// solange keine andere gesetzt ist.
#[derive(Default)]
pub struct TranspilerRegistry {
    items: Vec<Arc<dyn Transpiler>>,
    default_id: Option<&'static str>,
}

impl TranspilerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Meldet einen Transpiler an. Eine schon vorhandene ID wird ersetzt.
    pub fn register(&mut self, transpiler: Arc<dyn Transpiler>) {
        self.items.retain(|t| t.id() != transpiler.id());
        self.items.push(transpiler);
    }

    pub fn get(&self, id: &str) -> Option<&Arc<dyn Transpiler>> {
        self.items.iter().find(|t| t.id() == id)
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.items.iter().map(|t| t.id()).collect()
    }

    /// Legt die Vorgabe fest. Eine nicht angemeldete ID wird ignoriert.
    pub fn set_default(&mut self, id: &str) {
        if let Some(t) = self.get(id) {
            self.default_id = Some(t.id());
        }
    }

    /// Die Vorgabe: die gesetzte, sonst die zuerst angemeldete.
    pub fn default_transpiler(&self) -> Option<&Arc<dyn Transpiler>> {
        self.default_id.and_then(|id| self.get(id)).or_else(|| self.items.first())
    }

    /// Der gewünschte Transpiler, sonst die Vorgabe.
    pub fn select(&self, preferred: &str) -> Option<&Arc<dyn Transpiler>> {
        self.get(preferred).or_else(|| self.default_transpiler())
    }

    /// Bricht bei allen angemeldeten Transpilern einen laufenden Lauf ab. `true`, wenn einer lief.
    pub fn cancel_any(&self) -> bool {
        self.items.iter().fold(false, |any, t| t.cancel() || any)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct Fake {
        id: &'static str,
        running: AtomicBool,
    }

    fn fake(id: &'static str) -> Arc<dyn Transpiler> {
        Arc::new(Fake { id, running: AtomicBool::new(false) })
    }

    impl Transpiler for Fake {
        fn id(&self) -> &'static str {
            self.id
        }
        fn name(&self) -> &'static str {
            "Fake"
        }
        fn transpile(&self, root: &Path, options: &TranspileOptions, progress: &ProgressSink) -> Result<TranspileOutcome, String> {
            progress(Progress::Stage { percent: 100, stage: self.id.to_string() });
            if options.path("fail").is_some() {
                return Err("failed".into());
            }
            Ok(TranspileOutcome { output_dir: root.join("dist") })
        }
        fn cancel(&self) -> bool {
            self.running.swap(false, Ordering::SeqCst)
        }
    }

    #[test]
    fn registered_transpilers_are_found_and_listed() {
        let mut reg = TranspilerRegistry::new();
        reg.register(fake("native"));
        reg.register(fake("adito"));
        assert_eq!(reg.ids(), vec!["native", "adito"]);
        assert!(reg.get("adito").is_some() && reg.get("x").is_none());
    }

    #[test]
    fn registering_the_same_id_replaces() {
        let mut reg = TranspilerRegistry::new();
        reg.register(fake("a"));
        reg.register(fake("a"));
        assert_eq!(reg.ids(), vec!["a"]);
    }

    #[test]
    fn default_is_the_first_until_one_is_set() {
        let mut reg = TranspilerRegistry::new();
        assert!(reg.default_transpiler().is_none());
        reg.register(fake("native"));
        reg.register(fake("adito"));
        assert_eq!(reg.default_transpiler().unwrap().id(), "native");
        reg.set_default("adito");
        assert_eq!(reg.default_transpiler().unwrap().id(), "adito");
        reg.set_default("missing");
        assert_eq!(reg.default_transpiler().unwrap().id(), "adito");
    }

    #[test]
    fn select_falls_back_to_the_default_for_unknown_ids() {
        let mut reg = TranspilerRegistry::new();
        reg.register(fake("native"));
        assert_eq!(reg.select("adito").unwrap().id(), "native");
        reg.register(fake("adito"));
        assert_eq!(reg.select("adito").unwrap().id(), "adito");
    }

    #[test]
    fn transpile_reports_progress_and_errors() {
        let t = fake("native");
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink: ProgressSink = {
            let seen = Arc::clone(&seen);
            Arc::new(move |p| seen.lock().unwrap().push(p))
        };
        let ok = t.transpile(Path::new("p"), &TranspileOptions::new(), &sink).unwrap();
        assert_eq!(ok.output_dir, Path::new("p").join("dist"));
        assert!(t.transpile(Path::new("p"), &TranspileOptions::new().with("fail", "1"), &sink).is_err());
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn options_ignore_empty_values() {
        let o = TranspileOptions::new().with("a", " ").with("b", "x");
        assert_eq!(o.path("a"), None);
        assert_eq!(o.path("b"), Some(PathBuf::from("x")));
        assert_eq!(o.path("c"), None);
    }

    #[test]
    fn cancel_any_reaches_every_transpiler() {
        let running = Arc::new(Fake { id: "a", running: AtomicBool::new(true) });
        let mut reg = TranspilerRegistry::new();
        reg.register(running.clone());
        reg.register(fake("b"));
        assert!(reg.cancel_any());
        assert!(!reg.cancel_any());
    }
}
