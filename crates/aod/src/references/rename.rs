//! Rename cascade (architecture.md §7): every incoming bare-name reference to an object is rewritten
//! to the new name and bundled into one `Transaction` - atomic, one undo step. The list of incoming
//! references comes from the caller (the project index answers "who points to X"); this module only
//! patches. The app itself renames through `project::rename`; this is the undo-capable variant on `PropertyTree`s.

use std::collections::HashMap;

use crate::references::reference::{Reference, ReferenceKind};
use crate::references::object_id::ObjectId;
use crate::tree::{EventSource, PropertyTree, ScalarValue, Transaction};

#[derive(Debug, thiserror::Error)]
pub enum ReferencesError {
    #[error("rename cascade needs a PropertyTree for referencing object {0}, but none was supplied")]
    MissingTree(ObjectId),
    #[error("reference site in {0} no longer resolves in its tree - the references are stale, read them again before cascading")]
    StaleSite(ObjectId),
    #[error("failed to patch the reference site in {0}: {1}")]
    Edit(ObjectId, #[source] crate::tree::Error),
}

/// `incoming` are the references that point to `target`. `trees` must hold one `PropertyTree` per
/// referencing object (keyed by `ObjectId`), covering every file the cascade touches.
///
/// `ValueProcessLinkedFile` references are skipped: their site holds a linked-file *path*, not the
/// object's bare name, so renaming an `.aod` object never touches them.
pub fn rename_cascade<S: EventSource>(
    incoming: &[Reference],
    target: &ObjectId,
    new_name: &str,
    trees: &mut HashMap<ObjectId, PropertyTree<S>>,
) -> Result<Transaction, ReferencesError> {
    let mut commands = Vec::new();
    for reference in incoming {
        if reference.kind == ReferenceKind::ValueProcessLinkedFile {
            continue;
        }
        let tree = trees.get_mut(&reference.from).ok_or_else(|| ReferencesError::MissingTree(reference.from.clone()))?;
        let node = tree.node_at(&reference.site).ok_or_else(|| ReferencesError::StaleSite(reference.from.clone()))?;
        let cmd = tree.set_scalar(node, ScalarValue::Text(new_name.to_string())).map_err(|e| ReferencesError::Edit(reference.from.clone(), e))?;
        commands.push(cmd);
    }
    Ok(Transaction::new(format!("Rename {target} to {new_name}"), commands))
}
