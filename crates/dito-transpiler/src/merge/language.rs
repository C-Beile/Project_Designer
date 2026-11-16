// Sprachen und Preferences zusammenführen.
//
// Sprache: Ein Modul liefert seine Übersetzungen als eigenes Sprachobjekt (`_____LANGUAGE_de_activity` für `de`). Im Ergebnis
// gibt es ein Objekt je Sprache (`_____LANGUAGE_de`): jeder Eintrag jedes Moduls, jeder Schlüssel einmal, nach Schlüssel sortiert.
// Preferences: Ein Modul kann eigene Konfigurations-Eigenschaften mitbringen. Sie wandern in die Preferences des Projekts,
// das Objekt des Moduls entfällt. Beides aus dem alten Rust-Transpiler übernommen (V1-Orakel), am V2-Orakel zu prüfen.

use std::collections::{BTreeMap, HashMap};

use crate::api::{Diagnostic, Severity};
use crate::model::{Document, NodeId};

const LANGUAGE_PREFIX: &str = "_____LANGUAGE_";
const PROJECT_PREFERENCES: &str = "_____PREFERENCES_PROJECT";

fn folder_of(path: &str, top: &str) -> Option<String> {
    path.strip_prefix(top)?.strip_prefix('/')?.split('/').next().map(str::to_string)
}

fn language_code(doc: &Document) -> Option<Vec<u8>> {
    doc.child_text(doc.root, b"language").map(<[u8]>::to_vec)
}

/// Führt `language/_____LANGUAGE_<lang>_<modul>` in `language/_____LANGUAGE_<lang>` zusammen.
pub fn merge_languages(docs: &mut HashMap<String, Document>, diagnostics: &mut Vec<Diagnostic>) {
    let mut folders: Vec<String> = docs.keys().filter_map(|p| folder_of(p, "language")).collect();
    folders.sort();
    folders.dedup();

    let mut parts: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for folder in &folders {
        let Some(rest) = folder.strip_prefix(LANGUAGE_PREFIX) else { continue };
        let Some((lang, _module)) = rest.split_once('_') else { continue };
        let base = format!("{LANGUAGE_PREFIX}{lang}");
        if folders.contains(&base) {
            parts.entry(base).or_default().push(folder.clone());
        }
    }

    for (base, contributors) in parts {
        let base_path = format!("language/{base}/{base}.aod");
        let Some(base_doc) = docs.get(&base_path) else { continue };
        let base_lang = language_code(base_doc);

        // Quellen (Index 0 = Basis), Schlüssel -> (Quelle, Knoten, Herkunft).
        let mut sources: Vec<Document> = vec![base_doc.clone()];
        let mut all: BTreeMap<Vec<u8>, (usize, NodeId, String)> = BTreeMap::new();
        if let Some(map) = base_doc.child_by_tag(base_doc.root, b"keyValueMap") {
            for entry in &base_doc.node(map).children {
                if let Some(key) = base_doc.child_text(*entry, b"name") {
                    all.insert(key.to_vec(), (0, *entry, base.clone()));
                }
            }
        }
        for folder in &contributors {
            let path = format!("language/{folder}/{folder}.aod");
            let Some(doc) = docs.remove(&path) else { continue };
            if language_code(&doc) != base_lang {
                docs.insert(path, doc);
                continue;
            }
            let Some(map) = doc.child_by_tag(doc.root, b"keyValueMap") else { continue };
            let index = sources.len();
            for entry in doc.node(map).children.clone() {
                let Some(key) = doc.child_text(entry, b"name").map(<[u8]>::to_vec) else { continue };
                if let Some((old_index, old_node, from)) = all.get(&key) {
                    let old_value = sources[*old_index].child_text(*old_node, b"value");
                    if old_value != doc.child_text(entry, b"value") {
                        diagnostics.push(Diagnostic {
                            severity: Severity::Warning,
                            message: format!("Übersetzung '{}' kommt in {from} und {folder} mit verschiedenem Text vor; {folder} gilt", String::from_utf8_lossy(&key)),
                            sources: Vec::new(),
                        });
                    }
                }
                all.insert(key, (index, entry, folder.clone()));
            }
            sources.push(doc);
        }

        let base_doc = docs.get_mut(&base_path).expect("Basis vorhanden");
        let Some(map) = base_doc.child_by_tag(base_doc.root, b"keyValueMap") else { continue };
        for child in base_doc.node(map).children.clone() {
            base_doc.detach(child);
        }
        for (_, (index, node, _)) in all {
            base_doc.copy_subtree(map, &sources[index], node);
        }
    }
}

/// Fügt die Eigenschaften der Modul-Preferences in die des Projekts ein. Die Objekte der Module entfallen.
pub fn merge_preferences(docs: &mut HashMap<String, Document>) {
    let target_path = format!("preferences/{PROJECT_PREFERENCES}/{PROJECT_PREFERENCES}.aod");
    if !docs.contains_key(&target_path) {
        return;
    }
    let mut folders: Vec<String> = docs.keys().filter_map(|p| folder_of(p, "preferences")).filter(|f| f != PROJECT_PREFERENCES).collect();
    folders.sort();
    folders.dedup();
    for folder in folders {
        let path = format!("preferences/{folder}/{folder}.aod");
        let Some(module) = docs.remove(&path) else { continue };
        let target = docs.get_mut(&target_path).expect("Ziel vorhanden");
        for wrapper in [&b"customConfigProperties"[..], &b"customProperties"[..]] {
            let Some(from) = module.child_by_tag(module.root, wrapper) else { continue };
            let into = match target.child_by_tag(target.root, wrapper) {
                Some(n) => n,
                None => target.append(target.root, crate::model::Node { tag: wrapper.to_vec(), ..Default::default() }),
            };
            for item in module.node(from).children.clone() {
                target.copy_subtree(into, &module, item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{parse::parse, write::write_v2};

    fn lang(name: &str, entries: &[(&str, &str)]) -> Document {
        let mut s = format!("<language><name>{name}</name><language>de</language><keyValueMap>");
        for (k, v) in entries {
            s.push_str(&format!("<stringEntry><name>{k}</name><value>{v}</value></stringEntry>"));
        }
        s.push_str("</keyValueMap></language>");
        parse(s.as_bytes()).unwrap()
    }

    #[test]
    fn languages_merge_sorted_by_key() {
        let mut docs = HashMap::new();
        docs.insert("language/_____LANGUAGE_de/_____LANGUAGE_de.aod".to_string(), lang("_____LANGUAGE_de", &[("m", "1")]));
        docs.insert("language/_____LANGUAGE_de_a/_____LANGUAGE_de_a.aod".to_string(), lang("_____LANGUAGE_de_a", &[("z", "2"), ("a", "3")]));
        merge_languages(&mut docs, &mut Vec::new());
        assert_eq!(docs.len(), 1);
        let out = String::from_utf8(write_v2(&docs["language/_____LANGUAGE_de/_____LANGUAGE_de.aod"])).unwrap();
        let keys: Vec<&str> = out.split("<name>").skip(2).map(|s| s.split("</name>").next().unwrap()).collect();
        assert_eq!(keys, ["a", "m", "z"]);
    }

    #[test]
    fn preferences_of_modules_fold_into_the_project() {
        let mut docs = HashMap::new();
        docs.insert(
            format!("preferences/{PROJECT_PREFERENCES}/{PROJECT_PREFERENCES}.aod"),
            parse(b"<preferences><name>P</name><customConfigProperties><x><name>a</name></x></customConfigProperties></preferences>").unwrap(),
        );
        docs.insert(
            "preferences/_____PREFERENCES_m/_____PREFERENCES_m.aod".to_string(),
            parse(b"<preferences><name>m</name><customConfigProperties><x><name>b</name></x></customConfigProperties></preferences>").unwrap(),
        );
        merge_preferences(&mut docs);
        assert_eq!(docs.len(), 1);
        let out = String::from_utf8(write_v2(&docs[&format!("preferences/{PROJECT_PREFERENCES}/{PROJECT_PREFERENCES}.aod")])).unwrap();
        assert!(out.contains("<name>a</name>") && out.contains("<name>b</name>"));
    }
}
