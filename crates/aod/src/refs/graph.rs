//! `RefGraph` (architecture.md §7): the project-wide reference index plus its three operations -
//! incremental indexing, rename cascade, and delete diagnostics.

use std::collections::HashMap;

use crate::tree::{EventSource, NodePath, PropertyTree, PropertyValue, ScalarValue, Transaction};

use crate::refs::edge::{Edge, RefKind};
use crate::refs::extract;
use crate::refs::object_id::ObjectId;

#[derive(Debug, thiserror::Error)]
pub enum RefsError {
    #[error("rename cascade needs a PropertyTree for referencing object {0}, but none was supplied")]
    MissingTree(ObjectId),
    #[error("reference site in {0} no longer resolves in its tree - the graph index is stale, reindex before cascading")]
    StaleSite(ObjectId),
    #[error("failed to patch the reference site in {0}: {1}")]
    Edit(ObjectId, #[source] crate::tree::Error),
}

/// One still-standing incoming reference, reported instead of auto-cascaded on delete
/// (architecture.md §7: "kein automatisches Kaskadenlöschen").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub referencing_object: ObjectId,
    pub site: NodePath,
    pub kind: RefKind,
}

/// The project-wide reference graph. Nodes are implicit (any `ObjectId` that appears as an edge
/// endpoint); what is stored is the edge set, indexed both ways so both "what does X depend on"
/// and "what would break if X changed" (architecture.md §7's rename/delete flows) are O(edges of
/// X), not a full scan.
#[derive(Debug, Default)]
pub struct RefGraph {
    outgoing: HashMap<ObjectId, Vec<Edge>>,
    incoming: HashMap<ObjectId, Vec<Edge>>,
    /// `aliasDefDb.targetAliasName` short value -> the Alias object that declares it. Populated by
    /// `register_alias_target_name`, consulted while indexing `dbRecordContainer.alias` edges -
    /// the documented special case (aod-format.md §4 row 4) where the reference target is *not*
    /// the literal alias object name.
    alias_by_target_name: HashMap<String, ObjectId>,
}

impl RefGraph {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers an Alias object's short `targetAliasName` so `dbRecordContainer.alias` edges
    /// elsewhere resolve to it. Must run before (or be re-run alongside) indexing any object that
    /// references it - see `extract::extract_edges`' doc comment on the ordering consequence of
    /// an unresolved alias.
    pub fn register_alias_target_name(&mut self, alias: ObjectId, target_alias_name: impl Into<String>) {
        self.alias_by_target_name.insert(target_alias_name.into(), alias);
    }

    /// Convenience for the common case: reads `aliasDefDb.targetAliasName` off the alias's own
    /// root value and registers it, then indexes the alias object's own (typically empty)
    /// outgoing edges, in one call.
    pub fn index_alias(&mut self, alias: ObjectId, root: &PropertyValue) {
        if let Some(target_name) = extract::target_alias_name(root) {
            self.register_alias_target_name(alias.clone(), target_name);
        }
        self.index(alias, root);
    }

    /// Initial or incremental indexing of one object's outgoing edges (architecture.md §7:
    /// "Aufbau" runs this once per object at load; "inkrementelle Pflege" reruns it for just the
    /// touched file on save - both are this same replace-outgoing-for-this-object operation, so
    /// there is only one method).
    pub fn index(&mut self, id: ObjectId, root: &PropertyValue) {
        self.remove_outgoing(&id);
        // Snapshot the alias map rather than borrowing it: `index` needs to add to `self.incoming`
        // and `self.outgoing` while resolving, and this crate favours the simple ownership over
        // fighting the borrow checker for a HashMap that is small (one entry per Alias object).
        let alias_map = self.alias_by_target_name.clone();
        let edges = extract::extract_edges(&id, root, &|name| alias_map.get(name).cloned());
        for edge in &edges {
            self.incoming.entry(edge.to.clone()).or_default().push(edge.clone());
        }
        self.outgoing.insert(id, edges);
    }

    fn remove_outgoing(&mut self, id: &ObjectId) {
        if let Some(old_edges) = self.outgoing.remove(id) {
            for edge in old_edges {
                if let Some(list) = self.incoming.get_mut(&edge.to) {
                    list.retain(|e| e != &edge);
                }
            }
        }
    }

    pub fn incoming(&self, target: &ObjectId) -> &[Edge] {
        self.incoming.get(target).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn outgoing(&self, id: &ObjectId) -> &[Edge] {
        self.outgoing.get(id).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Rename cascade (architecture.md §7): every incoming bare-name reference to `target` is
    /// rewritten to `new_name` and bundled into one `Transaction` - atomic, one undo step. `trees`
    /// must hold one `PropertyTree` per referencing object (keyed by `ObjectId`), covering every
    /// file the cascade touches - in production these are the already-open/loaded projections;
    /// the tests use `crate::tree::testing::InMemoryEventSource`-backed ones as the "multiple
    /// simulated files" fixture.
    ///
    /// `ValueProcessLinkedFile` edges are skipped: their site holds a linked-file *path*, not the
    /// object's bare name, so renaming an `.aod` object never touches them - that edge kind only
    /// matters for the separate "rename/move a linked file" flow architecture.md §7 calls out.
    pub fn rename_cascade<S: EventSource>(
        &self,
        target: &ObjectId,
        new_name: &str,
        trees: &mut HashMap<ObjectId, PropertyTree<S>>,
    ) -> Result<Transaction, RefsError> {
        let mut commands = Vec::new();
        for edge in self.incoming(target) {
            if edge.kind == RefKind::ValueProcessLinkedFile {
                continue;
            }
            let tree = trees.get_mut(&edge.from).ok_or_else(|| RefsError::MissingTree(edge.from.clone()))?;
            let node = tree.node_at(&edge.site).ok_or_else(|| RefsError::StaleSite(edge.from.clone()))?;
            let cmd = tree
                .set_scalar(node, ScalarValue::Text(new_name.to_string()))
                .map_err(|e| RefsError::Edit(edge.from.clone(), e))?;
            commands.push(cmd);
        }
        Ok(Transaction::new(format!("Rename {target} to {new_name}"), commands))
    }

    /// Delete diagnostics (architecture.md §7): reports every reference that would be left
    /// dangling, without touching the graph or any file - no cascade happens here, the caller
    /// (the `Action` layer) is the one that decides whether to require confirmation or abort.
    pub fn delete_diagnostics(&self, target: &ObjectId) -> Vec<Diagnostic> {
        self.incoming(target)
            .iter()
            .map(|edge| Diagnostic { referencing_object: edge.from.clone(), site: edge.site.clone(), kind: edge.kind })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::refs::object_id::ObjectKind;
    use crate::tree::ScalarValue;

    fn text(s: &str) -> PropertyValue {
        PropertyValue::Scalar(ScalarValue::Text(s.to_string()))
    }

    fn obj(fields: Vec<(&str, PropertyValue)>) -> PropertyValue {
        PropertyValue::Object(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    #[test]
    fn index_wires_up_incoming_and_outgoing_for_a_neon_context_reference() {
        let mut graph = RefGraph::new();
        let view = ObjectId::view("THHIT_TourFilter_view");
        let entity = ObjectId::entity("THHIT_Tour_entity");
        let root = obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]);

        graph.index(view.clone(), &root);

        assert_eq!(graph.outgoing(&view).len(), 1);
        assert_eq!(graph.incoming(&entity).len(), 1);
        assert_eq!(graph.incoming(&entity)[0].from, view);
        assert!(graph.incoming(&view).is_empty(), "nothing references the view itself in this fixture");
    }

    #[test]
    fn reindexing_an_object_drops_its_stale_outgoing_edges() {
        let mut graph = RefGraph::new();
        let view = ObjectId::view("THHIT_TourFilter_view");
        let old_entity = ObjectId::entity("THHIT_Tour_entity");
        let new_entity = ObjectId::entity("THHIT_Fahrt_entity");

        graph.index(view.clone(), &obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]));
        assert_eq!(graph.incoming(&old_entity).len(), 1);

        // Simulates the "inkrementelle Pflege" case: the view's own content changed (edited to
        // point at a different entity) and gets reindexed - old edges must not linger.
        graph.index(view.clone(), &obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Fahrt_entity"))]))]));

        assert!(graph.incoming(&old_entity).is_empty(), "stale edge to the old target must be gone");
        assert_eq!(graph.incoming(&new_entity).len(), 1);
    }

    #[test]
    fn db_record_container_alias_resolves_once_the_alias_is_indexed_first() {
        let mut graph = RefGraph::new();
        let alias = ObjectId::new(ObjectKind::Alias, "THHIT_Data_alias");
        let entity = ObjectId::entity("THHIT_Tour_entity");

        graph.index_alias(alias.clone(), &obj(vec![("aliasDefDb", obj(vec![("targetAliasName", text("Data_alias"))]))]));
        graph.index(entity.clone(), &obj(vec![("dbRecordContainer", obj(vec![("alias", text("Data_alias"))]))]));

        assert_eq!(graph.incoming(&alias).len(), 1, "the edge must land on the alias's real ObjectId");
        assert_eq!(graph.incoming(&entity).len(), 0);
    }

    #[test]
    fn delete_diagnostics_reports_incoming_edges_without_removing_them() {
        let mut graph = RefGraph::new();
        let view_a = ObjectId::view("THHIT_TourFilter_view");
        let view_b = ObjectId::view("THHIT_TourDetail_view");
        let entity = ObjectId::entity("THHIT_Tour_entity");

        graph.index(view_a.clone(), &obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]));
        graph.index(view_b.clone(), &obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]));

        let diagnostics = graph.delete_diagnostics(&entity);

        assert_eq!(diagnostics.len(), 2, "delete must report every remaining reference, not cascade past the first");
        let referencers: Vec<_> = diagnostics.iter().map(|d| d.referencing_object.clone()).collect();
        assert!(referencers.contains(&view_a));
        assert!(referencers.contains(&view_b));
        // No cascade side effect: the graph itself is untouched by asking for diagnostics.
        assert_eq!(graph.incoming(&entity).len(), 2);
    }
}
