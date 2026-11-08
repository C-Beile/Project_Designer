//! `neonView`/`neonContext`/`neonDashboard` validator registrations (P4, second editor family).
//! Mirrors `entity_validators.rs`'s shape on purpose (`flatten_*` -> registry -> `Vec<Diagnostic>`)
//! so the `object_type`-indexed dispatch in `project_actor.rs::list_diagnostics` can treat every
//! object type identically: one `pub fn <type>_diagnostics_for(&CoreValue) -> Vec<Diagnostic>`
//! per type, doing its own flatten + registration + `validate_project` internally.
//!
//! All three rules below are deliberately scoped to a single open file's own tree, not
//! cross-object reference integrity (e.g. "does this context's `entity` name exist") - the actor
//! only ever has one `ProjectHandle` open at a time per node id (see `project_actor.rs`'s module
//! doc), there is no project-wide index of every entity/view name yet to check against. Real,
//! single-file-scoped authoring mistakes were chosen instead, matching the entity precedent's own
//! "genuine, sharp-edged mistake" bar rather than a placeholder rule.

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_api::Validator;
use std::collections::HashMap;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue, object_type: ObjectType) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &aod::tree::path::NodePath::root(), object_type, &mut nodes);
    ProjectModel::new(nodes)
}

// ---------------------------------------------------------------------------------------------
// neonView
// ---------------------------------------------------------------------------------------------

/// Real rule: `layout.masterSlaveLayout.master` (when present) must point at a `name` UUID that
/// actually exists among this file's `children.neonViewReference[]` entries - `neonView.schema.json`
/// documents this as the addressing mechanism ("layout/masterSlaveLayout/master value matches one
/// neonViewReference/name in the same file's children"), so a dangling id here is a real, silent
/// authoring bug: the Designer/runtime has no child to render as the layout's master.
pub struct DanglingMasterReferenceValidator;

impl Validator for DanglingMasterReferenceValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let master = project
            .nodes
            .iter()
            .find(|n| n.path == "layout.masterSlaveLayout.master");
        let Some(master) = master else { return Vec::new() };
        let PluginValue::String(master_id) = &master.value else { return Vec::new() };
        if master_id.is_empty() {
            return Vec::new();
        }

        let known_ids: Vec<&str> = project
            .nodes
            .iter()
            .filter(|n| is_view_reference_name_path(&n.path))
            .filter_map(|n| match &n.value {
                PluginValue::String(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();

        if known_ids.contains(&master_id.as_str()) {
            Vec::new()
        } else {
            vec![Diagnostic::error(
                format!("layout master '{master_id}' does not reference any neonViewReference in this view"),
                master.path.clone(),
            )]
        }
    }
}

fn is_view_reference_name_path(path: &str) -> bool {
    path.contains("children.neonViewReference[") && path.ends_with(".name")
}

pub fn view_diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root, ObjectType::View);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(DanglingMasterReferenceValidator));
    registry.validate_project(&model)
}

// ---------------------------------------------------------------------------------------------
// neonContext
// ---------------------------------------------------------------------------------------------

/// Real rule: `filterView`/`editView`/`previewView` (when set) are expected to also appear in
/// `references.neonViewReference[].view` - aod-format.md §3 documents that catalogue as
/// "redundant... observed to duplicate filterView/editView/previewView plus extras", i.e. the
/// Designer keeps it in sync as a full inventory of every view reachable from this context. A
/// primary view slot pointing at a view missing from that catalogue is a real inconsistency
/// (e.g. a stale/hand-edited reference), not a hard error since nothing in this single file
/// definitively proves it is a mistake rather than a deliberate omission.
pub struct PrimaryViewNotCatalogedValidator;

impl Validator for PrimaryViewNotCatalogedValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let cataloged: Vec<&str> = project
            .nodes
            .iter()
            .filter(|n| n.path.contains("references.neonViewReference[") && n.path.ends_with(".view"))
            .filter_map(|n| match &n.value {
                PluginValue::String(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();

        let mut diagnostics = Vec::new();
        for slot in ["filterView", "editView", "previewView"] {
            let Some(node) = project.nodes.iter().find(|n| n.path == slot) else { continue };
            let PluginValue::String(view_name) = &node.value else { continue };
            if view_name.is_empty() || cataloged.contains(&view_name.as_str()) {
                continue;
            }
            diagnostics.push(Diagnostic::warning(
                format!("{slot} '{view_name}' is not listed in references.neonViewReference - the view catalogue is out of sync"),
                node.path.clone(),
            ));
        }
        diagnostics
    }
}

pub fn context_diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root, ObjectType::Context);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(PrimaryViewNotCatalogedValidator));
    registry.validate_project(&model)
}

// ---------------------------------------------------------------------------------------------
// neonDashboard
// ---------------------------------------------------------------------------------------------

/// Real rule: two `neonDashlet`s placed at the same `uiConfiguration` grid cell (`xPos`+`yPos`
/// both present and equal) overlap on screen - one of them is invisible/unreachable at runtime.
/// `neonDashboard.schema.json` marks all four grid fields optional (defaults presumably 0/1), so
/// this only fires when both coordinates are explicitly present on both dashlets - an intentional
/// choice to avoid false positives against dashlets that omit position entirely.
pub struct OverlappingDashletPositionValidator;

impl Validator for OverlappingDashletPositionValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_api::types::PropertyValue as PluginValue;

        let mut positions: HashMap<(i64, i64), String> = HashMap::new();
        let mut diagnostics = Vec::new();

        // `neonDashlet[<N>]` container paths, one per dashlet.
        let mut dashlet_indices: Vec<usize> = Vec::new();
        for node in &project.nodes {
            if let Some(idx) = dashlet_index(&node.path) {
                if !dashlet_indices.contains(&idx) {
                    dashlet_indices.push(idx);
                }
            }
        }

        for idx in dashlet_indices {
            // `<xPos v="0" />` projects as a *leaf scalar* directly at the `xPos` path itself
            // (`aod/src/tree/aod_io_adapter.rs::scalar_from_empty_tag`/`project_element` -
            // the `v` attribute is how the XML spells a typed scalar, it is not a nested field
            // in the value tree) - no `.v` suffix here.
            let x_path = format!("defaultDashlets.neonDashlet[{idx}].uiConfiguration.xPos");
            let y_path = format!("defaultDashlets.neonDashlet[{idx}].uiConfiguration.yPos");
            let x = project.nodes.iter().find(|n| n.path == x_path);
            let y = project.nodes.iter().find(|n| n.path == y_path);
            let (Some(x), Some(y)) = (x, y) else { continue };
            let (PluginValue::Int(x), PluginValue::Int(y)) = (&x.value, &y.value) else { continue };

            let container_path = format!("defaultDashlets.neonDashlet[{idx}]");
            if let Some(first_container) = positions.insert((*x, *y), container_path.clone()) {
                diagnostics.push(Diagnostic::error(
                    format!("dashlet at ({x}, {y}) overlaps another dashlet already placed there ({first_container})"),
                    container_path,
                ));
            }
        }
        diagnostics
    }
}

/// Extracts `<N>` from a `defaultDashlets.neonDashlet[<N>]...` path prefix, if this path is under
/// one.
fn dashlet_index(path: &str) -> Option<usize> {
    let marker = "defaultDashlets.neonDashlet[";
    let start = path.find(marker)? + marker.len();
    let rest = &path[start..];
    let end = rest.find(']')?;
    rest[..end].parse().ok()
}

pub fn dashboard_diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root, ObjectType::Dashboard);
    let mut registry = designer_core::build_plugin_registry();
    registry.register_validator(Box::new(OverlappingDashletPositionValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::tree::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }
    fn int(i: i64) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Int(i))
    }

    // --- neonView ---

    fn sample_view(master: &str, ref_ids: &[&str]) -> CoreValue {
        let children_items: Vec<CoreValue> = ref_ids
            .iter()
            .map(|id| CoreValue::Object(vec![("name".into(), text(id)), ("view".into(), text("Sub_view"))]))
            .collect();
        CoreValue::Object(vec![
            (
                "layout".into(),
                CoreValue::Object(vec![(
                    "masterSlaveLayout".into(),
                    CoreValue::Object(vec![("master".into(), text(master))]),
                )]),
            ),
            (
                "children".into(),
                CoreValue::Object(vec![("neonViewReference".into(), CoreValue::Array(children_items))]),
            ),
        ])
    }

    #[test]
    fn master_pointing_at_a_known_child_is_silent() {
        let root = sample_view("abc-1", &["abc-1", "abc-2"]);
        assert!(view_diagnostics_for(&root).is_empty());
    }

    #[test]
    fn dangling_master_reference_is_flagged() {
        let root = sample_view("does-not-exist", &["abc-1", "abc-2"]);
        let diagnostics = view_diagnostics_for(&root);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("does-not-exist"));
    }

    // --- neonContext ---

    fn sample_context(filter_view: &str, cataloged: &[&str]) -> CoreValue {
        let ref_items: Vec<CoreValue> = cataloged
            .iter()
            .map(|v| CoreValue::Object(vec![("name".into(), text("uuid")), ("view".into(), text(*v))]))
            .collect();
        CoreValue::Object(vec![
            ("filterView".into(), text(filter_view)),
            (
                "references".into(),
                CoreValue::Object(vec![("neonViewReference".into(), CoreValue::Array(ref_items))]),
            ),
        ])
    }

    #[test]
    fn filter_view_present_in_catalogue_is_silent() {
        let root = sample_context("Tour_Filter_view", &["Tour_Filter_view", "Tour_Edit_view"]);
        assert!(context_diagnostics_for(&root).is_empty());
    }

    #[test]
    fn filter_view_missing_from_catalogue_is_a_warning() {
        let root = sample_context("Tour_Filter_view", &["Tour_Edit_view"]);
        let diagnostics = context_diagnostics_for(&root);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("Tour_Filter_view"));
    }

    // --- neonDashboard ---

    fn sample_dashboard(positions: &[(i64, i64)]) -> CoreValue {
        let items: Vec<CoreValue> = positions
            .iter()
            .map(|(x, y)| {
                CoreValue::Object(vec![
                    ("name".into(), text("InformationDashlet")),
                    (
                        "uiConfiguration".into(),
                        CoreValue::Object(vec![("xPos".into(), int(*x)), ("yPos".into(), int(*y))]),
                    ),
                ])
            })
            .collect();
        CoreValue::Object(vec![(
            "defaultDashlets".into(),
            CoreValue::Object(vec![("neonDashlet".into(), CoreValue::Array(items))]),
        )])
    }

    #[test]
    fn distinct_positions_are_silent() {
        let root = sample_dashboard(&[(0, 0), (1, 0), (0, 1)]);
        assert!(dashboard_diagnostics_for(&root).is_empty());
    }

    #[test]
    fn overlapping_positions_are_flagged() {
        let root = sample_dashboard(&[(0, 0), (0, 0)]);
        let diagnostics = dashboard_diagnostics_for(&root);
        assert_eq!(diagnostics.len(), 1);
        assert!(diagnostics[0].message.contains("(0, 0)"));
    }
}
