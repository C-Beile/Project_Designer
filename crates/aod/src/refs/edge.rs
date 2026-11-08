//! Typed reference kinds from the verified catalogue (aod-format.md §4) that `refs::extract`
//! knows how to pull out of a `PropertyTree` projection, and the `Edge` shape the graph stores.

use core_model::NodePath;

use crate::object_id::ObjectId;

/// One documented reference type from aod-format.md §4. Kept as a closed enum (rather than a
/// free-form string tag) so a new extractor is a compiler-checked match arm, not a typo-prone
/// string constant - and so `RefGraph::rename_cascade` can reason about which kinds are safe to
/// rewrite in place (a bare-name scalar) versus which need different handling later (linked-file
/// paths, architecture.md §7 last bullet).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefKind {
    /// `neonContext.entity` -> Entity.
    NeonContextEntity,
    /// `neonContext.{filterView,editView,previewView}` / `neonViewReference.view` -> View.
    ViewReference,
    /// `entityConsumer.dependency.entityName` -> Entity (the sibling `.fieldName` names a field
    /// on that entity, not a separate node - not modelled as its own edge).
    EntityConsumerDependency,
    /// `dbRecordContainer.alias` -> Alias, resolved through the alias's own `targetAliasName`
    /// (aod-format.md §4 row 4's documented special case) rather than the literal alias object
    /// name - see `crate::extract` for the resolution.
    DbRecordContainerAlias,
    /// `entityField.valueProcess` / `.displayValueProcess` -> a linked `.js` file.
    ValueProcessLinkedFile,
}

/// One outgoing reference, as extracted from `from`'s `PropertyTree` at `site`.
///
/// `site` is the `NodePath` of the scalar node that *holds* the reference text inside `from`'s
/// own tree - this is what a rename cascade re-locates (via `PropertyTree::node_at`) to compute
/// the patch `FileCommand` for that file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edge {
    pub from: ObjectId,
    pub to: ObjectId,
    pub kind: RefKind,
    pub site: NodePath,
}
