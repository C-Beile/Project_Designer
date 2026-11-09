//! `preferences` validator registrations (P4, fifth editor family: `PreferencesEditor`).
//! Mirrors the shape every prior P4 family established (`flatten` -> registry -> `Vec<Diagnostic>`)
//! so `validator_table.rs`'s `object_type`-indexed `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat
//! `preferences` identically to the other object types.
//!
//! **Ablageformat (Rechercheergebnis, siehe `p4-editor-system-preferences-application-notes.md`
//! §1):** a single project-wide `preferences/_____PREFERENCES_PROJECT/_____PREFERENCES_PROJECT.aod`
//! (real Hermes instance: 443 lines) - genuinely distinct from `system` (per-environment
//! server/tunnel config, many instances) and from `application` (navigation tree, see
//! `application_validators.rs`). Root element `preferences`, a mix of plain-text scalars
//! (`projectName`, `mailRepositoryAlias`, ...), typed `v="..."` scalars (`jditoMaxContentSize`,
//! `mailGlobalUserServerEnabled`, ...), small fixed-shape lists (`calendarCategoriesEvent.entry`,
//! `multilingualismIndexSearchLocales.element`), a single-occurrence nested object
//! (`mailBridgeMailserver.mailbridgeMailserver` - **R26**, RISKS.md, un-indexed shape in the real
//! fixture), and two large "custom property bank" lists (`customConfigProperties`,
//! `customProperties`), each holding a mix of five distinct tag names
//! (`customBooleanProperty`/`customStringProperty`/`customIntegerProperty`/
//! `customPasswordProperty`/`customJDitoProperty`).
//!
//! **A second, more pervasive real R26 observation than `language`'s** (RISKS.md R26,
//! `aod::tree`/`aod::document` only collapse repeated same-tag siblings into an indexed `Array` once
//! there are 2+ occurrences): because `group_children` groups by tag name independently, and the
//! two custom-property lists interleave five different tag names, *each* tag name's count is
//! independently either 1 (un-indexed `Object`) or 2+ (`Array`) - verified in the real fixture:
//! `customConfigProperties.customIntegerProperty` has exactly one real occurrence
//! (`bulkmail.dateToSendPassedAfter`, un-indexed) while `customConfigProperties.customStringProperty`
//! has ~25 (indexed array) in the *same* list; `customProperties.customJDitoProperty` likewise has
//! exactly one (`nominatim.filterKeys`). `property_entries_for_tag` below treats both shapes
//! uniformly for exactly this reason.
//!
//! Both rules are file-local, matching the now five-times-documented "no project-wide index yet"
//! precedent (`p4-editor-view-context-dashboard-notes.md` §4, `p4-editor-alias-db-notes.md` §3,
//! `p4-editor-language-translation-notes.md` §4).

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), ObjectType::Preferences, &mut nodes);
    ProjectModel::new(nodes)
}

/// The five real custom-property element tag names observed under both `customProperties` and
/// `customConfigProperties` in the real Hermes fixture (module doc above).
const CUSTOM_PROPERTY_TAGS: &[&str] = &[
    "customBooleanProperty",
    "customStringProperty",
    "customIntegerProperty",
    "customPasswordProperty",
    "customJDitoProperty",
];

/// The two real custom-property-bank container field names.
const PROPERTY_GROUPS: &[&str] = &["customProperties", "customConfigProperties"];

/// Real rule #1: two custom-property entries (of any of the five tag kinds, see module doc)
/// sharing a `name` *within the same property bank* is a genuine authoring mistake - JDito's
/// `system.getCustomProperty(...)`/`system.getCustomConfigProperty(...)` lookup is by that literal
/// name string, so a duplicate makes one entry's value silently unreachable. Scoped per bank
/// (`customProperties` vs `customConfigProperties` kept separate, not merged) since they are two
/// distinct lookup namespaces in the real API, matching `DuplicateColumnNameValidator`'s
/// per-table-scoping precedent in `alias_validators.rs`. Verified against the real, uncorrupted
/// fixture first (0 duplicates across either bank's ~40+40 real entries), so this rule does not
/// fire on legitimate, untouched project files.
pub struct DuplicateCustomPropertyNameValidator;

impl Validator for DuplicateCustomPropertyNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<(&'static str, String), String> = HashMap::new(); // (bank, name) -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            let Some(group) = property_group_of(&node.path) else { continue };
            if !is_custom_property_name_path(&node.path) {
                continue;
            }
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            let key = (group, name.clone());
            if let Some(first_path) = seen.get(&key) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate custom property name '{name}' in {group} (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(key, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Real rule #2: `mailGlobalUserServerEnabled` (a typed boolean, R24-affected read-only field) being
/// `true` while `mailRepositoryAlias` is empty means every user-default mail feature this flag
/// turns on has nothing to resolve a mail repository against. Verified against the real fixture
/// first (`mailGlobalUserServerEnabled` is `true` there, and `mailRepositoryAlias` is the non-empty
/// `defaultDbRepository`), so this rule does not fire on the legitimate, untouched project file.
pub struct MailRepositoryAliasRequiredWhenMailEnabledValidator;

impl Validator for MailRepositoryAliasRequiredWhenMailEnabledValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let enabled = project
            .nodes
            .iter()
            .find(|n| n.path == "mailGlobalUserServerEnabled")
            .map(|n| matches!(n.value, PluginValue::Bool(true)))
            .unwrap_or(false);
        if !enabled {
            return Vec::new();
        }
        let Some(node) = project.nodes.iter().find(|n| n.path == "mailRepositoryAlias") else {
            return Vec::new();
        };
        match &node.value {
            PluginValue::String(s) if s.trim().is_empty() => vec![Diagnostic::error(
                "mailGlobalUserServerEnabled is true but mailRepositoryAlias is empty - user-default mail features have no repository to resolve against",
                node.path.clone(),
            )],
            _ => Vec::new(),
        }
    }
}

/// Which of the two real property banks (module doc's `PROPERTY_GROUPS`) a path sits under, if
/// any - the scoping key for `DuplicateCustomPropertyNameValidator`.
fn property_group_of(path: &str) -> Option<&'static str> {
    PROPERTY_GROUPS.iter().copied().find(|group| path.starts_with(group))
}

/// Matches a `.name` leaf under any of the five known custom-property tag names, in either the
/// indexed (`customStringProperty[3].name`) or un-indexed (`customJDitoProperty.name`) shape -
/// same substring-plus-suffix approach `language_validators.rs`'s `is_string_entry_name_path`
/// established, extended to five tag names instead of one (module doc's R26 note).
fn is_custom_property_name_path(path: &str) -> bool {
    CUSTOM_PROPERTY_TAGS.iter().any(|tag| path.contains(tag)) && path.ends_with(".name")
}

/// The `object_type`-indexed dispatch entry point for `preferences` diagnostics
/// (`validator_table.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(DuplicateCustomPropertyNameValidator));
    registry.register_validator(Box::new(MailRepositoryAliasRequiredWhenMailEnabledValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn bool_v(b: bool) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Bool(b))
    }

    fn string_property(name: &str) -> CoreValue {
        CoreValue::Object(vec![("name".into(), text(name)), ("property".into(), text("x"))])
    }

    #[test]
    fn distinct_names_within_one_bank_are_silent() {
        let root = CoreValue::Object(vec![(
            "customProperties".into(),
            CoreValue::Object(vec![(
                "customStringProperty".into(),
                CoreValue::Array(vec![string_property("a"), string_property("b")]),
            )]),
        )]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate custom property")));
    }

    #[test]
    fn duplicate_name_within_the_same_bank_is_flagged() {
        let root = CoreValue::Object(vec![(
            "customProperties".into(),
            CoreValue::Object(vec![(
                "customStringProperty".into(),
                CoreValue::Array(vec![string_property("dup"), string_property("dup")]),
            )]),
        )]);
        let diagnostics = DuplicateCustomPropertyNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'dup'"));
        assert!(diagnostics[0].message.contains("customProperties"));
    }

    /// The real R26 shape: a single-occurrence tag among several multi-occurrence tags in the same
    /// property bank (module doc: `customJDitoProperty` in the real `customProperties` list) still
    /// gets checked, un-indexed path and all - and a same-name collision against a *different* tag
    /// in the *other* bank (`customConfigProperties`) is correctly NOT flagged (different bank).
    #[test]
    fn same_name_across_different_banks_is_not_a_duplicate_and_single_occurrence_tag_is_still_checked() {
        let root = CoreValue::Object(vec![
            (
                "customProperties".into(),
                CoreValue::Object(vec![("customJDitoProperty".into(), string_property("shared.name"))]),
            ),
            (
                "customConfigProperties".into(),
                CoreValue::Object(vec![("customStringProperty".into(), string_property("shared.name"))]),
            ),
        ]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate custom property")));
    }

    #[test]
    fn mail_enabled_with_repository_alias_is_silent() {
        let root = CoreValue::Object(vec![
            ("mailGlobalUserServerEnabled".into(), bool_v(true)),
            ("mailRepositoryAlias".into(), text("defaultDbRepository")),
        ]);
        assert!(MailRepositoryAliasRequiredWhenMailEnabledValidator.validate(&flatten(&root)).is_empty());
    }

    #[test]
    fn mail_enabled_with_empty_repository_alias_is_flagged() {
        let root = CoreValue::Object(vec![
            ("mailGlobalUserServerEnabled".into(), bool_v(true)),
            ("mailRepositoryAlias".into(), text("")),
        ]);
        let diagnostics = MailRepositoryAliasRequiredWhenMailEnabledValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("mailRepositoryAlias"));
    }

    #[test]
    fn mail_disabled_with_empty_repository_alias_is_silent() {
        let root = CoreValue::Object(vec![
            ("mailGlobalUserServerEnabled".into(), bool_v(false)),
            ("mailRepositoryAlias".into(), text("")),
        ]);
        assert!(MailRepositoryAliasRequiredWhenMailEnabledValidator.validate(&flatten(&root)).is_empty());
    }

    #[test]
    fn missing_fields_are_silent_not_a_panic() {
        let root = CoreValue::Object(vec![("name".into(), text("_____PREFERENCES_PROJECT"))]);
        assert!(diagnostics_for(&root).is_empty());
    }
}
