//! `language` validator registrations (P4, fourth editor family: `LanguageEditor`).
//! Mirrors `alias_validators.rs`'s shape on purpose (`flatten` -> registry -> `Vec<Diagnostic>`)
//! so `validator_table.rs`'s `object_type`-indexed `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat
//! `language` identically to the other object types: one `pub fn diagnostics_for(&CoreValue) ->
//! Vec<Diagnostic>` entry point.
//!
//! **Ablageformat (Rechercheergebnis, gegen den echten Hermes-Korpus verifiziert, siehe
//! `p4-editor-language-translation-notes.md` §1 für die volle Herleitung):** ADITO speichert
//! Übersetzungen als eigener Objekttyp `language` (ein `.aod` pro Sprache unter
//! `language/_____LANGUAGE_<code>/`), NICHT als Inline-Attribute an anderen Objekten. Jede
//! `.aod`-Datei trägt `<language>`/`<country>`/`<variant>` (ISO-Felder) plus ein flaches
//! `<keyValueMap>` aus `<stringEntry><name>.../<value>...</stringEntry>` Paaren. Der damals offene
//! Punkt aus `aod-format.md` §5 ("Übersetzungs-Resolution-Mechanismus ... ungeklärt") ist jetzt
//! geklärt: `stringEntry.name` ist NICHT ein abstrakter Schlüssel, sondern der wörtliche
//! Quelltext-String selbst (verifiziert: `_____LANGUAGE_en.aod`'s `keyValueMap` ist eine
//! Identitätsabbildung, `<name>Vacation</name>` -> `<value>Vacation</value>`; die anderen
//! Sprachdateien liefern denselben Schlüssel `Vacation` mit der jeweiligen Übersetzung, z.B.
//! `Urlaub`/`Vacaciones`/`Vakantie`; die JDito-Laufzeit-API im Korpus bestätigt das exakt -
//! `translate.text("Vacation")`/`translate.withArguments("...", [...])` nehmen überall den
//! wörtlichen Quelltext als Argument entgegen, nicht einen separaten Schlüssel). Fehlt ein Key in
//! einer Sprachdatei, fällt die Anzeige vermutlich auf den Quelltext selbst zurück (`es`/`nl`/`pl`
//! sind im echten Korpus bewusst sehr sparsam befüllt, nicht vollständig) - reine Laufzeit-Semantik,
//! aus dem `.aod`-Format selbst nicht weiter verifizierbar, aber für den Editor nicht
//! entscheidungsrelevant (dieser bearbeitet die vorhandenen Einträge, unabhängig vom
//! Fallback-Verhalten).
//!
//! **Zweite, abweichende Form im selben `language`-Ordner** (wie schon bei `aliasDefinition`, P4
//! dritte Familie, ein zweites Mal beobachtet): `_____LANGUAGE_EXTRA` trägt gar kein
//! `<keyValueMap>` und keine `<language>`/`<country>`/`<variant>`-Felder, sondern `<font>` plus
//! `<sqlModels><languageSql>` - SQL-Statements, die übersetzbare Strings direkt aus DB-Tabellen
//! ziehen (harvesting, nicht statische Paare). Beide Validatoren unten sind bewusst so geschrieben,
//! dass sie für diese Form einfach nichts finden (kein Panic, keine falschen Diagnosen) - identisch
//! zu `alias_validators.rs`'s Umgang mit dem Non-DB-Alias-Zweig.
//!
//! Beide Regeln sind bewusst auf den Baum der offenen Datei beschränkt (kein projektweiter Index -
//! gleiches, bereits dreifach dokumentiertes Precedent aus `p4-editor-view-context-dashboard-notes.md`
//! §4 und `p4-editor-alias-db-notes.md` §3).

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), ObjectType::Language, &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: two `stringEntry`s in the same `keyValueMap` sharing a `name` (the literal
/// source-language string that `translate.text(...)`/Designer resolution matches against, see
/// module doc) is a genuine authoring mistake - whichever entry the runtime picks, the other
/// translation silently becomes unreachable. Verified against the real, uncorrupted
/// `_____LANGUAGE_de`/`_____LANGUAGE_en` fixtures first (zero duplicates in either), so this rule
/// does not fire on legitimate, untouched project files.
pub struct DuplicateTranslationKeyValidator;

impl Validator for DuplicateTranslationKeyValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<String, String> = HashMap::new(); // key text -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_string_entry_name_path(&node.path) {
                continue;
            }
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            if let Some(first_path) = seen.get(&name) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate translation key '{name}' (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(name, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Real rule #2: a `stringEntry` whose `value` is an empty string is a declared-but-blank
/// translation - distinct from a key simply being absent from a sparse language file (the normal,
/// legitimate "not yet translated" case observed throughout `es`/`nl`/`pl` in the real corpus,
/// where missing keys are omitted entirely, never present with empty content). An explicit empty
/// `<value></value>` is the one shape that cannot be "just not translated yet" - the entry was
/// authored and left blank, so a lookup for that key returns an empty string instead of falling
/// back to the source text. Verified against the real, uncorrupted `_____LANGUAGE_de`/
/// `_____LANGUAGE_en` fixtures first (zero occurrences in either), so this rule does not fire on
/// legitimate, untouched project files either.
pub struct EmptyTranslationValueValidator;

impl Validator for EmptyTranslationValueValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut diagnostics = Vec::new();
        for node in &project.nodes {
            if !is_string_entry_value_path(&node.path) {
                continue;
            }
            if let PluginValue::String(s) = &node.value {
                if s.is_empty() {
                    diagnostics.push(Diagnostic::warning(
                        "translation value is empty - the key was declared but left blank, it will not fall back to the source text",
                        node.path.clone(),
                    ));
                }
            }
        }
        diagnostics
    }
}

/// Matches both the indexed form (`keyValueMap.stringEntry[3].name`, 2+ entries - `aod::tree`'s
/// `aod_io_adapter::group_children` only wraps same-tag siblings into an `Array` when there is
/// more than one occurrence) and the un-indexed form (`keyValueMap.stringEntry.name`, exactly one
/// entry - the common real-world shape for a sparsely-translated language file, e.g. the real
/// `_____LANGUAGE_pl` fixture's single `stringEntry`). A plain substring check on the distinctive
/// tag name `stringEntry` covers both without needing to special-case the array/non-array split.
fn is_string_entry_name_path(path: &str) -> bool {
    path.contains("stringEntry") && path.ends_with(".name")
}

fn is_string_entry_value_path(path: &str) -> bool {
    path.contains("stringEntry") && path.ends_with(".value")
}

/// The `object_type`-indexed dispatch entry point for `language` diagnostics
/// (`validator_table.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(DuplicateTranslationKeyValidator));
    registry.register_validator(Box::new(EmptyTranslationValueValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn string_entry(name: &str, value: &str) -> CoreValue {
        CoreValue::Object(vec![("name".into(), text(name)), ("value".into(), text(value))])
    }

    fn sample_language(entries: Vec<CoreValue>) -> CoreValue {
        CoreValue::Object(vec![
            ("language".into(), text("de")),
            (
                "keyValueMap".into(),
                CoreValue::Object(vec![("stringEntry".into(), CoreValue::Array(entries))]),
            ),
        ])
    }

    #[test]
    fn distinct_keys_are_silent() {
        let root = sample_language(vec![string_entry("Vacation", "Urlaub"), string_entry("Added", "Hinzugefügt")]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate translation key")));
    }

    #[test]
    fn duplicate_key_is_flagged() {
        let root = sample_language(vec![string_entry("Vacation", "Urlaub"), string_entry("Vacation", "Ferien")]);
        let diagnostics = DuplicateTranslationKeyValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'Vacation'"));
        assert_eq!(diagnostics[0].path.as_deref(), Some("keyValueMap.stringEntry[1].name"));
    }

    #[test]
    fn empty_value_is_flagged() {
        let root = sample_language(vec![string_entry("Vacation", "")]);
        let diagnostics = EmptyTranslationValueValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("keyValueMap.stringEntry[0].value"));
    }

    #[test]
    fn non_empty_value_is_silent() {
        let root = sample_language(vec![string_entry("Vacation", "Urlaub")]);
        assert!(EmptyTranslationValueValidator.validate(&flatten(&root)).is_empty());
    }

    #[test]
    fn single_entry_language_file_uses_the_unindexed_path_shape_and_is_still_checked() {
        // aod::tree's real projector (aod_io_adapter::group_children) only wraps same-tag
        // siblings into an Array when there is more than one occurrence - a language file with
        // exactly one stringEntry (the real `_____LANGUAGE_pl` fixture's shape) projects
        // `keyValueMap.stringEntry` as a plain Object, not `keyValueMap.stringEntry[0]`. Build
        // that shape directly (not via `sample_language`'s always-Array helper) to prove the
        // un-indexed path form is still recognised by both validators.
        let root = CoreValue::Object(vec![(
            "keyValueMap".into(),
            CoreValue::Object(vec![("stringEntry".into(), string_entry("OutOfOffice", ""))]),
        )]);
        let diagnostics = diagnostics_for(&root);
        assert!(diagnostics.iter().any(|d| d.message.contains("translation value is empty")));
        assert_eq!(diagnostics[0].path.as_deref(), Some("keyValueMap.stringEntry.value"));
    }

    #[test]
    fn missing_key_value_map_is_silent_not_a_panic() {
        // The `_____LANGUAGE_EXTRA` shape: no keyValueMap at all (sqlModels/languageSql instead).
        let root = CoreValue::Object(vec![("name".into(), text("_____LANGUAGE_EXTRA"))]);
        assert!(diagnostics_for(&root).is_empty());
    }
}
