// Alle Reihenfolge-Regeln an EINER Stelle (Plan: "Alias und Modifikationen: Reihenfolge ist Pflicht").
// Jede Regel nennt den Orakel-Fall, der sie belegt. Ohne Beleg gilt die Vorgabe und ist als solche markiert.

use crate::discover::SourceModule;
use crate::merge::modifications::{ChangeType, Modification};

/// Modul-Reihenfolge: niedrigste Priorität zuerst, das Projekt zuletzt. Das höchste Modul gewinnt bei gleichem Pfad.
/// Beleg: noch keiner. Vorgabe (alphabetisch nach Name, Projekt zuletzt) entspricht der alten Rust-Engine.
/// Zu prüfen am V2-Orakel: ADITO sortiert vielleicht topologisch (Abhängigkeiten zuerst).
pub fn order_modules(mut modules: Vec<SourceModule>) -> Vec<SourceModule> {
    modules.sort_by(|a, b| a.is_project.cmp(&b.is_project).then_with(|| a.name.cmp(&b.name)));
    modules
}

/// Reihenfolge, in der Modifikationen auf ein Modell wirken.
/// Beleg V2: `contextSelectionList_service/implementations` (Hermes): 16 INSERT, Orakel-Reihenfolge = aufsteigend nach `position`,
/// bei gleicher `position` (0) nach Modul-Reihenfolge (activity, contact, csv-importer, task), nicht nach Dateiname.
/// Vorgabe sonst wie in der alten Rust-Engine (V1-Orakel): das Projekt zuletzt (außer INSERT), dann `position`, dann Modul, dann Dateiname.
/// Zu prüfen am V2-Orakel: gleiche Reihenfolge für INSERT in Listen?
pub fn order_modifications(mods: &mut Vec<&Modification>) {
    mods.sort_by(|a, b| {
        let key = |m: &Modification| (m.is_project && m.change != ChangeType::Insert, m.position, m.module, m.file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        key(a).cmp(&key(b))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn module(name: &str, is_project: bool) -> SourceModule {
        SourceModule { name: name.into(), root: PathBuf::from(name), is_project }
    }

    #[test]
    fn project_comes_last_and_others_are_alphabetical() {
        let ordered = order_modules(vec![module("zeta", false), module("hermes", true), module("alpha", false)]);
        let names: Vec<&str> = ordered.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["alpha", "zeta", "hermes"]);
    }
}
