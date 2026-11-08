//! Per-project undo/redo history (architecture.md §3, Ziel A.5).
//!
//! **Deliberate deviation from `aod::tree::transaction::UndoStack`, documented as an open
//! `designer-core` API gap in `p4-editor-entity-notes.md`:** `core-model` already ships a real,
//! tested `UndoStack<Transaction>` operating on patch-level `FileCommand` byte ranges
//! (`core_model/src/transaction.rs`), which is the architecturally "correct" mechanism per
//! architecture.md §3. But `designer_core::ProjectHandle` does not expose a way to *apply* an
//! arbitrary `FileCommand`/`Transaction` back onto its live document - only
//! `set_property(path, ScalarValue)` (which recomputes a fresh scalar text-replace every time)
//! and `save()` are public. Reusing `UndoStack` here would need either a new `ProjectHandle`
//! method (`apply_transaction`) or exposing `PropertyTree::source_mut()` - both are `designer-core`
//! changes, out of this agent's scope (guardrail: "ruft dessen API auf, ändert sie nicht").
//!
//! So this history operates at **value granularity** instead of byte-range granularity: each
//! entry remembers the old and new `ScalarValue` for one `NodePath`, and undo/redo simply re-call
//! `set_property` with the other value. Because `set_property`'s write-back
//! (`apply_scalar_text_replace`) recomputes the target byte range fresh from the *current*
//! document on every call (see `core-model/src/aod_io_adapter.rs`), replaying the original value
//! through the same call reproduces the exact original bytes - verified end-to-end by
//! `tests/commands.rs::undo_then_redo_reproduces_the_exact_original_and_edited_bytes`. This is a
//! real, verified property for the single-file, single-field-at-a-time edits this round's Entity
//! editor performs; it would need revisiting once multi-file cascading transactions (e.g. rename
//! cascades, architecture.md §7) are in scope, which is exactly why the gap above is flagged for
//! `designer-core` rather than silently worked around forever.

use aod::tree::path::NodePath;
use aod::tree::value::ScalarValue;

#[derive(Debug, Clone)]
pub struct EditEntry {
    pub path: NodePath,
    pub old: ScalarValue,
    pub new: ScalarValue,
}

/// One undoable step: a scalar replace, or (for structural edits such as adding a property
/// element or changing a typed `v="..."` attribute) the whole document before and after.
#[derive(Debug, Clone)]
pub enum HistoryItem {
    Scalar(EditEntry),
    Document { before: Vec<u8>, after: Vec<u8> },
}

impl From<EditEntry> for HistoryItem {
    fn from(e: EditEntry) -> Self {
        HistoryItem::Scalar(e)
    }
}

#[derive(Debug)]
pub struct EditHistory<T = EditEntry> {
    done: Vec<T>,
    undone: Vec<T>,
}

impl<T> Default for EditHistory<T> {
    fn default() -> Self {
        EditHistory { done: Vec::new(), undone: Vec::new() }
    }
}

impl<T: Clone> EditHistory<T> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a forward edit. Matches standard editor semantics: starting a new edit clears
    /// whatever was on the redo stack (architecture.md §3, mirrored from `aod::tree::UndoStack`).
    pub fn record(&mut self, entry: impl Into<T>) {
        self.done.push(entry.into());
        self.undone.clear();
    }

    /// Pops the most recent edit; caller is expected to re-apply its old state.
    pub fn undo(&mut self) -> Option<T> {
        let entry = self.done.pop()?;
        self.undone.push(entry.clone());
        Some(entry)
    }

    /// Pops the most recently undone edit; caller is expected to re-apply its new state.
    pub fn redo(&mut self) -> Option<T> {
        let entry = self.undone.pop()?;
        self.done.push(entry.clone());
        Some(entry)
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

    fn entry(old: &str, new: &str) -> EditEntry {
        EditEntry {
            path: NodePath::root().field("title"),
            old: ScalarValue::Text(old.to_string()),
            new: ScalarValue::Text(new.to_string()),
        }
    }

    #[test]
    fn undo_then_redo_restores_forward_state_and_toggles_flags() {
        let mut history = EditHistory::<EditEntry>::new();
        assert!(!history.can_undo());

        history.record(entry("A", "B"));
        assert!(history.can_undo());
        assert!(!history.can_redo());

        let undone = history.undo().unwrap();
        assert_eq!(undone.old, ScalarValue::Text("A".into()));
        assert!(!history.can_undo());
        assert!(history.can_redo());

        let redone = history.redo().unwrap();
        assert_eq!(redone.new, ScalarValue::Text("B".into()));
        assert!(history.can_undo());
        assert!(!history.can_redo());
    }

    #[test]
    fn new_edit_after_undo_clears_the_redo_stack() {
        let mut history = EditHistory::<EditEntry>::new();
        history.record(entry("A", "B"));
        history.undo();
        assert!(history.can_redo());

        history.record(entry("A", "C"));
        assert!(!history.can_redo(), "a fresh edit must clear whatever was on the redo stack");
    }
}
