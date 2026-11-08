//! `PluginRegistry`: the single static registration point for all four extension traits.
//! Lives conceptually in `forge-core` (architecture.md §2); this crate just defines the
//! container type plus the `register_all` entry point. Populated once at process start and
//! consumed identically by the CLI and the Tauri app, so `forge validate` on the CLI behaves
//! exactly like validation in the GUI.

use std::collections::HashMap;

use crate::action::Action;
use crate::editor_provider::EditorProvider;
use crate::linked_file_compiler::LinkedFileCompiler;
use crate::types::{Diagnostic, LinkedFileExtension, ObjectType};
use crate::validator::Validator;

#[derive(Default)]
pub struct PluginRegistry {
    editor_providers: Vec<Box<dyn EditorProvider>>,
    linked_file_compilers: Vec<Box<dyn LinkedFileCompiler>>,
    validators: Vec<Box<dyn Validator>>,
    actions: HashMap<String, Box<dyn Action>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_editor_provider(&mut self, provider: Box<dyn EditorProvider>) {
        self.editor_providers.push(provider);
    }

    pub fn register_linked_file_compiler(&mut self, compiler: Box<dyn LinkedFileCompiler>) {
        self.linked_file_compilers.push(compiler);
    }

    pub fn register_validator(&mut self, validator: Box<dyn Validator>) {
        self.validators.push(validator);
    }

    /// Actions are looked up by a stable id (e.g. `"rename"`, `"delete-cascade"`), since they are
    /// invoked from UI commands/menu entries rather than dispatched by object type.
    pub fn register_action(&mut self, id: impl Into<String>, action: Box<dyn Action>) {
        self.actions.insert(id.into(), action);
    }

    /// All registered providers that claim the given object type.
    pub fn editor_providers_for(&self, object_type: &ObjectType) -> Vec<&dyn EditorProvider> {
        self.editor_providers
            .iter()
            .filter(|p| p.supported_types().contains(object_type))
            .map(|p| p.as_ref())
            .collect()
    }

    /// First registered compiler that claims the given extension, if any.
    pub fn linked_file_compiler_for(
        &self,
        extension: &LinkedFileExtension,
    ) -> Option<&dyn LinkedFileCompiler> {
        self.linked_file_compilers
            .iter()
            .find(|c| c.handles_extension(extension))
            .map(|c| c.as_ref())
    }

    pub fn action(&self, id: &str) -> Option<&dyn Action> {
        self.actions.get(id).map(|a| a.as_ref())
    }

    pub fn validator_count(&self) -> usize {
        self.validators.len()
    }

    /// Runs every registered `Validator` against the given project and combines their
    /// diagnostics — the mechanism behind "every object type can dock on another validator
    /// without changing the core" (architecture.md §2).
    pub fn validate_project(&self, project: &crate::types::ProjectModel) -> Vec<Diagnostic> {
        self.validators.iter().flat_map(|v| v.validate(project)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::action::{Action, ActionError};
    use crate::editor_provider::EditorProvider;
    use crate::linked_file_compiler::{CompileError, JsInlineCompiler};
    use crate::types::{
        ActionContext, CompiledOutput, Diagnostic, FileCommand, LinkedFileRef, PropertyNode,
        ProjectModel, Transaction,
    };
    use crate::validator::Validator;

    struct DummyEditorProvider(Vec<ObjectType>);

    impl EditorProvider for DummyEditorProvider {
        fn supported_types(&self) -> &[ObjectType] {
            &self.0
        }

        fn validate(&self, _node: &PropertyNode) -> Vec<Diagnostic> {
            Vec::new()
        }
    }

    struct AlwaysOneWarningValidator;

    impl Validator for AlwaysOneWarningValidator {
        fn validate(&self, _project: &ProjectModel) -> Vec<Diagnostic> {
            vec![Diagnostic::warning("always warns", "some/path")]
        }
    }

    struct NoopAction;

    impl Action for NoopAction {
        fn execute(&self, ctx: &mut ActionContext) -> Result<Transaction, ActionError> {
            Ok(Transaction::new(vec![FileCommand {
                file: ctx.target_path.clone(),
                old_bytes_range: 0..0,
                old_bytes: Vec::new(),
                new_bytes: Vec::new(),
            }]))
        }
    }

    #[test]
    fn registry_holds_and_looks_up_editor_provider_by_type() {
        let mut registry = PluginRegistry::new();
        registry.register_editor_provider(Box::new(DummyEditorProvider(vec![ObjectType::View])));

        let found = registry.editor_providers_for(&ObjectType::View);
        let not_found = registry.editor_providers_for(&ObjectType::Entity);

        assert_eq!(found.len(), 1);
        assert!(not_found.is_empty());
    }

    #[test]
    fn registry_holds_and_looks_up_linked_file_compiler() {
        let mut registry = PluginRegistry::new();
        registry.register_linked_file_compiler(Box::new(JsInlineCompiler));

        let compiler = registry
            .linked_file_compiler_for(&LinkedFileExtension::Js)
            .expect("js compiler must be found");

        let output = compiler
            .compile(&LinkedFileRef {
                project_path: "%aditoprj%/entity/Foo_entity/bar.js".into(),
                extension: LinkedFileExtension::Js,
                source_content: "1+1;".into(),
            })
            .unwrap();

        assert_eq!(output, CompiledOutput { inline_content: "1+1;".into() });
        assert!(registry.linked_file_compiler_for(&LinkedFileExtension::Ts).is_none());
    }

    #[test]
    fn registry_combines_diagnostics_from_multiple_validators() {
        let mut registry = PluginRegistry::new();
        registry.register_validator(Box::new(AlwaysOneWarningValidator));
        registry.register_validator(Box::new(AlwaysOneWarningValidator));

        let diagnostics = registry.validate_project(&ProjectModel::default());

        assert_eq!(registry.validator_count(), 2);
        assert_eq!(diagnostics.len(), 2);
    }

    #[test]
    fn registry_holds_and_invokes_action_by_id() {
        let mut registry = PluginRegistry::new();
        registry.register_action("noop", Box::new(NoopAction));

        let action = registry.action("noop").expect("action must be registered");
        let mut ctx = ActionContext::new("Order_entity/Order_entity.aod");
        let transaction = action.execute(&mut ctx).unwrap();

        assert_eq!(transaction.commands.len(), 1);
        assert!(registry.action("missing").is_none());
    }

    #[test]
    fn compile_error_variant_for_unsupported_extension_is_reachable() {
        let compiler = JsInlineCompiler;
        let err = compiler
            .compile(&LinkedFileRef {
                project_path: "x.ts".into(),
                extension: LinkedFileExtension::Ts,
                source_content: String::new(),
            })
            .unwrap_err();

        assert_eq!(err, CompileError::UnsupportedExtension(LinkedFileExtension::Ts));
    }
}
