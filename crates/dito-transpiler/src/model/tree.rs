// Arena-Baum. Ein Element hat entweder Kinder oder Text (oder nichts). Gemischter Inhalt wird beim Lesen abgelehnt.

pub type NodeId = u32;

#[derive(Debug, Clone, Default)]
pub struct Node {
    pub tag: Vec<u8>,
    /// Name und Wert, roh (Wert schon maskiert), in Dateireihenfolge.
    pub attrs: Vec<(Vec<u8>, Vec<u8>)>,
    /// Text, roh und maskiert. `None`: kein Text.
    pub text: Option<Vec<u8>>,
    pub children: Vec<NodeId>,
    pub parent: Option<NodeId>,
}

#[derive(Debug, Clone)]
pub struct Document {
    nodes: Vec<Node>,
    pub root: NodeId,
}

impl Document {
    pub fn new(root: Node) -> Self {
        Self { nodes: vec![root], root: 0 }
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }

    pub fn node_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id as usize]
    }

    /// Hängt `node` als letztes Kind an `parent`.
    pub fn append(&mut self, parent: NodeId, mut node: Node) -> NodeId {
        node.parent = Some(parent);
        let id = self.nodes.len() as NodeId;
        self.nodes.push(node);
        self.nodes[parent as usize].children.push(id);
        id
    }

    /// Hängt `node` an `parent` an Position `index` (0 = erstes Kind).
    pub fn insert(&mut self, parent: NodeId, index: usize, mut node: Node) -> NodeId {
        node.parent = Some(parent);
        let id = self.nodes.len() as NodeId;
        self.nodes.push(node);
        let at = index.min(self.nodes[parent as usize].children.len());
        self.nodes[parent as usize].children.insert(at, id);
        id
    }

    /// Löst `id` aus seinem Elternknoten. Der Knoten bleibt in der Arena (Ids bleiben gültig).
    pub fn detach(&mut self, id: NodeId) {
        if let Some(p) = self.nodes[id as usize].parent.take() {
            self.nodes[p as usize].children.retain(|c| *c != id);
        }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// Erstes Kind mit diesem Tag.
    pub fn child_by_tag(&self, parent: NodeId, tag: &[u8]) -> Option<NodeId> {
        self.node(parent).children.iter().copied().find(|c| self.node(*c).tag == tag)
    }

    /// Text des ersten Kindes mit diesem Tag.
    pub fn child_text(&self, parent: NodeId, tag: &[u8]) -> Option<&[u8]> {
        self.child_by_tag(parent, tag).and_then(|c| self.node(c).text.as_deref())
    }

    /// Kopiert den Teilbaum unter `from` aus `other` als Kind von `parent` in diesen Baum.
    pub fn copy_subtree(&mut self, parent: NodeId, other: &Document, from: NodeId) -> NodeId {
        let src = other.node(from);
        let id = self.append(parent, Node { tag: src.tag.clone(), attrs: src.attrs.clone(), text: src.text.clone(), children: Vec::new(), parent: None });
        for child in &src.children {
            self.copy_subtree(id, other, *child);
        }
        id
    }
}
