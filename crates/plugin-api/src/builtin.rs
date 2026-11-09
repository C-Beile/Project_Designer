//! Static registration entry point (architecture.md §2): `register_all` is called once at
//! process start, identically from the CLI and the later Tauri app.
//!
//! At this crate's current scope, the only concrete built-in is the verified `.js`
//! `LinkedFileCompiler`. Editor-family `EditorProvider`s (P4), the reference-integrity
//! `Validator` (`refs`), and concrete `Action`s (rename, delete-cascade, ...) all live in crates
//! this one deliberately does not depend on; they plug into the same `PluginRegistry` via this
//! same `register_all` pattern once those crates exist (see
//! `p3-plugin-api-notes.md` for the integration proposal). The `.ts` compiler is intentionally
//! NOT registered here — registering `UnverifiedTsCompiler` would make every `.ts` lookup fail
//! loudly instead of silently falling through to "no compiler found", which is a deliberate
//! choice left to the integrating crate once `.ts` handling is verified.

use crate::linked_file_compiler::JsInlineCompiler;
use crate::registry::PluginRegistry;

/// Registers every built-in plugin this crate ships with. Later P3/P4 crates are expected to
/// call their own `register_all(&mut registry)` after this one, extending the same registry
/// instance without needing to modify this function.
pub fn register_all(registry: &mut PluginRegistry) {
    registry.register_linked_file_compiler(Box::new(JsInlineCompiler));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::LinkedFileExtension;

    #[test]
    fn register_all_wires_up_the_js_compiler() {
        let mut registry = PluginRegistry::new();
        register_all(&mut registry);

        assert!(registry.linked_file_compiler_for(&LinkedFileExtension::Js).is_some());
    }
}
