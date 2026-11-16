// Erweiterungspunkte: Ein Modul markiert Stellen, an denen andere Module einhaken (`<neonViewExtensionPoint>`, ...).
// Das Ergebnis enthält keinen Erweiterungspunkt mehr: Seine `<implementations>` treten an seine Stelle (eine Ebene höher,
// gleiche Position). Ein Erweiterungspunkt ohne Implementierungen verschwindet. Am V2-Orakel belegt (neonView, entity).

use crate::model::{Document, NodeId};

fn is_extension_point(doc: &Document, id: NodeId) -> bool {
    doc.node(id).tag.ends_with(b"ExtensionPoint")
}

/// Löst alle Erweiterungspunkte im Baum auf. Gibt die Zahl der aufgelösten zurück.
pub fn resolve(doc: &mut Document) -> usize {
    let root = doc.root;
    resolve_children(doc, root)
}

fn resolve_children(doc: &mut Document, parent: NodeId) -> usize {
    let mut resolved = 0;
    let old = doc.node(parent).children.clone();
    let mut new_children: Vec<NodeId> = Vec::with_capacity(old.len());
    for child in old {
        if is_extension_point(doc, child) {
            resolved += 1;
            // Implementierungen können selbst Erweiterungspunkte enthalten: erst darin auflösen.
            if let Some(implementations) = doc.child_by_tag(child, b"implementations") {
                resolved += resolve_children(doc, implementations);
                let items = doc.node(implementations).children.clone();
                for item in &items {
                    doc.node_mut(*item).parent = Some(parent);
                }
                new_children.extend(items);
            }
        } else {
            resolved += resolve_children(doc, child);
            new_children.push(child);
        }
    }
    doc.node_mut(parent).children = new_children;
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{parse::parse, write::write_v2};

    #[test]
    fn implementations_replace_the_extension_point() {
        let src = "<a><children><x /><fooExtensionPoint><name>P</name><implementations><impl1 /><impl2 /></implementations></fooExtensionPoint><y /></children></a>";
        let mut doc = parse(src.as_bytes()).unwrap();
        assert_eq!(resolve(&mut doc), 1);
        let out = String::from_utf8(write_v2(&doc)).unwrap();
        assert!(out.contains("<x />\n    <impl1 />\n    <impl2 />\n    <y />"), "{out}");
    }

    #[test]
    fn extension_point_without_implementations_disappears() {
        let mut doc = parse(b"<a><barExtensionPoint><name>P</name></barExtensionPoint><b /></a>").unwrap();
        assert_eq!(resolve(&mut doc), 1);
        let out = String::from_utf8(write_v2(&doc)).unwrap();
        assert!(!out.contains("ExtensionPoint") && out.contains("<b />"));
    }
}
