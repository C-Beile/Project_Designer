//! `entityWebservice` validator registrations (P4, sixth editor family: `WebserviceEditor`).
//! Mirrors every prior P4 family's shape (`flatten` -> registry -> `Vec<Diagnostic>`) so
//! `validator_table.rs`'s `object_type`-indexed `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat
//! `entityWebservice` identically to the other object types.
//!
//! **Ablageformat (own mini format analysis, this agent, verified against the real corpus - no
//! P1 `webservice.schema.json` existed for this family, see `p4-editor-webservice-notes.md` §1 for
//! the full writeup):** top-level project folder is `entityWebservice` (NOT `webservice` - the
//! reference type name `webserviceReference.webservice` in aod-format.md §4 names the *reference*
//! element, not the target object's own folder/root element), one `entityWebservice/<Name>_ws/
//! <Name>_ws.aod` or `entityWebservice/<Name>_webservice/<Name>_webservice.aod` per instance
//! (suffix varies by project, same "constant top-level folder, varying instance-folder suffix"
//! shape `aliasDefinition`/`language` already established). Root element `entityWebservice`,
//! VERSION `1.1.0`. Real fields, verified across 47+ instances in Hermes/BHB/Pichler/
//! Car_Training: `name`/`majorModelMode` (plain text, identity/constant), `webserviceMethods`
//! (a list of HTTP verb tokens, `<element>GET</element>` etc. - never empty in any real instance,
//! 1 to 5 methods observed), `loginTypeId` (an optional list of auth-type tokens, always exactly
//! one `<element>` in every real instance that has it at all), `jditoWebserviceUser`/
//! `writeProvider`/`readProvider` (plain text scalars, legitimately empty in some real instances,
//! e.g. `THHIT_Tour_ws`), and `webserviceFields` - a list mixing two distinct tag names:
//! `webserviceField` (leaf: `name` is a Designer-internal UUID, `webserviceFieldName` is the real
//! business field name being exposed) and `webserviceFieldConsumer` (`name` UUID, `consumer` name,
//! and an *optional nested* `webserviceFields` of its own, same shape recursively - verified one
//! level deep in the real corpus, e.g. `THHIT_Tour_ws`'s `Documents` consumer exposing 11 of its
//! own fields).
//!
//! **R26 (RISKS.md) real instance found here, in three independent places:** `webserviceMethods.
//! element` (1 real method on `THHIT_Tour_ws` = un-indexed Object, 5 on `Operation_ws`/`Order_ws` =
//! indexed Array), `loginTypeId.element` (always exactly 1 in every real instance that has the
//! field at all), and `webserviceFields.webserviceField`/`.webserviceFieldConsumer` (mixed-tag list,
//! same "independently array-or-object per tag name" shape `preferences`'s custom property banks
//! established, plus the same "recurses at nesting depth" shape `application`'s `entityNode` tree
//! established - `THHIT_PersonUpdate_ws` has exactly one real `webserviceField` total, the clearest
//! minimal real R26 example found this round). Per RISKS.md R26's now six-times-documented
//! precedent, this is handled locally in `flatten`/the two validators below (Object-vs-Array
//! treated uniformly), not by a `aod::tree`/`aod::document` change - no new schema knowledge was gained
//! this round that would make a safe generic fix possible, same reasoning
//! `p4-editor-system-preferences-application-notes.md` §3 already gave in detail.
//!
//! Both validators are file-local (no project-wide index), same YAGNI precedent every prior P4
//! family established. A project-wide "does `webserviceReference.webservice` point at a real
//! `entityWebservice` name" check was considered (role brief's SHOULD) but **not built**: the real
//! corpus itself disproves the premise that a missing target is always an error - Hermes'
//! `neonContext/THHIT_Tour/THHIT_Tour.aod` references `THHIT_Tour_token_ws`, which does not exist
//! anywhere under Hermes' own `entityWebservice/` folder (confirmed by directory listing), the same
//! legitimate cross-module-reference shape aod-format.md §2 already documents for `Person_entity`.
//! A validator built without npm-modules/dependency knowledge would flag this real, correct file as
//! broken - so, like every prior family's project-wide reference checks, this is deferred rather than
//! built as a guessed heuristic.

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), ObjectType::Webservice, &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: `webserviceMethods` with zero `element` entries means this webservice endpoint
/// answers no HTTP method at all - it is published but unreachable, a real deploy-time defect, not
/// a cosmetic gap. Verified against every real instance found across Hermes/BHB/Pichler/
/// Car_Training (47+ files): never empty, so this rule does not fire on legitimate, untouched
/// project files. Handles both real R26 shapes uniformly - `webserviceMethods.element` (1 method,
/// un-indexed) and `webserviceMethods.element[N]` (2+ methods, indexed).
pub struct EmptyWebserviceMethodsValidator;

impl Validator for EmptyWebserviceMethodsValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        let has_any_method = project.nodes.iter().any(|n| is_webservice_methods_element_path(&n.path));
        if has_any_method {
            return Vec::new();
        }
        // Only flag when the `webserviceMethods` node itself is present at all - an object type
        // this validator is accidentally run against without that field (should not happen given
        // `VALIDATORS_BY_OBJECT_TYPE` dispatch, but keeps this rule from panicking/misfiring on a
        // malformed synthetic test tree) stays silent rather than guessing a path to attach to.
        if project.nodes.iter().any(|n| n.path == "webserviceMethods") {
            vec![Diagnostic::error(
                "webserviceMethods has no HTTP method - this webservice is published but answers no request",
                "webserviceMethods",
            )]
        } else {
            Vec::new()
        }
    }
}

fn is_webservice_methods_element_path(path: &str) -> bool {
    match path.strip_prefix("webserviceMethods.") {
        // `rest` is a leaf ("element" or "element[N]", R26) - `element` has no children of its
        // own, so no further dot-segments can appear here.
        Some(rest) => parent_tag(rest) == "element",
        None => false,
    }
}

/// Real rule #2: two `webserviceField`s sharing the same `webserviceFieldName` under the *same*
/// direct-parent `webserviceFields` list is a genuine authoring mistake - the same underlying entity
/// field published twice under one webservice/consumer scope, with the client seeing an ambiguous
/// duplicate key. Scoped per direct-parent `webserviceFields` list (the same field name reappearing
/// under a *different* `webserviceFieldConsumer`'s own nested list is normal - each consumer exposes
/// its own field set). Verified against all real fixtures first: 0 same-scope duplicates. Depth
/// agnostic, same recursive-R26 handling `application_validators.rs`'s `DuplicateChildNodeNameValidator`
/// established, since `webserviceFieldConsumer.webserviceFields` nests the identical shape again.
pub struct DuplicateWebserviceFieldNameValidator;

impl Validator for DuplicateWebserviceFieldNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<(String, String), String> = HashMap::new(); // (parent scope, name) -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_webservice_field_name_path(&node.path) {
                continue;
            }
            let Some(scope) = parent_webservice_fields_scope(&node.path) else { continue };
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            if name.trim().is_empty() {
                continue; // covered by callers wanting an "empty name" rule, not duplication
            }
            let key = (scope, name.clone());
            if let Some(first_path) = seen.get(&key) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate webserviceFieldName '{name}' in the same webserviceFields scope (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(key, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Matches a `.webserviceFieldName` leaf directly under a `webserviceField` (indexed or un-indexed,
/// R26). Deliberately checks the exact parent tag rather than a prefix match - `webserviceField` and
/// `webserviceFieldConsumer` share a common prefix, and a naive `starts_with("webserviceField")`
/// would also match `webserviceFieldConsumer[3]`.
fn is_webservice_field_name_path(path: &str) -> bool {
    let mut segments = path.split('.');
    let Some(last) = path.rsplit('.').next() else { return false };
    if last != "webserviceFieldName" {
        return false;
    }
    let mut prev = None;
    for seg in segments.by_ref() {
        if seg == last {
            break;
        }
        prev = Some(seg);
    }
    prev.map(|p| parent_tag(p) == "webserviceField").unwrap_or(false)
}

/// The path prefix identifying which `webserviceFields` list a `webserviceField.webserviceFieldName`
/// path's node belongs to - everything before its own `webserviceField`/`webserviceField[N]`
/// segment. Depth-agnostic (module doc's R26 note: this recurses via `webserviceFieldConsumer.
/// webserviceFields`), mirrors `application_validators.rs::parent_child_nodes_scope`.
fn parent_webservice_fields_scope(path: &str) -> Option<String> {
    let mut segments: Vec<&str> = path.split('.').collect();
    segments.pop()?; // drop "webserviceFieldName"
    let last = segments.pop()?; // drop "webserviceField" / "webserviceField[N]"
    if parent_tag(last) != "webserviceField" {
        return None;
    }
    Some(segments.join("."))
}

/// Strips a trailing `[N]` index suffix off one path segment, e.g. `"webserviceField[3]"` ->
/// `"webserviceField"`, `"webserviceField"` -> `"webserviceField"` (unchanged, the un-indexed R26
/// shape). Used instead of a prefix/`starts_with` check throughout this module so
/// `webserviceFieldConsumer`/`webserviceFieldConsumer[N]` never falsely matches `webserviceField`.
fn parent_tag(segment: &str) -> &str {
    segment.split('[').next().unwrap_or(segment)
}

/// The `object_type`-indexed dispatch entry point for `entityWebservice` diagnostics
/// (`validator_table.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(EmptyWebserviceMethodsValidator));
    registry.register_validator(Box::new(DuplicateWebserviceFieldNameValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn webservice_field(uuid: &str, field_name: &str) -> CoreValue {
        CoreValue::Object(vec![("name".into(), text(uuid)), ("webserviceFieldName".into(), text(field_name))])
    }

    /// `methods` becomes the real R26 shape automatically: one entry -> `Object` (un-indexed),
    /// 2+ -> `Array` (indexed) - `fields` is a `webserviceFields`-shaped `Object` whose own
    /// `webserviceField`/`webserviceFieldConsumer` keys the caller has already built with the same
    /// R26-aware shape.
    fn sample_webservice(methods: Vec<&str>, fields: Vec<(&str, CoreValue)>) -> CoreValue {
        // `webserviceMethods` is always an Object wrapping the real `element` list (the R26 shape
        // lives one level down, on `element` itself - a bare `Array` directly on `webserviceMethods`
        // is not the real shape and previously made this helper build a tree `is_webservice_methods_
        // element_path` could never match, silently defeating the "multi-method" test case).
        let methods_value = match methods.len() {
            0 => CoreValue::Object(vec![]),
            1 => CoreValue::Object(vec![("element".into(), text(methods[0]))]),
            _ => CoreValue::Object(vec![("element".into(), CoreValue::Array(methods.into_iter().map(text).collect()))]),
        };
        CoreValue::Object(vec![
            ("name".into(), text("Sample_ws")),
            ("majorModelMode".into(), text("DISTRIBUTED")),
            ("webserviceMethods".into(), methods_value),
            ("webserviceFields".into(), CoreValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())),
        ])
    }

    #[test]
    fn single_method_r26_shape_is_not_flagged_empty() {
        let root = sample_webservice(vec!["GET"], vec![("webserviceField".into(), webservice_field("u1", "TOURID"))]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("no HTTP method")));
    }

    #[test]
    fn multi_method_array_shape_is_not_flagged_empty() {
        let root = sample_webservice(
            vec!["GET", "POST", "PUT"],
            vec![("webserviceField".into(), webservice_field("u1", "TOURID"))],
        );
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("no HTTP method")));
    }

    #[test]
    fn zero_methods_is_flagged() {
        let root = sample_webservice(vec![], vec![("webserviceField".into(), webservice_field("u1", "TOURID"))]);
        let diagnostics = EmptyWebserviceMethodsValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("webserviceMethods"));
    }

    #[test]
    fn distinct_field_names_are_silent() {
        let root = sample_webservice(
            vec!["GET"],
            vec![(
                "webserviceField".into(),
                CoreValue::Array(vec![webservice_field("u1", "A"), webservice_field("u2", "B")]),
            )],
        );
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate webserviceFieldName")));
    }

    #[test]
    fn duplicate_field_name_in_the_same_scope_is_flagged() {
        let root = sample_webservice(
            vec!["GET"],
            vec![(
                "webserviceField".into(),
                CoreValue::Array(vec![webservice_field("u1", "A"), webservice_field("u2", "A")]),
            )],
        );
        let diagnostics = DuplicateWebserviceFieldNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'A'"));
    }

    /// Real R26 shape (module doc): a lone `webserviceField` projects un-indexed
    /// (`webserviceFields.webserviceField`, not `[0]`) - `THHIT_PersonUpdate_ws`'s real shape, must
    /// not falsely flag as a duplicate of itself.
    #[test]
    fn single_unindexed_field_is_not_a_false_duplicate() {
        let root = sample_webservice(vec!["PATCH"], vec![("webserviceField".into(), webservice_field("u1", "A"))]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate webserviceFieldName")));
    }

    /// Same field name reused under a *different* `webserviceFieldConsumer`'s own nested
    /// `webserviceFields` scope is normal (each consumer exposes its own field set) - mirrors
    /// `application_validators.rs`'s "same name in different groups" precedent.
    #[test]
    fn same_name_in_different_consumer_scopes_is_not_a_duplicate() {
        let consumer_a = CoreValue::Object(vec![
            ("name".into(), text("cu1")),
            ("consumer".into(), text("ConsumerA")),
            ("webserviceFields".into(), CoreValue::Object(vec![("webserviceField".into(), webservice_field("u1", "NAME"))])),
        ]);
        let consumer_b = CoreValue::Object(vec![
            ("name".into(), text("cu2")),
            ("consumer".into(), text("ConsumerB")),
            ("webserviceFields".into(), CoreValue::Object(vec![("webserviceField".into(), webservice_field("u2", "NAME"))])),
        ]);
        let root = sample_webservice(
            vec!["GET"],
            vec![("webserviceFieldConsumer".into(), CoreValue::Array(vec![consumer_a, consumer_b]))],
        );
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate webserviceFieldName")));
    }

    #[test]
    fn missing_fields_are_silent_not_a_panic() {
        let root = CoreValue::Object(vec![("name".into(), text("Sample_ws"))]);
        assert!(diagnostics_for(&root).is_empty());
    }
}
