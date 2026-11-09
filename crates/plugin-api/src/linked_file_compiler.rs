//! Extension point 2: `LinkedFileCompiler` — resolves a `%aditoprj%/...` linked-file reference
//! into the content that gets inlined into the `dist` copy during the transpiler's copy phase
//! (transpiler.md §4).

use crate::types::{CompiledOutput, LinkedFileExtension, LinkedFileRef};

/// Error returned by a `LinkedFileCompiler`. `Unverified` is the deliberate "refuse to guess"
/// outcome for extensions whose real transpiler behavior has not been proven against a live
/// transpiler run yet (currently `.ts`, see transpiler.md §5 and architecture.md §9 point 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompileError {
    /// This compiler does not claim the given extension at all.
    UnsupportedExtension(LinkedFileExtension),
    /// This compiler claims the extension, but the real compilation behavior is not yet
    /// verified against a real transpiler run, so it refuses to produce a guessed result.
    Unverified { extension: LinkedFileExtension, reason: String },
}

/// One implementation per linked-file extension. Kept intentionally narrow (one `compile` call
/// per file) so a new extension can be added without touching the core.
pub trait LinkedFileCompiler {
    /// Whether this compiler claims responsibility for the given extension.
    fn handles_extension(&self, extension: &LinkedFileExtension) -> bool;

    /// Resolve a linked file into inline `dist` content, or an error (including the deliberate
    /// `Unverified` refusal for extensions like `.ts`).
    fn compile(&self, linked_file: &LinkedFileRef) -> Result<CompiledOutput, CompileError>;
}

/// Default `.js` implementation: 1:1 inline copy of the source content, verified behavior per
/// transpiler.md §4 ("Umgebaut — Linked-File-Inlining": the tag content is replaced by the full
/// script source, unchanged).
#[derive(Debug, Default)]
pub struct JsInlineCompiler;

impl LinkedFileCompiler for JsInlineCompiler {
    fn handles_extension(&self, extension: &LinkedFileExtension) -> bool {
        matches!(extension, LinkedFileExtension::Js)
    }

    fn compile(&self, linked_file: &LinkedFileRef) -> Result<CompiledOutput, CompileError> {
        if !self.handles_extension(&linked_file.extension) {
            return Err(CompileError::UnsupportedExtension(linked_file.extension.clone()));
        }
        Ok(CompiledOutput { inline_content: linked_file.source_content.clone() })
    }
}

/// Placeholder `.ts` implementation. Deliberately refuses to compile — real `tsc`-based
/// behavior is UNVERIFIED (no `.ts` linked file found anywhere in the analyzed corpus, see
/// transpiler.md §5). This exists so the trait shape for `.ts` support is already in place and
/// P5 (`transpiler-wrapper`) can replace only the `compile` body once verified, without any
/// `LinkedFileCompiler` trait or registry change.
#[derive(Debug, Default)]
pub struct UnverifiedTsCompiler;

impl LinkedFileCompiler for UnverifiedTsCompiler {
    fn handles_extension(&self, extension: &LinkedFileExtension) -> bool {
        matches!(extension, LinkedFileExtension::Ts)
    }

    fn compile(&self, linked_file: &LinkedFileRef) -> Result<CompiledOutput, CompileError> {
        if !self.handles_extension(&linked_file.extension) {
            return Err(CompileError::UnsupportedExtension(linked_file.extension.clone()));
        }
        Err(CompileError::Unverified {
            extension: linked_file.extension.clone(),
            reason: "no .ts linked file found in the analyzed corpus (transpiler.md §5); \
                     inline-vs-tsc-compile behavior must be proven against a real transpiler \
                     run before this compiler produces output"
                .to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_compiler_inlines_source_verbatim() {
        let compiler = JsInlineCompiler;
        let linked_file = LinkedFileRef {
            project_path: "%aditoprj%/entity/ResourceOperation_entity/entityfields/status/displayValueProcess.js".into(),
            extension: LinkedFileExtension::Js,
            source_content: "result.string(vars.get(\"$field\"));".into(),
        };

        let output = compiler.compile(&linked_file).expect("js compile must succeed");

        assert_eq!(output.inline_content, linked_file.source_content);
    }

    #[test]
    fn js_compiler_rejects_non_js_extension() {
        let compiler = JsInlineCompiler;
        let linked_file = LinkedFileRef {
            project_path: "%aditoprj%/entity/Foo_entity/bar.ts".into(),
            extension: LinkedFileExtension::Ts,
            source_content: "export const x = 1;".into(),
        };

        let result = compiler.compile(&linked_file);

        assert_eq!(
            result,
            Err(CompileError::UnsupportedExtension(LinkedFileExtension::Ts))
        );
    }

    #[test]
    fn ts_compiler_refuses_to_guess() {
        let compiler = UnverifiedTsCompiler;
        let linked_file = LinkedFileRef {
            project_path: "%aditoprj%/entity/Foo_entity/bar.ts".into(),
            extension: LinkedFileExtension::Ts,
            source_content: "export const x = 1;".into(),
        };

        let result = compiler.compile(&linked_file);

        assert!(matches!(result, Err(CompileError::Unverified { .. })));
    }
}
