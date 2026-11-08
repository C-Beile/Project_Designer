//! Extension point 3: `Validator` — project-wide checks (architecture.md §2). The reference-
//! integrity check (architecture.md §7) is the first built-in validator planned for the real
//! system; this crate only defines the contract, since `aod::refs::RefGraph` is out of scope here
//! (scope guardrail: no dependency on the other P3 crates).

use crate::types::{Diagnostic, ProjectModel};

/// Any object type can register further validators without the core needing to change
/// (architecture.md §2, last bullet of the Validator description).
pub trait Validator {
    fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ObjectType, PropertyNode, PropertyValue, Severity};

    /// Flags any node whose value is an empty string — stands in for a real field-level
    /// validator (e.g. "title must not be empty").
    struct NoEmptyStringValidator;

    impl Validator for NoEmptyStringValidator {
        fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
            project
                .nodes
                .iter()
                .filter_map(|node| match &node.value {
                    PropertyValue::String(s) if s.is_empty() => {
                        Some(Diagnostic::error("empty string value", node.path.clone()))
                    }
                    _ => None,
                })
                .collect()
        }
    }

    /// Flags any node whose path contains "UNRESOLVED" — stands in for a reference-integrity
    /// style validator (architecture.md §7), independent of the first one.
    struct NoUnresolvedRefValidator;

    impl Validator for NoUnresolvedRefValidator {
        fn validate(&self, project: &ProjectModel) -> Vec<Diagnostic> {
            project
                .nodes
                .iter()
                .filter(|node| node.path.contains("UNRESOLVED"))
                .map(|node| Diagnostic::warning("dangling reference", node.path.clone()))
                .collect()
        }
    }

    #[test]
    fn two_validators_are_both_invoked_and_combined() {
        let project = ProjectModel::new(vec![
            PropertyNode::new(
                "Order_entity/title",
                ObjectType::Entity,
                PropertyValue::String(String::new()),
            ),
            PropertyNode::new(
                "Order_entity/references/UNRESOLVED",
                ObjectType::Entity,
                PropertyValue::String("Order".into()),
            ),
            PropertyNode::new(
                "Order_entity/description",
                ObjectType::Entity,
                PropertyValue::String("fine".into()),
            ),
        ]);

        let validators: Vec<Box<dyn Validator>> =
            vec![Box::new(NoEmptyStringValidator), Box::new(NoUnresolvedRefValidator)];

        let diagnostics: Vec<Diagnostic> =
            validators.iter().flat_map(|v| v.validate(&project)).collect();

        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().any(|d| d.severity == Severity::Error));
        assert!(diagnostics.iter().any(|d| d.severity == Severity::Warning));
    }
}
