//! `report` validator registrations (P4, seventh editor family: `ReportEditor`).
//! Mirrors every prior P4 family's shape (`flatten` -> registry -> `Vec<Diagnostic>`) so
//! `project_actor.rs`'s `object_type`-indexed `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat
//! `report` identically to the other object types.
//!
//! **Ablageformat (own mini format analysis, this agent, verified against the real corpus - no
//! P1 schema existed for this family, feature-matrix.md's own `ReportEditor` row already flagged
//! this as "unklar, im Original zu verifizieren", see `p4-editor-report-notes.md` §1 for the full
//! writeup):** the real object folder is `report` (the naively-guessed name turned out correct
//! this time, unlike `webservice` -> `entityWebservice` - verified by directory search across the
//! whole ten-project corpus: `report/` exists top-level in BHB, Hermes, and
//! `Car_Training/clemens-onboarding-main`, nowhere else). One `report/<Name>_report/
//! <Name>_report.aod` per instance (all 11 real instances found use the `_report` suffix, no
//! exceptions observed, unlike `entityWebservice`'s varying `_ws`/`_webservice` suffix). Root
//! element `report`, VERSION `1.3.0`.
//!
//! Real fields, verified across all 11 real instances in the corpus (BHB: 8, Hermes: 2,
//! Car_Training: 1): `name`/`majorModelMode` (plain text, identity/constant, same shape every
//! prior family's root), `title` (display name, present in 9/11, missing on the two Hermes
//! instances), `description`/`comment` (optional plain text, sometimes present-but-empty, e.g.
//! `Organisation_report`'s `<description></description>`), `alias` (an optional reference to a
//! `aliasDefinition` name, e.g. `Data_alias` - present in 5/11, absent on the rest),
//! `reportData` (a `%aditoprj%`-relative path to the report's own `.jrxml` design source -
//! **always present** in every real instance, never empty), `reportType` (a fixed-vocabulary
//! token, always `JASPER` in every real instance - JasperReports is the only report engine this
//! corpus's Designer version supports), `subReports.subreport` (an optional list of
//! `{name, reportData}` pairs referencing further `.jrxml` files - 0 to 4 observed), `images.
//! image` (an optional list of `{name, fileName, imageData}` triples referencing `.png` files
//! carried alongside the `.aod` - 0 to 3 observed), and `icon`/`iconInactive` (optional top-level
//! `%aditoprj%`-relative image paths, seen once on `Organisation_report`, always paired with a
//! same-named entry under `images`). **No `reportParameters`-shaped element was found in any real
//! instance** - the role brief's "Parameter soweit im Format vorhanden" MUST-subset item has
//! nothing to build against in this corpus; documented as a real gap, not invented.
//!
//! **R26 (RISKS.md) real instance found here, in two independent places:** `subReports.subreport`
//! (1 real subreport on `Salesorder_report`/`Expenses_report` = un-indexed Object, 4 on
//! `Organisation_report` = indexed Array) and `images.image` (1 real image on `Salesorder_report`/
//! `Reminder_report` = un-indexed Object, 3 on `Organisation_report` = indexed Array). Per RISKS.md
//! R26's now seven-times-documented precedent, handled locally in `flatten`/the two validators
//! below (Object-vs-Array treated uniformly), not by a `core-model`/`aod-io` change - no new schema
//! knowledge was gained this round that would make a safe generic fix possible, same reasoning
//! `p4-editor-webservice-notes.md` §3 already gave in detail (re-examined, no new angle found).
//!
//! **`.jrxml`/`.jasper` handling:** every `reportData`/`subreport.reportData`/`imageData` value is
//! a path string into a carried resource file (`.jrxml` - JasperReports XML design source, always
//! present; `.jasper` - a compiled Java-serialized binary, present alongside some but not all real
//! `.jrxml` files, e.g. `DSGVO_Disclosure_report`, absent on others, e.g. `Offer_report`'s
//! subreports). Neither is parsed or rendered by this editor - building a JasperReports design
//! surface would be its own large project, explicitly out of scope per the role brief. Both are
//! treated as unattached, unedited resources, the same "linked file carried but not touched"
//! precedent `architecture.md` §2 already sets for `LinkedFileCompiler`. `ReportEditor.tsx` shows
//! the `reportData`/`subreport`/`image` paths read-only, clearly labelled, never attempts to open
//! or write the `.jrxml`/`.jasper` bytes.

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    // No existing `ObjectType` variant fits a JasperReports report definition - `Other("report")`
    // is the documented escape hatch (`plugin-api/src/types.rs`'s own doc comment) for object
    // families not yet enumerated there, same choice `preferences`/`entityWebservice` made before
    // a dedicated variant existed for them.
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), ObjectType::Other("report".into()), &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: an empty `reportData` means the report object has no design source at all - it is
/// published in the tree but cannot render anything, a real deploy-time defect. Verified against
/// all 11 real instances in the corpus: `reportData` is never empty or absent, so this rule stays
/// silent on legitimate, untouched project files.
pub struct EmptyReportDataValidator;

impl Validator for EmptyReportDataValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let Some(node) = project.nodes.iter().find(|n| n.path == "reportData") else {
            // No `reportData` node at all is not this validator's concern - an object type this
            // rule is accidentally run against without that field stays silent rather than
            // guessing a path to attach a diagnostic to (mirrors `webservice_validators.rs`'s
            // `EmptyWebserviceMethodsValidator` guard).
            return Vec::new();
        };
        let is_empty = match &node.value {
            PluginValue::String(s) => s.trim().is_empty(),
            _ => false,
        };
        if is_empty {
            vec![Diagnostic::error(
                "reportData is empty - this report has no design source and cannot render",
                "reportData",
            )]
        } else {
            Vec::new()
        }
    }
}

/// Real rule #2: two `subreport`s sharing the same `name` in the same `subReports` list is a
/// genuine authoring mistake - JasperReports resolves subreport bindings by name, so a duplicate
/// makes at least one binding ambiguous. Verified silent against all real fixtures first (0
/// same-scope duplicates in the corpus). Handles both real R26 shapes uniformly - a single
/// un-indexed `subreport` (`Salesorder_report`/`Expenses_report`) and an indexed array
/// (`Organisation_report`'s 4 subreports).
pub struct DuplicateSubreportNameValidator;

impl Validator for DuplicateSubreportNameValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut seen: HashMap<String, String> = HashMap::new(); // name -> first path
        let mut diagnostics = Vec::new();

        for node in &project.nodes {
            if !is_subreport_name_path(&node.path) {
                continue;
            }
            let name = match &node.value {
                PluginValue::String(s) => s.clone(),
                _ => continue,
            };
            if name.trim().is_empty() {
                continue; // an empty subreport name is a different, not-yet-built rule's concern
            }
            if let Some(first_path) = seen.get(&name) {
                diagnostics.push(Diagnostic::error(
                    format!("duplicate subreport name '{name}' in subReports (first declared at {first_path})"),
                    node.path.clone(),
                ));
            } else {
                seen.insert(name, node.path.clone());
            }
        }
        diagnostics
    }
}

/// Matches a `.name` leaf directly under a `subreport` (indexed or un-indexed, R26) inside
/// `subReports`. Checks the exact parent tag rather than a prefix match, same discipline
/// `webservice_validators.rs::is_webservice_field_name_path` uses.
fn is_subreport_name_path(path: &str) -> bool {
    let Some(last) = path.rsplit('.').next() else { return false };
    if last != "name" {
        return false;
    }
    let mut segments = path.split('.');
    let mut prev = None;
    for seg in segments.by_ref() {
        if seg == last {
            break;
        }
        prev = Some(seg);
    }
    let Some(prev) = prev else { return false };
    if parent_tag(prev) != "subreport" {
        return false;
    }
    // Must sit directly under `subReports` (not some unrelated `subreport`-tagged element deeper
    // in the tree - there is none in the real format, but this keeps the check exact rather than
    // a loose suffix match).
    path.starts_with("subReports.subreport")
}

/// Strips a trailing `[N]` index suffix off one path segment, e.g. `"subreport[2]"` ->
/// `"subreport"`, `"subreport"` -> `"subreport"` (unchanged, the un-indexed R26 shape).
fn parent_tag(segment: &str) -> &str {
    segment.split('[').next().unwrap_or(segment)
}

/// The `object_type`-indexed dispatch entry point for `report` diagnostics
/// (`project_actor.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(EmptyReportDataValidator));
    registry.register_validator(Box::new(DuplicateSubreportNameValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn subreport(name: &str, report_data: &str) -> CoreValue {
        CoreValue::Object(vec![("name".into(), text(name)), ("reportData".into(), text(report_data))])
    }

    /// `subreports` becomes the real R26 shape automatically: one entry -> `Object` (un-indexed),
    /// 2+ -> `Array` (indexed), matching `subReports.subreport`'s real corpus shape.
    fn sample_report(report_data: &str, subreports: Vec<CoreValue>) -> CoreValue {
        let mut fields = vec![
            ("name".into(), text("Sample_report")),
            ("majorModelMode".into(), text("DISTRIBUTED")),
            ("reportData".into(), text(report_data)),
            ("reportType".into(), text("JASPER")),
        ];
        if !subreports.is_empty() {
            let subreport_value = match subreports.len() {
                1 => subreports.into_iter().next().unwrap(),
                _ => CoreValue::Array(subreports),
            };
            fields.push(("subReports".into(), CoreValue::Object(vec![("subreport".into(), subreport_value)])));
        }
        CoreValue::Object(fields)
    }

    #[test]
    fn non_empty_report_data_is_not_flagged() {
        let root = sample_report("%aditoprj%/report/Sample_report/reportData.jrxml", vec![]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("no design source")));
    }

    #[test]
    fn empty_report_data_is_flagged() {
        let root = sample_report("", vec![]);
        let diagnostics = EmptyReportDataValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("reportData"));
    }

    #[test]
    fn missing_report_data_node_is_silent_not_a_panic() {
        let root = CoreValue::Object(vec![("name".into(), text("Sample_report"))]);
        assert!(diagnostics_for(&root).is_empty());
    }

    #[test]
    fn distinct_subreport_names_are_silent() {
        let root = sample_report(
            "%aditoprj%/report/Sample_report/reportData.jrxml",
            vec![subreport("A", "a.jrxml"), subreport("B", "b.jrxml")],
        );
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate subreport name")));
    }

    #[test]
    fn duplicate_subreport_name_is_flagged() {
        let root = sample_report(
            "%aditoprj%/report/Sample_report/reportData.jrxml",
            vec![subreport("A", "a.jrxml"), subreport("A", "a2.jrxml")],
        );
        let diagnostics = DuplicateSubreportNameValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("'A'"));
    }

    /// Real R26 shape (module doc): a lone `subreport` projects un-indexed (`subReports.subreport`,
    /// not `[0]`) - `Salesorder_report`'s/`Expenses_report`'s real shape, must not falsely flag as
    /// a duplicate of itself.
    #[test]
    fn single_unindexed_subreport_is_not_a_false_duplicate() {
        let root = sample_report("%aditoprj%/report/Sample_report/reportData.jrxml", vec![subreport("UMST", "UMST.jrxml")]);
        assert!(diagnostics_for(&root).iter().all(|d| !d.message.contains("duplicate subreport name")));
    }
}
