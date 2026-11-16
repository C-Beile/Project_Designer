// Alias-Zusammenführung: Ein Alias kann Tabellen zu einem Alias in einem anderen Modul beitragen. Er nennt das Ziel in
// `<targetAliasName>` (zum Beispiel `Activity_Data_alias` -> `Data_alias`). Im Ergebnis gibt es nur noch das Ziel:
// erst seine eigenen Tabellen, dann die aller Beitragenden, nach Name sortiert. Die Beitragenden verschwinden, und jedes
// Objekt, das einen Beitragenden als Alias nennt, nennt danach das Ziel. Aus dem alten Rust-Transpiler übernommen (V1-Orakel),
// am V2-Orakel zu prüfen.
//
// Wichtig (Plan, "Reihenfolge ist Pflicht"): Gleiche Tabelle in mehreren Beitragenden wird nie still überschrieben.
// Doppelte Tabellennamen im Ziel werden gemeldet, beide bleiben stehen (V2 würde mit einem Integritätsfehler abbrechen).

use std::collections::{BTreeMap, HashMap};

use crate::api::{Diagnostic, Severity};
use crate::model::{Document, NodeId};

/// Tags, die den Alias nennen, auf dem ein Objekt arbeitet.
pub const ALIAS_REFERENCE_TAGS: &[&[u8]] = &[b"alias", b"jDitoRecordAlias", b"indexRecordAlias"];

fn target_of(doc: &Document) -> Option<String> {
    let sub = doc.child_by_tag(doc.root, b"aliasDefinitionSub")?;
    let db = doc.child_by_tag(sub, b"aliasDefDb")?;
    doc.child_text(db, b"targetAliasName").map(|t| String::from_utf8_lossy(t).trim().to_string()).filter(|t| !t.is_empty())
}

fn entities_node(doc: &Document) -> Option<NodeId> {
    let sub = doc.child_by_tag(doc.root, b"aliasDefinitionSub")?;
    let db = doc.child_by_tag(sub, b"aliasDefDb")?;
    let group = doc.child_by_tag(db, b"entityGroup")?;
    doc.child_by_tag(group, b"entities")
}

fn alias_name_of_path(path: &str) -> Option<&str> {
    path.strip_prefix("aliasDefinition/")?.split('/').next()
}

/// Führt die Beitragenden in ihre Ziele zusammen. `docs`: Pfad -> Baum. Gibt (Beitragender, Ziel) zurück.
pub fn merge_aliases(docs: &mut HashMap<String, Document>, diagnostics: &mut Vec<Diagnostic>) -> Vec<(String, String)> {
    // Beitragende je Ziel, nach Ordnername geordnet.
    let mut by_target: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut paths: Vec<&String> = docs.keys().filter(|p| p.starts_with("aliasDefinition/") && p.ends_with(".aod")).collect();
    paths.sort();
    for path in paths {
        if let Some(target) = target_of(&docs[path]) {
            if let Some(name) = alias_name_of_path(path) {
                by_target.entry(target).or_default().push(name.to_string());
            }
        }
    }

    let mut renames = Vec::new();
    for (target, contributors) in by_target {
        let base_path = format!("aliasDefinition/{target}/{target}.aod");
        if !docs.contains_key(&base_path) {
            continue;
        }
        // Tabellen der Beitragenden einsammeln (Name, Beitragender, Knoten), danach sortieren.
        let mut sources: Vec<Document> = Vec::new();
        let mut collected: Vec<(String, String, usize, NodeId)> = Vec::new();
        for name in &contributors {
            let path = format!("aliasDefinition/{name}/{name}.aod");
            let Some(doc) = docs.remove(&path) else { continue };
            if let Some(entities) = entities_node(&doc) {
                for entity in doc.node(entities).children.clone() {
                    let entity_name = doc.child_text(entity, b"name").map(|n| String::from_utf8_lossy(n).into_owned()).unwrap_or_default();
                    collected.push((entity_name, name.clone(), sources.len(), entity));
                }
            }
            sources.push(doc);
            renames.push((name.clone(), target.clone()));
        }
        collected.sort_by(|a, b| a.0.cmp(&b.0));

        let base = docs.get_mut(&base_path).expect("Ziel vorhanden");
        let Some(base_entities) = entities_node(base) else { continue };
        let existing: Vec<String> = base
            .node(base_entities)
            .children
            .iter()
            .filter_map(|c| base.child_text(*c, b"name").map(|n| String::from_utf8_lossy(n).into_owned()))
            .collect();
        let mut seen: HashMap<String, String> = existing.into_iter().map(|n| (n, target.clone())).collect();
        for (entity_name, from, source, node) in collected {
            if let Some(first) = seen.get(&entity_name) {
                diagnostics.push(Diagnostic {
                    severity: Severity::Warning,
                    message: format!("Tabelle {entity_name} kommt in Alias {first} und {from} vor (Ziel {target}); beide stehen im Ergebnis"),
                    sources: Vec::new(),
                });
            } else {
                seen.insert(entity_name, from);
            }
            base.copy_subtree(base_entities, &sources[source], node);
        }
        // V2 sortiert alle Tabellen des Ziels nach Name, `_` vor Buchstaben, ohne Rücksicht auf Groß- und Kleinschreibung
        // (Orakel `Data_alias`: `AB_UNLINKEDMAIL` steht vor `ABSENCE`).
        let key = |doc: &Document, id: NodeId| doc.child_text(id, b"name").map(|n| String::from_utf8_lossy(n).to_lowercase().replace('_', "\u{0}")).unwrap_or_default();
        let mut children = base.node(base_entities).children.clone();
        children.sort_by_cached_key(|c| key(base, *c));
        base.node_mut(base_entities).children = children;
    }
    renames
}

/// Nennt in `doc` den Alias neu, wenn er zusammengeführt wurde.
pub fn rename_alias_references(doc: &mut Document, renames: &HashMap<&str, &str>) {
    for id in 0..doc.len() as NodeId {
        let node = doc.node(id);
        if !ALIAS_REFERENCE_TAGS.contains(&node.tag.as_slice()) {
            continue;
        }
        let Some(text) = node.text.as_ref() else { continue };
        if let Some(to) = renames.get(String::from_utf8_lossy(text).as_ref()) {
            doc.node_mut(id).text = Some(to.as_bytes().to_vec());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{parse::parse, write::write_v2};

    fn alias(name: &str, target: Option<&str>, entities: &[&str]) -> Document {
        let mut s = format!("<aliasDefinition><name>{name}</name><aliasDefinitionSub><aliasDefDb>");
        if let Some(t) = target {
            s.push_str(&format!("<targetAliasName>{t}</targetAliasName>"));
        }
        s.push_str("<entityGroup><name>entityGroup</name><entities>");
        for e in entities {
            s.push_str(&format!("<entityDb><name>{e}</name></entityDb>"));
        }
        s.push_str("</entities></entityGroup></aliasDefDb></aliasDefinitionSub></aliasDefinition>");
        parse(s.as_bytes()).unwrap()
    }

    #[test]
    fn contributors_merge_all_sorted_and_disappear() {
        let mut docs = HashMap::new();
        docs.insert("aliasDefinition/Data_alias/Data_alias.aod".to_string(), alias("Data_alias", None, &["DATABASECHANGELOG"]));
        docs.insert("aliasDefinition/B_alias/B_alias.aod".to_string(), alias("B_alias", Some("Data_alias"), &["ZETA", "ALPHA"]));
        docs.insert("aliasDefinition/C_alias/C_alias.aod".to_string(), alias("C_alias", Some("Data_alias"), &["MIDDLE"]));
        docs.insert("aliasDefinition/Other/Other.aod".to_string(), alias("Other", None, &["KEEP"]));
        let renames = merge_aliases(&mut docs, &mut Vec::new());
        assert_eq!(renames.len(), 2);
        assert!(!docs.contains_key("aliasDefinition/B_alias/B_alias.aod") && docs.contains_key("aliasDefinition/Other/Other.aod"));
        let out = String::from_utf8(write_v2(&docs["aliasDefinition/Data_alias/Data_alias.aod"])).unwrap();
        let names: Vec<&str> = out.split("<name>").skip(1).map(|s| s.split("</name>").next().unwrap()).filter(|n| *n != "Data_alias" && *n != "entityGroup").collect();
        assert_eq!(names, ["ALPHA", "DATABASECHANGELOG", "MIDDLE", "ZETA"]);
    }

    #[test]
    fn same_table_in_two_aliases_is_reported() {
        let mut docs = HashMap::new();
        docs.insert("aliasDefinition/Data_alias/Data_alias.aod".to_string(), alias("Data_alias", None, &[]));
        docs.insert("aliasDefinition/A/A.aod".to_string(), alias("A", Some("Data_alias"), &["T"]));
        docs.insert("aliasDefinition/B/B.aod".to_string(), alias("B", Some("Data_alias"), &["T"]));
        let mut notes = Vec::new();
        merge_aliases(&mut docs, &mut notes);
        assert_eq!(notes.len(), 1);
        assert!(notes[0].message.contains('T'));
    }

    #[test]
    fn references_follow_the_rename() {
        let mut doc = parse(b"<entity><alias>B_alias</alias><jDitoRecordAlias>C</jDitoRecordAlias></entity>").unwrap();
        let renames: HashMap<&str, &str> = [("B_alias", "Data_alias")].into_iter().collect();
        rename_alias_references(&mut doc, &renames);
        let out = String::from_utf8(write_v2(&doc)).unwrap();
        assert!(out.contains("<alias>Data_alias</alias>") && out.contains("<jDitoRecordAlias>C</jDitoRecordAlias>"));
    }
}
