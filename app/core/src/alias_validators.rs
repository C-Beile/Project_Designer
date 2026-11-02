//! `aliasDefinition` validator registrations (P4, third editor family: `AliasDbEditor`).
//! Mirrors `entity_validators.rs`/`view_context_dashboard_validators.rs`'s shape on purpose
//! (`flatten` -> registry -> `Vec<Diagnostic>`) so `project_actor.rs`'s `object_type`-indexed
//! `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat `aliasDefinition` identically to the other
//! object types: one `pub fn diagnostics_for(&CoreValue) -> Vec<Diagnostic>` entry point.
//!
//! `aod-format.md` §3/`aliasDefinition.schema.json` document two shapes under the one
//! `aliasDefinition` folder: a relational DB alias (`aliasDefinitionSub.aliasDefDb` present, e.g.
//! `THHIT_Data_alias`) and other alias kinds (IndexSearch, mail, ...) that carry only
//! `name`/`title`/`datasourceType` with no `aliasDefinitionSub` at all (verified against Hermes'
//! `IndexSearch`/`mailServerHermes` fixtures during the P4 prerequisite reading - not opened as
//! test fixtures here, out of this round's MUST scope per the role brief, but the absence must not
//! make either validator below panic or misfire: both are written to simply find nothing and
//! return no diagnostics for that shape).
//!
//! Both rules are deliberately scoped to a single open file's own tree, matching the "no
//! project-wide index yet" precedent the two prior families already documented (see
//! `p4-editor-view-context-dashboard-notes.md` §4) - no check against `entity.recordContainers.
//! dbRecordContainer.alias` (a different open file) is attempted here.

use core_model::value::PropertyValue as CoreValue;
use plugin_kernel::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_kernel::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &core_model::path::NodePath::root(), ObjectType::Alias, &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: `aliasDefDb.targetAliasName` is the value every `entity.recordContainers.
/// dbRecordContainer.alias` in the project actually resolves against (aod-format.md §4's
/// `dbRecordContainer.alias` row: "the reference target is the alias's targetAliasName value, not
/// its ADITO object name") - an empty `targetAliasName` on a DB alias silently breaks every entity
/// that references it, a genuine authoring mistake worth a hard error, not a placeholder rule.
pub struct EmptyTargetAliasNameValidator;

impl Validator for EmptyTargetAliasNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_kernel::types::PropertyValue as PluginValue;

        let Some(node) = project
            .nodes
            .iter()
            .find(|n| n.path == "aliasDefinitionSub.aliasDefDb.targetAliasName")
        else {
            return Vec::new();
        };
        match &node.value {
            PluginValue::String(s) if s.trim().is_empty() => vec![Diagnostic::error(
                "targetAliasName is empty - every entity recordContainer referencing this alias would resolve to nothing",
                node.path.clone(),
            )],
            _ => Vec::new(),
        }
    }
}

/// Real rule #2: two `entityFieldDb`s in the *same* `entityDb` (DB table) sharing a `name`
/// (physical column name) is a genuine model-corruption bug - both Designer field entries would
/// map to the same DB column, and the Liquibase-derived column metadata (size/type/notNull/...)
/// for one of them becomes silently unreachable. Scoped per-table (not globally across the whole
/// alias file) since two *different* tables legitimately sharing a column name, e.g. `ID`, is
/// completely normal and not a mistake - matches `DuplicateEntityFieldNameValidator`'s "genuine,
/// sharp-edged mistake" bar from `entity_validators.rs`.
pub struct DuplicateColumnNameValidator;

impl Validator for DuplicateColumnNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_kernel::types::PropertyValue as PluginValue;

        let mut seen: HashMap<(usize, String), String> = HashMap::new(); // (table index, column name) -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_entity_field_db_name_path(&node.path) {
                continue;
            }
            let Some(table_index) = entity_db_index(&node.path) else { continue };
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            let key = (table_index, name.clone());
            if let Some(first_path) = seen.get(&key) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate column name '{name}' in the same DB table (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(key, node.path.clone());
            }
        }
        diagnostics
    }
}

fn is_entity_field_db_name_path(path: &str) -> bool {
    path.contains("entityFields.entityFieldDb[") && path.ends_with(".name")
}

/// Extracts `<N>` from a `...entityDb[<N>]...` path prefix (the table this column path sits
/// under). `entityFieldDb[` never collides with the `entityDb[` marker itself (different
/// substrings - "entityFieldDb[" does not contain "entityDb[").
fn entity_db_index(path: &str) -> Option<usize> {
    let marker = "entityDb[";
    let start = path.find(marker)? + marker.len();
    let rest = &path[start..];
    let end = rest.find(']')?;
    rest[..end].parse().ok()
}

/// The `object_type`-indexed dispatch entry point for `aliasDefinition` diagnostics
/// (`project_actor.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = forge_core::build_plugin_registry();
    registry.register_validator(Box::new(EmptyTargetAliasNameValidator));
    registry.register_validator(Box::new(DuplicateColumnNameValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn field_db(name: &str) -> CoreValue {
        CoreValue::Object(vec![("name".into(), text(name)), ("dbName".into(), text(""))])
    }

    fn entity_db(table_name: &str, column_names: &[&str]) -> CoreValue {
        let fields: Vec<CoreValue> = column_names.iter().map(|n| field_db(n)).collect();
        CoreValue::Object(vec![
            ("name".into(), text(table_name)),
            (
                "entityFields".into(),
                CoreValue::Object(vec![("entityFieldDb".into(), CoreValue::Array(fields))]),
            ),
        ])
    }

    fn sample_alias(target_alias_name: &str, tables: Vec<CoreValue>) -> CoreValue {
        CoreValue::Object(vec![(
            "aliasDefinitionSub".into(),
            CoreValue::Object(vec![(
                "aliasDefDb".into(),
                CoreValue::Object(vec![
                    ("targetAliasName".into(), text(target_alias_name)),
                    (
                        "entityGroup".into(),
                        CoreValue::Object(vec![(
                            "entities".into(),
                            CoreValue::Object(vec![("entityDb".into(), CoreValue::Array(tables))]),
                        )]),
                    ),
                ]),
            )]),
        )])
    }

    #[test]
    fn non_empty_target_alias_name_is_silent() {
        let root = sample_alias("Data_alias", vec![entity_db("T1", &["ID"])]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("targetAliasName")));
    }

    #[test]
    fn empty_target_alias_name_is_flagged() {
        let root = sample_alias("", vec![entity_db("T1", &["ID"])]);
        let diagnostics = EmptyTargetAliasNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("aliasDefinitionSub.aliasDefDb.targetAliasName"));
    }

    #[test]
    fn absent_alias_def_db_is_silent_not_a_panic() {
        // Non-DB alias kind (IndexSearch/mailServerHermes shape): no aliasDefinitionSub at all.
        let root = CoreValue::Object(vec![("name".into(), text("IndexSearch")), ("datasourceType".into(), text("18"))]);
        assert!(diagnostics_for(&root).is_empty());
    }

    #[test]
    fn distinct_column_names_within_a_table_are_silent() {
        let root = sample_alias("Data_alias", vec![entity_db("T1", &["ID", "NAME"])]);
        assert!(DuplicateColumnNameValidator.validate(&flatten(&root)).is_empty());
    }

    #[test]
    fn duplicate_column_name_within_the_same_table_is_flagged() {
        let root = sample_alias("Data_alias", vec![entity_db("T1", &["ID", "NAME", "ID"])]);
        let diagnostics = DuplicateColumnNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'ID'"));
        assert_eq!(
            diagnostics[0].path.as_deref(),
            Some("aliasDefinitionSub.aliasDefDb.entityGroup.entities.entityDb[0].entityFields.entityFieldDb[2].name")
        );
    }

    #[test]
    fn same_column_name_across_different_tables_is_not_a_duplicate() {
        let root = sample_alias("Data_alias", vec![entity_db("T1", &["ID"]), entity_db("T2", &["ID"])]);
        assert!(DuplicateColumnNameValidator.validate(&flatten(&root)).is_empty());
    }
}
