//! Tabelle `object_type` -> Validatoren und Erkennung des Modelltyps. Gemeinsam genutzt von
//! `project_actor` und `problems`.

use aod::tree::value::PropertyValue as CoreValue;
use plugin_api::types::Diagnostic;

/// `object_type`-indexed dispatch table for `list_diagnostics`, analogous to `tree.rs`'s
/// `OBJECT_FOLDERS`. Replaces this function's previous hard-wired call to the two entity
/// validators (see `p4-editor-entity-notes.md` §2/§5, the deliberately deferred generalisation -
/// this is the "first team building a second validator family" the note asked to do it).
/// Extend this table, not `list_diagnostics`'s body, to add a new object type's validators - each
/// entry owns its own flatten+registry+validate_project internally (see
/// `entity_validators::diagnostics_for` / `view_context_dashboard_validators::*_diagnostics_for`).
pub const VALIDATORS_BY_OBJECT_TYPE: &[(&str, fn(&CoreValue) -> Vec<Diagnostic>)] = &[
    ("entity", crate::entity_validators::diagnostics_for),
    ("neonView", crate::view_context_dashboard_validators::view_diagnostics_for),
    ("neonContext", crate::view_context_dashboard_validators::context_diagnostics_for),
    ("neonDashboard", crate::view_context_dashboard_validators::dashboard_diagnostics_for),
    ("aliasDefinition", crate::alias_validators::diagnostics_for),
    ("language", crate::language_validators::diagnostics_for),
    ("system", crate::system_validators::diagnostics_for),
    ("preferences", crate::preferences_validators::diagnostics_for),
    ("application", crate::application_validators::diagnostics_for),
    ("entityWebservice", crate::webservice_validators::diagnostics_for),
    ("report", crate::report_validators::diagnostics_for),
];

/// Name of the document's top-level element, i.e. the ADITO model type (`entity`, `neonContext`).
pub fn root_tag(bytes: &[u8]) -> String {
    let mut i = 0;
    while let Some(off) = bytes[i..].iter().position(|&c| c == b'<') {
        let start = i + off + 1;
        match bytes.get(start) {
            Some(b'?') | Some(b'!') => i = start,
            Some(_) => {
                let end = bytes[start..]
                    .iter()
                    .position(|c| c.is_ascii_whitespace() || *c == b'>' || *c == b'/')
                    .map(|e| start + e)
                    .unwrap_or(bytes.len());
                return String::from_utf8_lossy(&bytes[start..end]).into_owned();
            }
            None => break,
        }
    }
    String::new()
}
