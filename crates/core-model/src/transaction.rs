//! Bundling multiple `FileCommand`s into one atomic, undoable user action
//! (architecture.md §3: "Eine einzelne fachliche User-Aktion ... bündelt mehrere FileCommands
//! zu einer Transaction, die atomar auf den Undo-Stack kommt").

use crate::command::FileCommand;

#[derive(Debug, Clone)]
pub struct Transaction {
    /// Human-readable label for undo/redo UI ("Rename THHIT_Tour_entity to ...").
    pub label: String,
    pub commands: Vec<FileCommand>,
}

impl Transaction {
    pub fn new(label: impl Into<String>, commands: Vec<FileCommand>) -> Self {
        Transaction { label: label.into(), commands }
    }

    pub fn single(label: impl Into<String>, command: FileCommand) -> Self {
        Transaction { label: label.into(), commands: vec![command] }
    }

    /// The inverse transaction: same commands, each individually inverted, in reverse order.
    /// Reversing order matters once a transaction touches the *same* file more than once (e.g. a
    /// rename cascade that patches two reference sites in one file) - undoing must retire the
    /// most recently applied edit first, mirroring how the forward apply built up the buffer.
    pub fn inverse(&self) -> Transaction {
        let commands = self.commands.iter().rev().map(FileCommand::inverse).collect();
        Transaction { label: format!("Undo {}", self.label), commands }
    }
}

/// Linear undo/redo history over `Transaction`s. Deliberately just two stacks (ADR-0005 point 2:
/// no tree snapshots) - pushing a new transaction clears the redo stack, matching standard
/// editor undo semantics.
#[derive(Debug, Default)]
pub struct UndoStack {
    done: Vec<Transaction>,
    undone: Vec<Transaction>,
}

impl UndoStack {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, tx: Transaction) {
        self.done.push(tx);
        self.undone.clear();
    }

    /// Pops the most recent transaction and returns its inverse for the caller to apply to the
    /// live document(s); the original transaction moves onto the redo stack.
    pub fn undo(&mut self) -> Option<Transaction> {
        let tx = self.done.pop()?;
        let inverse = tx.inverse();
        self.undone.push(tx);
        Some(inverse)
    }

    /// Pops the most recently undone transaction and returns it (forward form, to re-apply);
    /// it moves back onto the undo stack.
    pub fn redo(&mut self) -> Option<Transaction> {
        let tx = self.undone.pop()?;
        self.done.push(tx.clone());
        Some(tx)
    }

    pub fn can_undo(&self) -> bool {
        !self.done.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.undone.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::ByteRange;
    use std::path::PathBuf;

    fn cmd(start: usize, end: usize, old: &str, new: &str) -> FileCommand {
        FileCommand {
            file: PathBuf::from("x.aod"),
            old_range: ByteRange::new(start, end),
            old_bytes: old.as_bytes().to_vec(),
            new_bytes: new.as_bytes().to_vec(),
        }
    }

    #[test]
    fn inverse_swaps_bytes_and_recomputes_range_from_new_length() {
        let c = cmd(10, 13, "old", "newer");
        let inv = c.inverse();
        assert_eq!(inv.old_range, ByteRange::new(10, 15)); // 10 + len("newer")
        assert_eq!(inv.old_bytes, b"newer");
        assert_eq!(inv.new_bytes, b"old");
    }

    #[test]
    fn transaction_inverse_reverses_command_order() {
        let tx = Transaction::new("edit two fields", vec![cmd(0, 1, "a", "A"), cmd(5, 6, "b", "B")]);
        let inv = tx.inverse();
        assert_eq!(inv.commands[0].old_bytes, b"B");
        assert_eq!(inv.commands[1].old_bytes, b"A");
    }

    #[test]
    fn undo_stack_round_trips_and_clears_redo_on_new_push() {
        let mut stack = UndoStack::new();
        stack.push(Transaction::single("edit", cmd(0, 1, "a", "A")));
        assert!(stack.can_undo());
        let undo_tx = stack.undo().unwrap();
        assert_eq!(undo_tx.commands[0].new_bytes, b"a");
        assert!(stack.can_redo());

        let redo_tx = stack.redo().unwrap();
        assert_eq!(redo_tx.commands[0].new_bytes, b"A");
        assert!(!stack.can_redo());

        stack.push(Transaction::single("other edit", cmd(0, 1, "c", "C")));
        assert!(!stack.can_redo(), "pushing a new transaction must clear the redo stack");
    }
}
