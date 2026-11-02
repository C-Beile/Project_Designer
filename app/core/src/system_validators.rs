//! `system` validator registrations (P4, fifth editor family: `SystemEditor`).
//! Mirrors `alias_validators.rs`/`language_validators.rs`'s shape on purpose (`flatten` ->
//! registry -> `Vec<Diagnostic>`) so `project_actor.rs`'s `object_type`-indexed
//! `VALIDATORS_BY_OBJECT_TYPE` dispatch can treat `system` identically to the other object types.
//!
//! **Ablageformat (Rechercheergebnis, gegen den echten Hermes-Korpus verifiziert, siehe
//! `p4-editor-system-preferences-application-notes.md` §1):** one `system/<EnvName>/<EnvName>.aod`
//! per deploy target/environment (`dev1`, `dev1_bg`, `qs`, `prod`, `test_old`, ...). Root element
//! `system`, always exactly `name`/`majorModelMode`/`serverConfigPath`/`tunnelConfigPath` (both
//! plain text-content scalars), plus two occasionally-present fields verified across 8 real
//! instances: `productiveSystem` (typed `<foo v="true" />` boolean, only on `prod`) and
//! `aditoDataPath` (plain text, on `test_old`/`dev_bg` only). No repeated child elements anywhere
//! in this object type, so R26 (RISKS.md) does not apply here - unlike `preferences`/`application`
//! below.
//!
//! `serverConfigPath`/`tunnelConfigPath` are exactly what P3's `server-comm` research
//! (`p3-server-comm-notes.md` §6) identified as the near-certain resolution target of `DeployCLI`'s
//! `--serverconfig` argument - an empty value here is not a cosmetic gap, it breaks deploy
//! addressing for that environment entirely, which is why both are real error-level rules below.

use core_model::value::PropertyValue as CoreValue;
use plugin_kernel::types::{Diagnostic, ObjectType, ProjectModel, PropertyNode};
use plugin_kernel::Validator;

use crate::entity_validators::flatten_into_with_type;

fn flatten(root: &CoreValue) -> ProjectModel {
    let mut nodes: Vec<PropertyNode> = Vec::new();
    flatten_into_with_type(root, &core_model::path::NodePath::root(), ObjectType::System, &mut nodes);
    ProjectModel::new(nodes)
}

/// Real rule #1: an empty `serverConfigPath` breaks `DeployCLI --serverconfig` resolution for this
/// environment (p3-server-comm-notes.md §6/§2) - deploying to this environment would silently fail
/// to find its server config. Verified against all 16 real Hermes `system/*` instances: never
/// empty in any of them, so this rule does not fire on legitimate, untouched project files.
pub struct EmptyServerConfigPathValidator;

impl Validator for EmptyServerConfigPathValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_kernel::types::PropertyValue as PluginValue;

        let Some(node) = project.nodes.iter().find(|n| n.path == "serverConfigPath") else {
            return Vec::new();
        };
        match &node.value {
            PluginValue::String(s) if s.trim().is_empty() => vec![Diagnostic::error(
                "serverConfigPath is empty - deploying to this environment would have nothing to resolve --serverconfig against",
                node.path.clone(),
            )],
            _ => Vec::new(),
        }
    }
}

/// Real rule #2: same reasoning as rule #1, for `tunnelConfigPath` - `DesignerTunnel`
/// (p3-server-comm-notes.md §4, a real SSH tunnel client) resolves against this value to reach a
/// remote/test server. Also never empty in any of the 16 real instances checked.
pub struct EmptyTunnelConfigPathValidator;

impl Validator for EmptyTunnelConfigPathValidator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
        use plugin_kernel::types::PropertyValue as PluginValue;

        let Some(node) = project.nodes.iter().find(|n| n.path == "tunnelConfigPath") else {
            return Vec::new();
        };
        match &node.value {
            PluginValue::String(s) if s.trim().is_empty() => vec![Diagnostic::error(
                "tunnelConfigPath is empty - DesignerTunnel would have nothing to resolve a remote-server tunnel against",
                node.path.clone(),
            )],
            _ => Vec::new(),
        }
    }
}

/// The `object_type`-indexed dispatch entry point for `system` diagnostics
/// (`project_actor.rs`'s `VALIDATORS_BY_OBJECT_TYPE` table).
pub fn diagnostics_for(root: &CoreValue) -> Vec<Diagnostic> {
    let model = flatten(root);
    let mut registry = forge_core::build_plugin_registry();
    registry.register_validator(Box::new(EmptyServerConfigPathValidator));
    registry.register_validator(Box::new(EmptyTunnelConfigPathValidator));
    registry.validate_project(&model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::value::ScalarValue as CoreScalar;

    fn text(s: &str) -> CoreValue {
        CoreValue::Scalar(CoreScalar::Text(s.to_string()))
    }

    fn sample_system(server_config_path: &str, tunnel_config_path: &str) -> CoreValue {
        CoreValue::Object(vec![
            ("name".into(), text("dev1")),
            ("majorModelMode".into(), text("DISTRIBUTED")),
            ("serverConfigPath".into(), text(server_config_path)),
            ("tunnelConfigPath".into(), text(tunnel_config_path)),
        ])
    }

    #[test]
    fn non_empty_paths_are_silent() {
        let root = sample_system("$PROJECTHOME/x.xml", "$PROJECTHOME/y.xml");
        assert!(diagnostics_for(&root).is_empty());
    }

    #[test]
    fn empty_server_config_path_is_flagged() {
        let root = sample_system("", "$PROJECTHOME/y.xml");
        let diagnostics = EmptyServerConfigPathValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("serverConfigPath"));
    }

    #[test]
    fn empty_tunnel_config_path_is_flagged() {
        let root = sample_system("$PROJECTHOME/x.xml", "");
        let diagnostics = EmptyTunnelConfigPathValidator.validate(&flatten(&root));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].path.as_deref(), Some("tunnelConfigPath"));
    }

    #[test]
    fn missing_fields_are_silent_not_a_panic() {
        let root = CoreValue::Object(vec![("name".into(), text("dev1"))]);
        assert!(diagnostics_for(&root).is_empty());
    }
}
