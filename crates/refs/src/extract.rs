//! Edge extraction (architecture.md §7 "Aufbau"): walks one object's `PropertyValue` tree and
//! pulls out outgoing references per the verified catalogue in aod-format.md §4.
//!
//! Extraction works against the flattened `PropertyValue` shape directly (not against
//! `PropertyTree`/`EventSource`) because identifying *that* a field is a reference only needs the
//! structural context (which element a scalar sits directly under, and its own field name) - not
//! byte spans. Byte spans only matter once a *cascade* needs to patch the site, which is
//! `RefGraph::rename_cascade`'s job against the referencing object's own `PropertyTree`.

use core_model::{NodePath, PropertyValue};

use crate::edge::{Edge, RefKind};
use crate::object_id::ObjectId;

/// Reads the `aliasDefDb.targetAliasName` value off an Alias object's own root value - the short
/// form entities actually reference (aod-format.md §4 row 4). Callers register this with
/// `RefGraph::register_alias_target_name` before indexing entities that use it, so
/// `dbRecordContainer.alias` edges resolve to the right `ObjectId` instead of the literal string.
pub fn target_alias_name(alias_root: &PropertyValue) -> Option<String> {
    alias_root.field("aliasDefDb")?.field("targetAliasName")?.as_text().map(str::to_string)
}

/// Extracts every outgoing edge from `from`'s root value. `resolve_alias` maps an
/// `aliasDefDb.targetAliasName` short value to the `ObjectId` of the Alias object that declares
/// it - see `target_alias_name` above and aod-format.md §4's documented special case; an
/// unresolvable alias short name (not indexed yet) is dropped rather than guessed at, matching
/// "kein Full-Rescan" incremental semantics (the edge reappears once the alias itself is indexed).
pub fn extract_edges(from: &ObjectId, root: &PropertyValue, resolve_alias: &dyn Fn(&str) -> Option<ObjectId>) -> Vec<Edge> {
    let mut edges = Vec::new();
    walk(from, None, &NodePath::root(), root, resolve_alias, &mut edges);
    edges
}

fn walk(
    from: &ObjectId,
    container: Option<&str>,
    path: &NodePath,
    value: &PropertyValue,
    resolve_alias: &dyn Fn(&str) -> Option<ObjectId>,
    edges: &mut Vec<Edge>,
) {
    match value {
        PropertyValue::Object(fields) => {
            for (name, child) in fields {
                let child_path = path.field(name);
                match child {
                    PropertyValue::Scalar(_) => {
                        if let Some(edge) = match_scalar_ref(from, container, name, child, &child_path, resolve_alias) {
                            edges.push(edge);
                        }
                    }
                    _ => walk(from, Some(name.as_str()), &child_path, child, resolve_alias, edges),
                }
            }
        }
        PropertyValue::Array(items) => {
            // Each item is one instance of the repeatable element named by `container` (the
            // flattening convention documented in value.rs: the plural wrapper field holds an
            // object whose one field, the singular tag name, is the array) - so the container
            // context carries through unchanged into each item.
            for (i, item) in items.iter().enumerate() {
                walk(from, container, &path.index(i), item, resolve_alias, edges);
            }
        }
        PropertyValue::Scalar(_) => {}
    }
}

/// One match arm per catalogued reference type (aod-format.md §4) whose target is a bare-name
/// scalar. `container` is the tag name of the element the scalar is a direct child of (e.g.
/// `"neonContext"` for its `entity` field) - see the module doc comment for why that alone is
/// enough context without needing full ancestor paths.
fn match_scalar_ref(
    from: &ObjectId,
    container: Option<&str>,
    field_name: &str,
    value: &PropertyValue,
    site: &NodePath,
    resolve_alias: &dyn Fn(&str) -> Option<ObjectId>,
) -> Option<Edge> {
    let text = value.as_text().filter(|t| !t.is_empty())?;

    let (to, kind) = match (container, field_name) {
        (Some("neonContext"), "entity") => (ObjectId::entity(text), RefKind::NeonContextEntity),
        (Some("neonContext"), "mainView" | "filterView" | "editView" | "previewView" | "lookupView") => (ObjectId::view(text), RefKind::ViewReference),
        (Some("neonViewReference"), "view") => (ObjectId::view(text), RefKind::ViewReference),
        (Some("neonDashlet"), "viewName") => (ObjectId::view(text), RefKind::ViewReference),
        (Some("dependency"), "entityName") => (ObjectId::entity(text), RefKind::EntityConsumerDependency),
        (Some("webserviceReference"), "webservice") => (ObjectId::webservice(text), RefKind::EntityConsumerDependency),
        (Some("dbRecordContainer"), "alias") => (resolve_alias(text)?, RefKind::DbRecordContainerAlias),
        (Some("entityField"), "valueProcess" | "displayValueProcess") => (ObjectId::linked_file(text), RefKind::ValueProcessLinkedFile),
        _ => return None,
    };

    Some(Edge { from: from.clone(), to, kind, site: site.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::ScalarValue;

    fn text(s: &str) -> PropertyValue {
        PropertyValue::Scalar(ScalarValue::Text(s.to_string()))
    }

    fn obj(fields: Vec<(&str, PropertyValue)>) -> PropertyValue {
        PropertyValue::Object(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    fn no_alias(_name: &str) -> Option<ObjectId> {
        None
    }

    #[test]
    fn extracts_neon_context_entity_reference() {
        let from = ObjectId::view("THHIT_TourFilter_view");
        let root = obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]);

        let edges = extract_edges(&from, &root, &no_alias);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, RefKind::NeonContextEntity);
        assert_eq!(edges[0].to, ObjectId::entity("THHIT_Tour_entity"));
        assert_eq!(edges[0].site, NodePath::root().field("neonContext").field("entity"));
    }

    #[test]
    fn extracts_view_reference_from_neon_view_reference_children() {
        let from = ObjectId::view("THHIT_Tour_view");
        // Mirrors a view's `children.neonViewReference[..]` array (aod-format.md §4) - each
        // array item is one `neonViewReference` element, so its own fields see
        // "neonViewReference" as their container.
        let root = obj(vec![(
            "children",
            obj(vec![("neonViewReference", PropertyValue::Array(vec![obj(vec![("view", text("THHIT_TourDetail_view"))])]))]),
        )]);

        let edges = extract_edges(&from, &root, &no_alias);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, RefKind::ViewReference);
        assert_eq!(edges[0].to, ObjectId::view("THHIT_TourDetail_view"));
        assert_eq!(
            edges[0].site,
            NodePath::root().field("children").field("neonViewReference").index(0).field("view")
        );
    }

    #[test]
    fn extracts_entity_consumer_dependency_reference() {
        let from = ObjectId::entity("Document_entity");
        let root = obj(vec![(
            "entityConsumer",
            obj(vec![("dependency", obj(vec![("entityName", text("THHIT_Tour_entity")), ("fieldName", text("Documents"))]))]),
        )]);

        let edges = extract_edges(&from, &root, &no_alias);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, RefKind::EntityConsumerDependency);
        assert_eq!(edges[0].to, ObjectId::entity("THHIT_Tour_entity"));
    }

    #[test]
    fn extracts_value_process_as_a_linked_file_reference() {
        let from = ObjectId::entity("THHIT_Tour_entity");
        let root = obj(vec![(
            "entityFields",
            obj(vec![(
                "entityField",
                PropertyValue::Array(vec![obj(vec![
                    ("name", text("COUNTRY")),
                    ("valueProcess", text("%aditoprj%/entity/THHIT_Tour_entity/process/countryValueProcess.js")),
                ])]),
            )]),
        )]);

        let edges = extract_edges(&from, &root, &no_alias);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, RefKind::ValueProcessLinkedFile);
        assert_eq!(edges[0].to, ObjectId::linked_file("%aditoprj%/entity/THHIT_Tour_entity/process/countryValueProcess.js"));
    }

    /// The documented special case (aod-format.md §4 row 4): the entity's `dbRecordContainer.alias`
    /// value is the alias's `targetAliasName` *short form*, not the alias object's own ADITO
    /// object name - the resolver must be consulted, and the edge must land on the resolved
    /// object, not on an `ObjectId` built directly from the literal string.
    #[test]
    fn resolves_db_record_container_alias_through_target_alias_name_not_the_literal_text() {
        let from = ObjectId::entity("THHIT_Tour_entity");
        let root = obj(vec![("dbRecordContainer", obj(vec![("alias", text("Data_alias"))]))]);

        let resolve = |short_name: &str| -> Option<ObjectId> {
            assert_eq!(short_name, "Data_alias", "resolver must be consulted with the literal field text");
            Some(ObjectId::alias("THHIT_Data_alias"))
        };

        let edges = extract_edges(&from, &root, &resolve);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, RefKind::DbRecordContainerAlias);
        assert_eq!(
            edges[0].to,
            ObjectId::alias("THHIT_Data_alias"),
            "edge target must be the alias's real object name, not the literal 'Data_alias' text"
        );
        assert_ne!(edges[0].to, ObjectId::alias("Data_alias"));
    }

    #[test]
    fn db_record_container_alias_is_dropped_when_the_alias_is_not_yet_indexed() {
        let from = ObjectId::entity("THHIT_Tour_entity");
        let root = obj(vec![("dbRecordContainer", obj(vec![("alias", text("Unknown_alias"))]))]);

        let edges = extract_edges(&from, &root, &no_alias);

        assert!(edges.is_empty(), "an unresolvable alias short name must not produce a wrong edge");
    }

    #[test]
    fn target_alias_name_reads_the_short_form_off_an_alias_object() {
        let alias_root = obj(vec![("aliasDefDb", obj(vec![("targetAliasName", text("Data_alias"))]))]);
        assert_eq!(target_alias_name(&alias_root).as_deref(), Some("Data_alias"));
    }
}
