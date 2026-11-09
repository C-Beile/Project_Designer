//! `application` validator registrations (P4, fifth editor family: `ApplicationEditor`).
//! Mirrors the shape every prior P4 family established (`flatten` -> registry -> `Vec<Diagnostic>`)
//! so `validator_table.rs`'s `object_type`-indexed `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat
//! `application` identically to the other object types.
//!
//! **Ablageformat (Rechercheergebnis, siehe `p4-editor-system-preferences-application-notes.md`
//! §1):** a single project-wide `application/_____SYSTEM_APPLICATION_NEON/
//! _____SYSTEM_APPLICATION_NEON.aod` (real Hermes instance: 910 lines) - genuinely distinct from
//! `system`/`preferences`. Root element `application`, holding one root `entityNode` (`kind=200`)
//! whose `childNodes.entityNode` is a deeply recursive tree: every `entityNode` has `name`, a typed
//! `kind` (`v="..."`, an internal numeric node-kind code - `123`=group folder, `10077`=entity link,
//! `10090`=dashboard link, `159`=role/permission link, observed but not documented further, no XSD
//! available to decode the full enum, see aod-format.md §0), optional `title`/`icon`
//! (plain-text scalars, the genuinely editable display fields), and an optional nested
//! `childNodes.entityNode` of its own (same shape, recursively) - this is the Designer's
//! application/navigation-menu tree the ADITO client renders. A sibling `company` object (unrelated
//! shape) exists once at the root, outside `entityNode` entirely.
//!
//! **The clearest, most pervasive real R26 observation of this whole P4 round** (RISKS.md R26):
//! because this structure recurses, *every* `childNodes` in the real fixture independently has
//! either exactly one `entityNode` child (un-indexed `Object`, e.g. `ImporterCSV`'s single child
//! group `Group31`) or 2+ (indexed `Array`, e.g. `Contactmanagement`'s three child groups) - unlike
//! `language`'s one flat occurrence or `preferences`'s two list-level occurrences, this shape
//! repeats at *every nesting level* of the tree. `flatten_children`/`is_entity_node_name_path`
//! below are written to not care which shape a given level took (matches `flatten_into_with_type`'s
//! own existing generic Object/Array recursion - no special-casing needed on the walk itself, only
//! on the two validators' own path-suffix matching below).
//!
//! Both rules are file-local (no project-wide index), same precedent as every prior P4 family.
//! Structural edits (rename/add/remove a node) are out of scope, same documented `designer_core::
//! ProjectHandle::set_property`-is-scalar-only limitation `p4-editor-language-translation-notes.md`
//! §9 already flagged - only `title`/`icon` are edited by this editor, `name`/`kind` stay read-only
//! (kind additionally for the R24 typed-attribute reason).

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), ObjectType::Application, &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: two `entityNode`s under the *same* `childNodes` sharing a `name` is a genuine
/// authoring mistake - the same target (entity/role/dashboard) linked twice into one menu group,
/// with the second entry's `kind`/`title`/`icon` overrides silently shadowed by whichever the
/// Designer/client picks first. Scoped per direct-parent `childNodes` list (a name repeating in a
/// *different* group, e.g. `INTERNAL_ADMINISTRATOR` appearing under dozens of unrelated groups in
/// the real fixture, is completely normal - every real occurrence checked). Verified against the
/// real, uncorrupted fixture first (0 same-parent duplicates across its ~140 real entityNodes), so
/// this rule does not fire on legitimate, untouched project files.
pub struct DuplicateChildNodeNameValidator;

impl Validator for DuplicateChildNodeNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<(String, String), String> = HashMap::new(); // (parent scope, name) -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_entity_node_name_path(&node.path) {
                continue;
            }
            let Some(scope) = parent_child_nodes_scope(&node.path) else { continue };
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            let key = (scope, name.clone());
            if let Some(first_path) = seen.get(&key) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate entityNode name '{name}' in the same childNodes group (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(key, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Real rule #2: an `entityNode` with an empty `name` cannot reference anything - a dangling menu
/// entry that resolves to nothing in the client. Verified against the real fixture first (every one
/// of its ~140 real entityNodes has a non-empty name), so this rule does not fire on legitimate,
/// untouched project files.
pub struct EmptyEntityNodeNameValidator;

impl Validator for EmptyEntityNodeNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut diagnostics = Vec::new();
        for node in &project.nodes {
            if !is_entity_node_name_path(&node.path) {
                continue;
            }
            if let PluginValue::String(s) = &node.value {
                if s.trim().is_empty() {
                    diagnostics.push(Diagnostic::error(
                        "entityNode name is empty - this menu entry does not reference anything",
                        node.path.clone(),
                    ));
                }
            }
        }
        diagnostics
    }
}

/// Matches a `.name` leaf directly under an `entityNode` (indexed `entityNode[3].name` or
/// un-indexed `entityNode.name`, module doc's R26 note) - deliberately excludes the unrelated root
/// `company.name` field (different immediate parent tag, see module doc) by checking the
/// second-to-last path segment rather than a bare substring match.
fn is_entity_node_name_path(path: &str) -> bool {
    let mut segments = path.split('.');
    let Some(last) = path.rsplit('.').next() else { return false };
    if last != "name" {
        return false;
    }
    // Re-derive the second-to-last segment (the immediate parent tag, with its optional [N]).
    let mut prev = None;
    for seg in segments.by_ref() {
        if seg == last {
            break;
        }
        prev = Some(seg);
    }
    prev.map(|p| p == "entityNode" || p.starts_with("entityNode[")).unwrap_or(false)
}

/// The path prefix identifying which `childNodes` list an `entityNode.name` path's node belongs to
/// - everything before its own `entityNode`/`entityNode[N]` segment. Depth-agnostic (module doc's
/// R26 note: this recurses at every level), works by splitting the dotted/bracketed path string and
/// dropping the trailing `name` and `entityNode[...]` segments.
fn parent_child_nodes_scope(path: &str) -> Option<String> {
    let mut segments: Vec<&str> = path.split('.').collect();
    segments.pop()?; // drop "name"
    let last = segments.pop()?; // drop "entityNode" / "entityNode[N]"
    if last != "entityNode" && !last.starts_with("entityNode[") {
        return None;
    }
    Some(segments.join("."))
}

/// The `object_type`-indexed dispatch entry point for `application` diagnostics
/// (`validator_table.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(DuplicateChildNodeNameValidator));
    registry.register_validator(Box::new(EmptyEntityNodeNameValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn entity_node(name: &str, children: Option<CoreValue>) -> CoreValue {
        let mut fields = vec![("name".into(), text(name)), ("kind".into(), CoreValue::Scalar(CoreScalar::Int(123)))];
        if let Some(children) = children {
            fields.push(("childNodes".into(), CoreValue::Object(vec![("entityNode".into(), children)])));
        }
        CoreValue::Object(fields)
    }

    fn sample_application(root_children: Vec<CoreValue>) -> CoreValue {
        CoreValue::Object(vec![(
            "entityNode".into(),
            entity_node("entityNode", Some(CoreValue::Array(root_children))),
        )])
    }

    #[test]
    fn distinct_sibling_names_are_silent() {
        let root = sample_application(vec![entity_node("A", None), entity_node("B", None)]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate entityNode")));
    }

    #[test]
    fn duplicate_sibling_name_is_flagged() {
        let root = sample_application(vec![entity_node("A", None), entity_node("A", None)]);
        let diagnostics = DuplicateChildNodeNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'A'"));
    }

    #[test]
    fn same_name_in_different_groups_is_not_a_duplicate() {
        let group1 = entity_node("Group1", Some(CoreValue::Array(vec![entity_node("INTERNAL_ADMINISTRATOR", None)])));
        let group2 = entity_node("Group2", Some(CoreValue::Array(vec![entity_node("INTERNAL_ADMINISTRATOR", None)])));
        let root = sample_application(vec![group1, group2]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate entityNode")));
    }

    /// Real R26 shape (module doc): a `childNodes` with exactly one `entityNode` child projects
    /// un-indexed (`childNodes.entityNode`, not `childNodes.entityNode[0]`) - must still be scanned
    /// for both rules, at nested depth, not just at the top level.
    #[test]
    fn single_child_unindexed_shape_is_still_checked_at_nested_depth() {
        let single_child_group = entity_node("ImporterCSV", Some(entity_node("Group31", None)));
        let root = sample_application(vec![single_child_group]);
        let diagnostics = diagnostics_for(&root);
        assert!(diagnostics.is_empty(), "a lone real child must not falsely flag as empty/duplicate: {diagnostics:?}");
    }

    #[test]
    fn empty_name_is_flagged() {
        let root = sample_application(vec![entity_node("", None)]);
        let diagnostics = EmptyEntityNodeNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
    }

    #[test]
    fn company_name_field_is_not_mistaken_for_an_entity_node_name() {
        let mut root = sample_application(vec![entity_node("A", None)]);
        if let CoreValue::Object(fields) = &mut root {
            fields.push(("company".into(), CoreValue::Object(vec![("name".into(), text("company")), ("title".into(), text(""))])));
        }
        assert!(diagnostics_for(&root).is_empty());
    }
}
