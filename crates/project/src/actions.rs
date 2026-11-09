//! Generic `Action` dispatch (Ziel A.2 command `execute_action`, architecture.md §2 last
//! extension point). No concrete `Action` is registered in this round (Ziel B did not require
//! one) - `dispatch_action` is nonetheless real and reachable end-to-end: it builds the same
//! `designer_core::build_plugin_registry()` the CLI's `forge validate` and this app's
//! `list_diagnostics` use, looks up `action_id`, and honestly reports "not registered" until a
//! later P4 agent adds one (same documented-placeholder pattern as `cli forge deploy`, see
//! `p3-cli-forge-notes.md`).

use plugin_api::types::ActionContext;
use std::collections::HashMap;

pub fn dispatch_action(action_id: &str, target_path: String, params: HashMap<String, String>) -> Result<(), String> {
    let mut registry = designer_core::build_plugin_registry();
    // P7 (transpiler-selector): the one concrete `Action` registered so far, on top of the base
    // registry `designer-core` builds (see that crate's own `register_all` doc: later crates are
    // expected to extend the registry instance this way without modifying `build_plugin_registry`
    // itself).
    registry.register_action("transpile", Box::new(crate::transpile_action::TranspileAction));
    let mut ctx = ActionContext::new(target_path);
    ctx.params = params;

    match registry.action(action_id) {
        Some(action) => action.execute(&mut ctx).map(|_tx| ()).map_err(|e| format!("{e:?}")),
        None => Err(format!("no action registered with id '{action_id}' (none registered in this round)")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unregistered_action_id_is_a_clear_error_not_a_panic() {
        let err = dispatch_action("rename", "Foo_entity/Foo_entity.aod".into(), HashMap::new()).unwrap_err();
        assert!(err.contains("no action registered"));
        assert!(err.contains("rename"));
    }
}
