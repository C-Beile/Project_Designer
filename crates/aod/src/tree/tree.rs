//! `PropertyTree` - the typed, observable projection layer (architecture.md §3, "Schicht 2").
//!
//! Holds a small arena of nodes (avoids the ownership/lifetime fight of a pointer-linked tree)
//! plus one `EventSource` this projection is bound to. Every mutation follows the same shape:
//! locate the affected span(s) via the `EventSource`, compute the new bytes with `codec`, update
//! the cached `PropertyValue`, notify observers/bus, and hand back a `FileCommand` - the tree
//! itself never writes bytes anywhere (that is `aod-io`/`platform`'s job, out of this round's
//! scope per the role brief).

use crate::tree::codec;
use crate::tree::command::{ByteRange, FileCommand};
use crate::tree::error::Error;
use crate::tree::event_source::EventSource;
use crate::tree::observer::{ChangeBus, ChangeEvent};
use crate::tree::path::NodePath;
use crate::tree::value::{PropertyValue, ScalarValue};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(usize);

struct NodeData {
    path: NodePath,
    value: PropertyValue,
    parent: Option<NodeId>,
    /// (key, child) pairs in document order - key is a field name for object children, or the
    /// stringified index for array children; kept alongside `path` so a delete can locate and
    /// remove the right entry from the parent without re-deriving it.
    children: Vec<NodeId>,
}

type Observer = Box<dyn FnMut(&PropertyValue) + Send>;

pub struct PropertyTree<S: EventSource> {
    source: S,
    file: PathBuf,
    arena: Vec<NodeData>,
    root: NodeId,
    observers: HashMap<NodeId, Vec<Observer>>,
    bus: ChangeBus,
}

impl<S: EventSource> PropertyTree<S> {
    /// Builds a projection from an already-typed value tree. Building that value tree out of a
    /// real `AodDocument` via the JSON schemas (architecture.md §3) is the projector's job -
    /// deferred to the integration round, see `p3-core-model-notes.md`; this constructor is the
    /// seam it will plug into (schema-driven code would just produce the `PropertyValue` this
    /// takes, using the same `EventSource` for span lookups it already needs for editing).
    pub fn from_value(source: S, root_value: PropertyValue) -> Self {
        let file = source.file_path().to_path_buf();
        let mut arena = Vec::new();
        let root = build_node(&mut arena, NodePath::root(), root_value, None);
        PropertyTree { source, file, arena, root, observers: HashMap::new(), bus: ChangeBus::new() }
    }

    pub fn root(&self) -> NodeId {
        self.root
    }

    pub fn file(&self) -> &std::path::Path {
        &self.file
    }

    pub fn source(&self) -> &S {
        &self.source
    }

    pub fn path_of(&self, node: NodeId) -> &NodePath {
        &self.arena[node.0].path
    }

    pub fn value_of(&self, node: NodeId) -> &PropertyValue {
        &self.arena[node.0].value
    }

    pub fn children_of(&self, node: NodeId) -> &[NodeId] {
        &self.arena[node.0].children
    }

    pub fn parent_of(&self, node: NodeId) -> Option<NodeId> {
        self.arena[node.0].parent
    }

    /// Business meaning: find the direct child of an object node by its field name
    /// (e.g. the `entityFields` field under the `entity` root).
    pub fn child_by_field(&self, node: NodeId, name: &str) -> Option<NodeId> {
        self.children_of(node).iter().copied().find(|&c| match self.path_of(c).last() {
            Some(crate::tree::path::PathSegment::Field(f)) => f == name,
            _ => false,
        })
    }

    /// Business meaning: resolve a `NodePath` to its arena id within this tree. Needed by callers
    /// that only know the textual address of a location (e.g. `refs`' rename cascade, which finds
    /// a reference site as a `NodePath` while indexing, then must later re-locate that exact node
    /// in the referencing file's own tree to apply a scalar edit there).
    pub fn node_at(&self, path: &NodePath) -> Option<NodeId> {
        let mut current = self.root;
        for seg in path.segments() {
            current = match seg {
                crate::tree::path::PathSegment::Field(name) => self.child_by_field(current, name)?,
                crate::tree::path::PathSegment::Index(i) => *self.children_of(current).get(*i)?,
            };
        }
        Some(current)
    }

    pub fn subscribe(&mut self) -> std::sync::mpsc::Receiver<ChangeEvent> {
        self.bus.subscribe()
    }

    pub fn observe(&mut self, node: NodeId, callback: impl FnMut(&PropertyValue) + Send + 'static) {
        self.observers.entry(node).or_default().push(Box::new(callback));
    }

    fn notify(&mut self, node: NodeId) {
        let value = self.arena[node.0].value.clone();
        if let Some(callbacks) = self.observers.get_mut(&node) {
            for cb in callbacks {
                cb(&value);
            }
        }
    }

    /// Scalar edit (architecture.md §3, first edit kind): replaces the node's cached value and
    /// computes the targeted `FileCommand` against its `value_span`. Fails with `NotScalar` if
    /// aimed at a structural node - use `insert`/`delete` for those.
    pub fn set_scalar(&mut self, node: NodeId, new_value: ScalarValue) -> Result<FileCommand, Error> {
        let path = self.arena[node.0].path.clone();
        if self.arena[node.0].value.as_scalar().is_none() {
            return Err(Error::NotScalar(path));
        }
        let span = self.source.value_span(&path).ok_or_else(|| Error::UnknownSpan(path.clone()))?;
        let old_bytes = self.source.bytes_in(span);
        let new_bytes = codec::encode_scalar(&new_value);

        self.arena[node.0].value = PropertyValue::Scalar(new_value);
        self.notify(node);
        self.bus.publish(ChangeEvent::ValueChanged { node, path: path.clone() });

        Ok(FileCommand { file: self.file.clone(), old_range: span, old_bytes, new_bytes })
    }

    /// Insert edit (architecture.md §3, second edit kind): adds `value` as a new child field
    /// `name` under `parent`, appended after `after` (or as the last child if `None`).
    pub fn insert(
        &mut self,
        parent: NodeId,
        name: impl Into<String>,
        value: PropertyValue,
        after: Option<NodeId>,
    ) -> Result<(NodeId, FileCommand), Error> {
        let name = name.into();
        let parent_path = self.arena[parent.0].path.clone();
        if self.arena[parent.0].value.as_object().is_none() && self.arena[parent.0].value.as_array().is_none() {
            return Err(Error::NotContainer(parent_path));
        }

        let after_path = after.map(|a| self.arena[a.0].path.clone());
        let at = self
            .source
            .insertion_point(&parent_path, after_path.as_ref())
            .ok_or_else(|| Error::NoInsertionPoint(parent_path.clone()))?;
        let indent = self.source.indent_for(&parent_path);
        let this_indent = codec::indent_exception(&name, &indent).unwrap_or(indent);
        let mut new_bytes = codec::LINE_ENDING.to_vec();
        new_bytes.extend(codec::render_element(&name, &value, &this_indent));

        let child_path = parent_path.field(&name);
        let child = build_node(&mut self.arena, child_path.clone(), value, Some(parent));
        // Splice into the parent's child list at the right position rather than always
        // appending, so document order (aod-format.md §1.2: insertion order, not alphabetical)
        // survives an insert-in-the-middle.
        let insert_at = match after {
            Some(a) => self.arena[parent.0].children.iter().position(|&c| c == a).map(|i| i + 1),
            None => None,
        }
        .unwrap_or(self.arena[parent.0].children.len());
        self.arena[parent.0].children.insert(insert_at, child);

        self.notify(parent);
        self.bus.publish(ChangeEvent::ChildInserted { parent, parent_path, child });

        Ok((child, FileCommand { file: self.file.clone(), old_range: ByteRange::point(at), old_bytes: Vec::new(), new_bytes }))
    }

    /// Delete edit (architecture.md §3, third edit kind): removes the node and its whole subtree,
    /// including its leading whitespace run in the source (`EventSource::element_span`) so no
    /// blank-line artifact is left behind.
    pub fn delete(&mut self, node: NodeId) -> Result<FileCommand, Error> {
        let path = self.arena[node.0].path.clone();
        let parent = self.arena[node.0].parent.ok_or_else(|| Error::NotContainer(path.clone()))?;
        let span = self.source.element_span(&path).ok_or_else(|| Error::UnknownSpan(path.clone()))?;
        let old_bytes = self.source.bytes_in(span);

        self.arena[parent.0].children.retain(|&c| c != node);
        let parent_path = self.arena[parent.0].path.clone();
        self.notify(parent);
        self.bus.publish(ChangeEvent::ChildRemoved { parent, parent_path, removed_path: path });

        Ok(FileCommand { file: self.file.clone(), old_range: span, old_bytes, new_bytes: Vec::new() })
    }
}

fn build_node(arena: &mut Vec<NodeData>, path: NodePath, value: PropertyValue, parent: Option<NodeId>) -> NodeId {
    let id = NodeId(arena.len());
    arena.push(NodeData { path: path.clone(), value: PropertyValue::Scalar(ScalarValue::Bool(false)), parent, children: Vec::new() });

    let children = match &value {
        PropertyValue::Object(fields) => fields
            .iter()
            .map(|(k, v)| build_node(arena, path.field(k), v.clone(), Some(id)))
            .collect(),
        PropertyValue::Array(items) => items
            .iter()
            .enumerate()
            .map(|(i, v)| build_node(arena, path.index(i), v.clone(), Some(id)))
            .collect(),
        PropertyValue::Scalar(_) => Vec::new(),
    };

    arena[id.0].value = value;
    arena[id.0].children = children;
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::testing::InMemoryEventSource;

    fn sample_source() -> InMemoryEventSource {
        // Simulates a tiny entity file:
        // <entity>\r\n  <title>Tour</title>\r\n  <entityFields>\r\n  </entityFields>\r\n</entity>\r\n
        let mut src = InMemoryEventSource::new(
            "entity.aod",
            b"<entity>\r\n  <title>Tour</title>\r\n  <entityFields>\r\n  </entityFields>\r\n</entity>\r\n",
        );
        // "<entity>\r\n  <title>" = 19 bytes before the value; value "Tour" spans [19,23).
        src.register_value(NodePath::root().field("title"), ByteRange::new(19, 23));
        // Element span includes the leading "\r\n  " indentation run (starts right after
        // "<entity>"'s closing '>' at offset 8) through the end of "</title>" at offset 31.
        src.register_element(NodePath::root().field("title"), ByteRange::new(8, 31));
        src.register_indent(NodePath::root().field("entityFields"), b"  ");
        // Right after "<entityFields>"'s closing '>' (offset 49), before "\r\n  </entityFields>".
        src.register_insertion_point(NodePath::root().field("entityFields"), 49);
        src
    }

    fn sample_tree() -> PropertyTree<InMemoryEventSource> {
        let value = PropertyValue::Object(vec![
            ("title".to_string(), PropertyValue::Scalar(ScalarValue::Text("Tour".to_string()))),
            ("entityFields".to_string(), PropertyValue::Object(vec![])),
        ]);
        PropertyTree::from_value(sample_source(), value)
    }

    #[test]
    fn set_scalar_computes_targeted_replace_and_updates_cache() {
        let mut tree = sample_tree();
        let title = tree.child_by_field(tree.root(), "title").unwrap();

        let cmd = tree.set_scalar(title, ScalarValue::Text("Round Trip".to_string())).unwrap();

        assert_eq!(cmd.old_range, ByteRange::new(19, 23));
        assert_eq!(cmd.old_bytes, b"Tour");
        assert_eq!(cmd.new_bytes, b"Round Trip");
        assert_eq!(tree.value_of(title).as_text(), Some("Round Trip"));
    }

    #[test]
    fn set_scalar_on_structural_node_is_rejected() {
        let mut tree = sample_tree();
        let entity_fields = tree.child_by_field(tree.root(), "entityFields").unwrap();
        let err = tree.set_scalar(entity_fields, ScalarValue::Bool(true)).unwrap_err();
        assert!(matches!(err, Error::NotScalar(_)));
    }

    #[test]
    fn insert_appends_child_and_computes_point_insertion_command() {
        let mut tree = sample_tree();
        let entity_fields = tree.child_by_field(tree.root(), "entityFields").unwrap();

        let field = PropertyValue::Object(vec![("name".to_string(), PropertyValue::Scalar(ScalarValue::Text("COUNTRY".to_string())))]);
        let (child, cmd) = tree.insert(entity_fields, "entityField", field, None).unwrap();

        assert!(cmd.old_range.is_empty());
        assert!(cmd.old_bytes.is_empty());
        assert!(String::from_utf8(cmd.new_bytes).unwrap().contains("<entityField>"));
        assert_eq!(tree.children_of(entity_fields), &[child]);
        assert_eq!(tree.value_of(child).field("name").unwrap().as_text(), Some("COUNTRY"));
    }

    #[test]
    fn delete_removes_node_from_parent_and_captures_full_element_span() {
        let mut tree = sample_tree();
        let title = tree.child_by_field(tree.root(), "title").unwrap();

        let cmd = tree.delete(title).unwrap();

        assert_eq!(cmd.old_range, ByteRange::new(8, 31));
        assert!(cmd.new_bytes.is_empty());
        assert!(!tree.children_of(tree.root()).contains(&title));
    }

    #[test]
    fn observer_fires_with_new_value_on_scalar_edit() {
        let mut tree = sample_tree();
        let title = tree.child_by_field(tree.root(), "title").unwrap();

        let seen: std::sync::Arc<std::sync::Mutex<Option<PropertyValue>>> = Default::default();
        let seen_clone = seen.clone();
        tree.observe(title, move |v| {
            *seen_clone.lock().unwrap() = Some(v.clone());
        });

        tree.set_scalar(title, ScalarValue::Text("Changed".to_string())).unwrap();

        assert_eq!(seen.lock().unwrap().as_ref().and_then(|v| v.as_text()), Some("Changed"));
    }

    #[test]
    fn node_at_resolves_a_field_path_to_the_same_id_child_by_field_would_find() {
        let tree = sample_tree();
        let title = tree.child_by_field(tree.root(), "title").unwrap();

        let resolved = tree.node_at(&NodePath::root().field("title"));

        assert_eq!(resolved, Some(title));
        assert_eq!(tree.node_at(&NodePath::root().field("doesNotExist")), None);
    }

    #[test]
    fn change_bus_subscriber_receives_value_changed_event() {
        let mut tree = sample_tree();
        let rx = tree.subscribe();
        let title = tree.child_by_field(tree.root(), "title").unwrap();

        tree.set_scalar(title, ScalarValue::Text("Changed".to_string())).unwrap();

        let evt = rx.try_recv().expect("expected a published ChangeEvent");
        assert!(matches!(evt, ChangeEvent::ValueChanged { node, .. } if node == title));
    }
}
