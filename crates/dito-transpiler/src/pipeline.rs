// Aus dem Overlay die Ausgabedateien planen. Stand P1: nur die einfachen Fälle.
//  - Dateien außerhalb der Modell-Ordner (`.liquibase`, `doc`, `tools` ...) gehen unverändert durch (Pass-through).
//  - `.aod` in Modell-Ordnern: LF, COMPACT, verknüpfte Dateien eingebettet, leere Elemente als `<x />` (Phase P2).
//  - Die verknüpften Dateien selbst (Skripte, Doku) stehen nur noch in der `.aod`; ihre eigenen Dateien entfallen.
//  - `modification/` fehlt noch (Phase P3).

use std::path::PathBuf;

use std::collections::HashMap;

use rayon::prelude::*;

use crate::api::{Diagnostic, Severity};
use crate::discover::SourceModule;
use crate::format::v2;
use crate::merge::alias;
use crate::merge::modifications::{self, Modification};
use crate::model::{Document, Node};
use crate::merge::order::order_modifications;
use crate::overlay::{FileSource, Overlay};

/// Ordner mit Modellen. Dort liegt je Objekt ein Ordner mit `<name>.aod` und verknüpften Dateien.
pub const MODEL_FOLDERS: &[&str] = &[
    "aliasDefinition", "application", "entity", "entityWebservice", "language", "modification", "neonContext", "neonDashboard",
    "neonNotificationType", "neonView", "preferences", "process", "rendererDefinition", "report", "role", "serviceDefinition", "system",
    "userhelp",
];

#[derive(Debug, Clone)]
pub enum Content {
    /// Unverändert von der Platte (wird erst beim Schreiben gelesen).
    FromDisk(PathBuf),
    /// Im Speicher erzeugt.
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone)]
pub struct OutputFile {
    /// Relativer Pfad mit `/`.
    pub path: String,
    pub content: Content,
}

fn top_folder(path: &str) -> &str {
    path.split('/').next().unwrap_or("")
}

/// Zwischenstand je Overlay-Eintrag.
enum Planned {
    /// Fertige Datei (Pass-through oder Modell im Byte-Weg).
    File(OutputFile),
    /// Modell als Baum, noch ohne Zusammenführung über Modelle hinweg.
    Model { path: String, source_path: PathBuf, doc: Document },
    Skip,
}

/// Plant alle Ausgabedateien. Stufen: (1) je Modell parallel: lesen, Verweise, Modifikationen, Erweiterungspunkte;
/// (2) über Modelle hinweg: Alias zusammenführen, Verweise umbenennen; (3) schreiben.
pub fn plan_outputs(overlay: &Overlay, modules: &[SourceModule]) -> (Vec<OutputFile>, Vec<Diagnostic>) {
    let mut diagnostics = Vec::new();
    let all_mods = load_modifications(modules, &mut diagnostics);
    let mut by_target: HashMap<String, Vec<&Modification>> = HashMap::new();
    for m in &all_mods {
        let target = format!("{}/{}/{}.aod", m.model_type, m.model_name, m.model_name);
        if overlay.get(&target).is_some() {
            by_target.entry(target).or_default().push(m);
        } else {
            diagnostics.push(Diagnostic {
                severity: Severity::Warning,
                message: format!("Modifikation zeigt auf ein Modell, das es nicht gibt: {} {}", m.model_type, m.model_name),
                sources: vec![m.file.clone()],
            });
        }
    }
    for list in by_target.values_mut() {
        order_modifications(list);
    }

    // Stufe 1.
    let entries: Vec<(&String, &FileSource)> = overlay.iter().collect();
    let staged: Vec<(Planned, Vec<Diagnostic>)> = entries
        .par_iter()
        .map(|(path, source)| plan_one(path, source, overlay, modules, by_target.get(path.as_str()).map(Vec::as_slice).unwrap_or(&[])))
        .collect();

    // Stufe 2: Modelle mit Namen sammeln, zusammenführen.
    let mut order: Vec<Planned> = Vec::with_capacity(staged.len());
    let mut docs: HashMap<String, Document> = HashMap::new();
    let mut sources: HashMap<String, PathBuf> = HashMap::new();
    for (planned, notes) in staged {
        diagnostics.extend(notes);
        match planned {
            Planned::Model { path, source_path, doc } => {
                sources.insert(path.clone(), source_path);
                docs.insert(path.clone(), doc);
                order.push(Planned::Model { path, source_path: PathBuf::new(), doc: Document::new(Node::default()) });
            }
            other => order.push(other),
        }
    }
    crate::merge::language::merge_languages(&mut docs, &mut diagnostics);
    crate::merge::language::merge_preferences(&mut docs);
    let renames = alias::merge_aliases(&mut docs, &mut diagnostics);
    // Kurzname eines Moduls (`Contact_lib`) zum ausgeschriebenen Namen, wie ihn Importe nennen können.
    let canonical = |spec: &str| -> String {
        if spec.contains('/') || spec.starts_with('@') {
            return spec.to_string();
        }
        match overlay.get(&format!("process/{spec}/process.js")) {
            Some(source) => {
                let root = &modules[source.module].root;
                let package = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let scope = root.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if scope.starts_with('@') { format!("{scope}/{package}/process/{spec}/process") } else { spec.to_string() }
            }
            None => spec.to_string(),
        }
    };
    crate::scripts::apply::inline_services(&mut docs, &canonical);
    if !renames.is_empty() {
        let map: HashMap<&str, &str> = renames.iter().map(|(from, to)| (from.as_str(), to.as_str())).collect();
        docs.par_iter_mut().filter(|(path, _)| !path.starts_with("aliasDefinition/")).for_each(|(_, doc)| alias::rename_alias_references(doc, &map));
    }

    // Stufe 3: schreiben, in Overlay-Reihenfolge.
    let mut files = Vec::with_capacity(order.len());
    let mut models: Vec<(String, Document)> = Vec::new();
    let mut slots: Vec<Option<usize>> = Vec::with_capacity(order.len());
    let mut direct: Vec<Option<OutputFile>> = Vec::with_capacity(order.len());
    for planned in order {
        match planned {
            Planned::File(f) => {
                slots.push(None);
                direct.push(Some(f));
            }
            Planned::Model { path, .. } => match docs.remove(&path) {
                Some(doc) => {
                    slots.push(Some(models.len()));
                    models.push((path, doc));
                    direct.push(None);
                }
                None => {
                    slots.push(None);
                    direct.push(None);
                }
            },
            Planned::Skip => {
                slots.push(None);
                direct.push(None);
            }
        }
    }
    let written: Vec<OutputFile> = models
        .par_iter()
        .map(|(path, doc)| OutputFile { path: path.clone(), content: Content::Bytes(crate::model::write::write_v2(doc)) })
        .collect();
    for (slot, file) in slots.into_iter().zip(direct) {
        match (slot, file) {
            (Some(i), _) => files.push(written[i].clone()),
            (None, Some(f)) => files.push(f),
            _ => {}
        }
    }
    (files, diagnostics)
}

fn plan_one(path: &str, source: &FileSource, overlay: &Overlay, modules: &[SourceModule], mods: &[&Modification]) -> (Planned, Vec<Diagnostic>) {
    let top = top_folder(path);
    if !MODEL_FOLDERS.contains(&top) {
        return (Planned::File(OutputFile { path: path.to_string(), content: Content::FromDisk(source.path.clone()) }), Vec::new());
    }
    if top == "modification" || !path.ends_with(".aod") {
        return (Planned::Skip, Vec::new());
    }
    let Ok(bytes) = std::fs::read(&source.path) else { return (Planned::Skip, Vec::new()) };
    let module_root = &modules[source.module].root;
    // Ein Verweis zeigt auf eine Datei im selben Modul, sonst auf den Gewinner im Overlay.
    let read = |link: &str| -> Option<Vec<u8>> {
        std::fs::read(module_root.join(link)).ok().or_else(|| overlay.get(link).and_then(|s| std::fs::read(&s.path).ok()))
    };
    let mut unresolved = Vec::new();
    let mut notes: Vec<Diagnostic> = Vec::new();
    let planned = match crate::model::parse::parse(&bytes) {
        Ok(mut doc) => {
            v2::convert_tree(&mut doc, &read, &mut unresolved);
            modifications::apply_all(&mut doc, mods, &mut notes);
            crate::merge::extension_points::resolve(&mut doc);
            Planned::Model { path: path.to_string(), source_path: source.path.clone(), doc }
        }
        // Nicht lesbar (Kommentar, gemischter Inhalt): alter Byte-Weg.
        Err(_) => {
            let content = v2::compact_empty_elements(&v2::inline_linked(&v2::to_v2_bytes(&bytes), &read, &mut unresolved));
            Planned::File(OutputFile { path: path.to_string(), content: Content::Bytes(content) })
        }
    };
    notes.extend(unresolved.into_iter().map(|link| Diagnostic {
        severity: Severity::Warning,
        message: format!("{path}: Verweis %aditoprj%/{link} nicht gefunden, entfernt"),
        sources: vec![source.path.clone()],
    }));
    (planned, notes)
}

/// Liest alle Modifikationen aller Module (`<modul>/modification/<id>/<id>.aod`), parallel. Reihenfolge: Modul, dann Pfad.
fn load_modifications(modules: &[SourceModule], diagnostics: &mut Vec<Diagnostic>) -> Vec<Modification> {
    let mut files: Vec<(usize, PathBuf)> = Vec::new();
    for (index, module) in modules.iter().enumerate() {
        let Ok(entries) = std::fs::read_dir(module.root.join("modification")) else { continue };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            if let Ok(inner) = std::fs::read_dir(&dir) {
                let mut aods: Vec<PathBuf> = inner.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "aod")).collect();
                aods.sort();
                files.extend(aods.into_iter().map(|p| (index, p)));
            }
        }
    }
    let results: Vec<Result<Modification, Diagnostic>> = files
        .par_iter()
        .map(|(index, file)| {
            let module = &modules[*index];
            let fail = |reason: String| Diagnostic { severity: Severity::Warning, message: format!("Modifikation nicht lesbar: {reason}"), sources: vec![file.clone()] };
            let bytes = std::fs::read(file).map_err(|e| fail(e.to_string()))?;
            let read = |link: &str| std::fs::read(module.root.join(link)).ok();
            let mut unresolved = Vec::new();
            modifications::load_modification(&bytes, *index, module.is_project, file.clone(), &read, &mut unresolved).map_err(fail)
        })
        .collect();
    let mut loaded = Vec::with_capacity(results.len());
    for r in results {
        match r {
            Ok(m) => loaded.push(m),
            Err(d) => diagnostics.push(d),
        }
    }
    loaded
}
