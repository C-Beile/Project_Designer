//! Extension point 4: `Action` — UI commands (rename, delete-with-cascade, extract linked file,
//! ...). `execute` always returns an undo `Transaction` instead of mutating anything directly,
//! so that every action, regardless of which plugin contributed it, runs through the same
//! undo/redo path (architecture.md §2 last bullet, §3).

use crate::types::{ActionContext, Transaction};

/// Error returned when an action cannot produce a transaction (e.g. missing/invalid parameters
/// in the `ActionContext`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionError(pub String);

impl ActionError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

pub trait Action {
    /// Compute the effect of this action as an undoable `Transaction`. Must never mutate project
    /// state directly — the caller applies the returned `Transaction` through the single
    /// undo/redo path.
    fn execute(&self, ctx: &mut ActionContext) -> Result<Transaction, ActionError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::FileCommand;

    /// Dummy rename action: reads `old_name`/`new_name` params off the context and produces a
    /// single `FileCommand` replacing the target's name bytes. Stands in for a real rename
    /// action, which would additionally consult the project index (`project-index`) for cascading edits
    /// (architecture.md §7) — out of scope for this crate.
    struct DummyRenameAction;

    impl Action for DummyRenameAction {
        fn execute(&self, ctx: &mut ActionContext) -> Result<Transaction, ActionError> {
            let old_name = ctx
                .params
                .get("old_name")
                .ok_or_else(|| ActionError::new("missing old_name param"))?
                .clone();
            let new_name = ctx
                .params
                .get("new_name")
                .ok_or_else(|| ActionError::new("missing new_name param"))?
                .clone();

            let command = FileCommand {
                file: ctx.target_path.clone(),
                old_bytes_range: 0..old_name.len(),
                old_bytes: old_name.into_bytes(),
                new_bytes: new_name.into_bytes(),
            };

            Ok(Transaction::new(vec![command]))
        }
    }

    #[test]
    fn execute_returns_transaction_instead_of_mutating() {
        let action = DummyRenameAction;
        let mut ctx = ActionContext::new("Order_entity/Order_entity.aod")
            .with_param("old_name", "Order")
            .with_param("new_name", "Purchase");

        let transaction = action.execute(&mut ctx).expect("rename must succeed");

        assert_eq!(transaction.commands.len(), 1);
        assert_eq!(transaction.commands[0].new_bytes, b"Purchase");
        assert!(!transaction.is_empty());
    }

    #[test]
    fn execute_fails_cleanly_on_missing_params() {
        let action = DummyRenameAction;
        let mut ctx = ActionContext::new("Order_entity/Order_entity.aod");

        let result = action.execute(&mut ctx);

        assert!(result.is_err());
    }
}
