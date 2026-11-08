//! Entity-specific `Validator` registrations (Ziel B.4). Registered in this app crate, not in
//! `plugin-api` itself - exactly the extension point architecture.md §2/§6 describes ("jeder
//! Objekttyp kann weitere [Validatoren] andocken, ohne den Kern zu ändern"). Operates against
//! `plugin_api::types::ProjectModel`, the deliberately independent placeholder type the
//! `Validator` trait is expressed against (see that crate's module doc) - `flatten_entity` below
//! is the bridge from a real, loaded entity's `aod::tree::PropertyValue` tree into that flat
//! node list, built with `designer_core::to_plugin_property_node` for each node.

use aod::tree::path::NodePath;
use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

/// Walks a fully-loaded entity's value tree (as returned by `ProjectHandle::value_at(&NodePath::root())`)
/// into the flat `PropertyNode` list `Validator::validate` expects. Every node (scalar and
/// structural) is included, mirroring `to_plugin_property_node`'s own behaviour for `Object`/
/// `Array` values (they become `PropertyValue::Missing` - "not a plain scalar", not an error).
pub fn flatten_entity(root: &CoreValue) -> ProjectModel {
    let mut nodes = Vec::new();
    flatten_into(root, &NodePath::root(), &mut nodes);
    ProjectModel::new(nodes)
}

fn flatten_into(value: &CoreValue, path: &NodePath, out: &mut Vec<PropertyNode>) {
    flatten_into_with_type(value, path, ObjectType::Entity, out);
}

/// Object-type-generic version of `flatten_into`, shared with
/// `view_context_dashboard_validators.rs` (P4's second editor family) so every object type tags
/// its `PropertyNode`s with its own real `ObjectType` instead of a hardcoded `Entity` - the walk
/// itself has no entity-specific logic, only the tag differs per caller.
pub fn flatten_into_with_type(
    value: &CoreValue,
    path: &NodePath,
    object_type: ObjectType,
    out: &mut Vec<PropertyNode>,
) {
    out.push(designer_core::to_plugin_property_node(path, object_type.clone(), value));
    match value {
        CoreValue::Object(fields) => {
            for (key, child) in fields {
                flatten_into_with_type(child, &path.field(key), object_type.clone(), out);
            }
        }
        CoreValue::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                flatten_into_with_type(child, &path.index(i), object_type.clone(), out);
            }
        }
        CoreValue::Scalar(_) => {}
    }
}

/// The `object_type`-indexed dispatch entry point for entity diagnostics (`project_actor.rs`'s
/// `VALIDATORS_BY_OBJECT_TYPE` table) - owns which validators apply to `entity` objects, mirroring
/// `view_diagnostics_for`/`context_diagnostics_for`/`dashboard_diagnostics_for`'s shape in
/// `view_context_dashboard_validators.rs`.
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten_entity(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(DuplicateEntityFieldNameValidator));
    registry.register_validator(Box::new(MissingFieldTitleValidator));
    registry.validate_project(&model)
}

/// Real rule #1: two `entityField`s with the same `name` silently shadow each other at runtime
/// (the second one wins on the record container mapping, the first becomes dead UI) - this is a
/// genuine, sharp-edged ADITO authoring mistake, not a placeholder rule. Matches on the path
/// shape `entityFields.entityField[<N>].name` produced by `entity.schema.json`'s `entityField`
/// array.
pub struct DuplicateEntityFieldNameValidator;

impl Validator for DuplicateEntityFieldNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<String, String> = HashMap::new(); // field name -> first path that used it
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_entity_field_name_path(&node.path) {
                continue;
            }
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            if let Some(first_path) = seen.get(&name) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate entityField name '{name}' (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(name, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Real rule #2: an `entityField` without a `title` renders with a blank column/label header in
/// the client - legal per the schema (`title` is optional), but almost always an authoring
/// oversight worth flagging as a warning rather than a hard error.
pub struct MissingFieldTitleValidator;

impl Validator for MissingFieldTitleValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut diagnostics = Vec::new();
        for node in &project.nodes {
            if !is_entity_field_container_path(&node.path) {
                continue;
            }
            let has_title = project.nodes.iter().any(|n| {
                n.path == format!("{}.title", node.path)
                    && matches!(&n.value, PluginValue::String(s) if !s.is_empty())
            });
            if !has_title {
                diagnostics.push(Diagnostic::warning(
                    "entityField has no title - renders with a blank label in the client",
                    node.path.clone(),
                ));
            }
        }
        diagnostics
    }
}

fn is_entity_field_name_path(path: &str) -> bool {
    path.contains("entityFields.entityField[") && path.ends_with(".name")
}

/// The `entityField[<N>]` container path itself (one level up from `.name`), used to look up a
/// sibling `.title` field.
fn is_entity_field_container_path(path: &str) -> bool {
    path.contains("entityFields.entityField[")
        && path
            .rsplit('.')
            .next()
            .map(|last| last.starts_with("entityField[") && last.ends_with(']'))
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn sample_entity_fields(names: &[(&str, Option<&str>)]) -> CoreValue {
        let entity_field_items: Vec<CoreValue> = names
            .iter()
            .map(|(name, title)| {
                let mut fields = vec![("name".to_string(), text(name))];
                if let Some(t) = title {
                    fields.push(("title".to_string(), text(t)));
                }
                CoreValue::Object(fields)
            })
            .collect();

        CoreValue::Object(vec![(
            "entityFields".to_string(),
            CoreValue::Object(vec![("entityField".to_string(), CoreValue::Array(entity_field_items))]),
        )])
    }

    #[test]
    fn flatten_produces_the_expected_dotted_indexed_paths() {
        let root = sample_entity_fields(&[("NAME", Some("Name"))]);
        let model = flatten_entity(&root);
        assert!(model
            .nodes
            .iter()
            .any(|n| n.path == "entityFields.entityField[0].name"));
    }

    #[test]
    fn duplicate_field_names_are_flagged_but_unique_ones_are_not() {
        let root = sample_entity_fields(&[("NAME", Some("Name")), ("EMAIL", Some("Email")), ("NAME", Some("Name (dup)"))]);
        let model = flatten_entity(&root);

        let diagnostics = DuplicateEntityFieldNameValidator.validate(&model);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("NAME"));
        assert_eq!(diagnostics[0].path.as_deref(), Some("entityFields.entityField[2].name"));
    }

    #[test]
    fn field_without_title_is_a_warning_field_with_title_is_silent() {
        let root = sample_entity_fields(&[("NAME", Some("Name")), ("EMAIL", None)]);
        let model = flatten_entity(&root);

        let diagnostics = MissingFieldTitleValidator.validate(&model);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("entityFields.entityField[1]"));
    }
}
