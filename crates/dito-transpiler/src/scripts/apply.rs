// Service-Aufrufe in allen Modellen einsetzen (siehe `services`). Läuft nach den Zusammenführungen, damit
// Implementierungen aus Modifikationen und Erweiterungspunkten schon im Baum stehen.

use std::collections::HashMap;

use rayon::prelude::*;

use super::services::{Context, Implementations, Owned, CALL};
use crate::model::{Document, NodeId};

fn text_of(doc: &Document, id: NodeId, tag: &[u8]) -> Option<String> {
    doc.child_text(id, tag).map(|t| String::from_utf8_lossy(t).into_owned())
}

/// Service-Definitionen eines Modells: `entityServiceDefinition` eines Entity und das Modell selbst, wenn es ein Service ist.
fn definitions(doc: &Document) -> HashMap<String, Implementations> {
    let mut out: HashMap<String, Implementations> = HashMap::new();
    let mut add = |holder: NodeId| {
        let Some(name) = text_of(doc, holder, b"name") else { return };
        let mut impls: Implementations = Vec::new();
        if let Some(list) = doc.child_by_tag(holder, b"implementations") {
            for item in &doc.node(list).children {
                if let (Some(n), Some(p)) = (text_of(doc, *item, b"name"), text_of(doc, *item, b"process")) {
                    impls.push((n, p));
                }
            }
        }
        out.insert(name, impls);
    };
    if doc.node(doc.root).tag == b"serviceDefinition" {
        add(doc.root);
    }
    for id in 0..doc.len() as NodeId {
        if doc.node(id).tag == b"entityServiceDefinition" {
            add(id);
        }
    }
    out
}

pub fn build_owned(docs: &HashMap<String, Document>) -> Owned {
    let mut owned: Owned = HashMap::new();
    for (path, doc) in docs {
        let Some(owner) = path.rsplit_once('/').map(|(o, _)| o.to_string()) else { continue };
        let defs = definitions(doc);
        if !defs.is_empty() {
            owned.insert(owner, defs);
        }
    }
    owned
}

/// Soll das Skript in diesem Knoten Service-Aufrufe einsetzen? Das Skript einer Service-Implementierung eines Entity nimmt die
/// Services auf, die es aufruft, außer den eigenen. Die Implementierungen eines globalen Service bleiben, wie sie sind.
fn should_transform(doc: &Document, id: NodeId, text: &str) -> bool {
    let mut current = doc.node(id).parent;
    while let Some(p) = current {
        let node = doc.node(p);
        if node.tag == b"serviceImplementation" {
            if doc.node(doc.root).tag == b"serviceDefinition" {
                return false;
            }
            // Eigener Service: Eltern-`implementations`, dann `entityServiceDefinition`.
            let holder = node.parent.and_then(|l| doc.node(l).parent);
            if let Some(h) = holder {
                if let Some(own) = text_of(doc, h, b"name") {
                    if own.is_empty() || text.contains(&format!("\"{own}\"")) {
                        return false;
                    }
                }
            }
        }
        current = node.parent;
    }
    true
}

/// Setzt in jedem Modell die Service-Aufrufe ein. Gibt die Zahl geänderter Skripte zurück.
pub fn inline_services(docs: &mut HashMap<String, Document>, canonical: &(dyn Fn(&str) -> String + Sync)) -> usize {
    let owned = build_owned(docs);
    let context = Context { owned: &owned, canonical };
    docs.par_iter_mut()
        .map(|(path, doc)| {
            let owner = path.rsplit_once('/').map(|(o, _)| o.to_string()).unwrap_or_default();
            let mut changed = 0;
            for id in 0..doc.len() as NodeId {
                let node = doc.node(id);
                let Some(bytes) = node.text.as_ref() else { continue };
                if !bytes.windows(CALL.len()).any(|w| w == CALL.as_bytes()) {
                    continue;
                }
                let Ok(text) = std::str::from_utf8(bytes) else { continue };
                if !should_transform(doc, id, text) {
                    continue;
                }
                if let Some(new_text) = context.transform(&owner, text) {
                    doc.node_mut(id).text = Some(new_text.into_bytes());
                    changed += 1;
                }
            }
            changed
        })
        .sum()
}
