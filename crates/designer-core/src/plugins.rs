//! Wires the static `PluginRegistry` (architecture.md §2/§6): populated once, identically for
//! the CLI and the later Tauri app, so `forge validate` on the CLI behaves exactly like
//! validation in the GUI, with no code duplication between the two consumers.

use plugin_api::PluginRegistry;

pub fn build_plugin_registry() -> PluginRegistry {
    let mut registry = PluginRegistry::new();
    plugin_api::builtin::register_all(&mut registry);
    registry
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::types::LinkedFileExtension;

    #[test]
    fn build_plugin_registry_wires_up_the_built_in_js_compiler() {
        let registry = build_plugin_registry();
        assert!(registry.linked_file_compiler_for(&LinkedFileExtension::Js).is_some());
    }
}
