//! Extension point 1: `EditorProvider` — a capability descriptor per object family
//! (architecture.md §2). Note that this is *not* the editor UI itself (that stays P4/TypeScript);
//! it is the piece of the contract that lives in the Rust core: which object types an editor
//! family claims, per-node validation, and save/load hooks.

use crate::types::{Diagnostic, ObjectType, PropertyNode};

/// One implementation per editor family (Entity-Editor, View-Canvas, Dashboard-Canvas,
/// Code-Editor, ...), registered once in `PluginRegistry` (architecture.md §6). The core only
/// ever depends on this trait, never on a concrete editor technology — a new editor family
/// requires no change to `aod::tree`/`aod::document`/`refs`, only a new registration.
pub trait EditorProvider {
    /// Object families this provider claims responsibility for.
    fn supported_types(&self) -> &[ObjectType];

    /// Field-/node-level validation specific to this editor family (in addition to whatever a
    /// project-wide `Validator` checks).
    fn validate(&self, node: &PropertyNode) -> Vec<Diagnostic>;

    /// Hook run just before a node belonging to this provider is persisted. Returning a
    /// non-empty `Vec` of `Severity::Error` diagnostics is how a provider can veto a save;
    /// callers are expected to check the returned diagnostics before proceeding to
    /// `aod::document::serialize`. Default: no additional checks.
    fn on_before_save(&self, _node: &PropertyNode) -> Vec<Diagnostic> {
        Vec::new()
    }

    /// Hook run just after a node belonging to this provider has been loaded/projected from
    /// disk (e.g. to warm caches or run informational checks). Default: no-op.
    fn on_after_load(&self, _node: &PropertyNode) -> Vec<Diagnostic> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PropertyValue, Severity};

    /// Minimal dummy `EditorProvider` standing in for a future real editor family
    /// implementation, used to exercise the trait contract in isolation.
    struct DummyEntityEditorProvider {
        types: Vec<ObjectType>,
    }

    impl EditorProvider for DummyEntityEditorProvider {
        fn supported_types(&self) -> &[ObjectType] {
            &self.types
        }

        fn validate(&self, node: &PropertyNode) -> Vec<Diagnostic> {
            match &node.value {
                PropertyValue::String(s) if s.is_empty() => {
                    vec![Diagnostic::error("title must not be empty", node.path.clone())]
                }
                _ => Vec::new(),
            }
        }
    }

    #[test]
    fn validate_flags_empty_string_field() {
        let provider = DummyEntityEditorProvider { types: vec![ObjectType::Entity] };
        let node = PropertyNode::new(
            "Order_entity/title",
            ObjectType::Entity,
            PropertyValue::String(String::new()),
        );

        let diagnostics = provider.validate(&node);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].severity, Severity::Error);
    }

    #[test]
    fn default_hooks_are_no_ops() {
        let provider = DummyEntityEditorProvider { types: vec![ObjectType::Entity] };
        let node = PropertyNode::new(
            "Order_entity/title",
            ObjectType::Entity,
            PropertyValue::String("Order".into()),
        );

        assert!(provider.on_before_save(&node).is_empty());
        assert!(provider.on_after_load(&node).is_empty());
    }
}
