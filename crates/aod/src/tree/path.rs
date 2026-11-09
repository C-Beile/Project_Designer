//! Addressing scheme for locations inside a projected `.aod` object.
//!
//! A `NodePath` names one node in the `PropertyTree` projection the same way it names the
//! corresponding location in the source document's event index (architecture.md §3): a chain
//! of field names, with an index step wherever a repeatable element (`entityField`,
//! `dbRecordContainer`, ...) is addressed. This is the coordinate system that both
//! `PropertyTree` and `EventSource` speak, so a mutation computed against the typed tree can be
//! translated into a byte-range patch against the raw document without any other shared state.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSegment {
    /// A named field, e.g. the `entityFields` step in `entityFields.entityField[2].name`.
    Field(String),
    /// The index of one element inside a repeatable field, e.g. the `2` above.
    Index(usize),
}

impl fmt::Display for PathSegment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathSegment::Field(name) => write!(f, "{name}"),
            PathSegment::Index(i) => write!(f, "[{i}]"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct NodePath(Vec<PathSegment>);

impl NodePath {
    pub fn root() -> Self {
        NodePath(Vec::new())
    }

    pub fn segments(&self) -> &[PathSegment] {
        &self.0
    }

    /// Business meaning: address a named child field of an object node
    /// (e.g. going from the `entity` root to its `entityFields` field).
    pub fn field(&self, name: impl Into<String>) -> NodePath {
        let mut next = self.0.clone();
        next.push(PathSegment::Field(name.into()));
        NodePath(next)
    }

    /// Business meaning: address one element of a repeatable field by position
    /// (e.g. the third `entityField` under `entityFields`).
    pub fn index(&self, i: usize) -> NodePath {
        let mut next = self.0.clone();
        next.push(PathSegment::Index(i));
        NodePath(next)
    }

    pub fn parent(&self) -> Option<NodePath> {
        if self.0.is_empty() {
            None
        } else {
            Some(NodePath(self.0[..self.0.len() - 1].to_vec()))
        }
    }

    pub fn last(&self) -> Option<&PathSegment> {
        self.0.last()
    }

    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Display for NodePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.0.is_empty() {
            return write!(f, "$");
        }
        for (i, seg) in self.0.iter().enumerate() {
            match seg {
                PathSegment::Field(_) if i > 0 => write!(f, ".{seg}")?,
                PathSegment::Field(_) => write!(f, "{seg}")?,
                PathSegment::Index(_) => write!(f, "{seg}")?,
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_matches_dotted_indexed_convention() {
        let p = NodePath::root()
            .field("entityFields")
            .field("entityField")
            .index(2)
            .field("valueProcess");
        assert_eq!(p.to_string(), "entityFields.entityField[2].valueProcess");
    }

    #[test]
    fn parent_strips_last_segment() {
        let p = NodePath::root().field("a").field("b");
        assert_eq!(p.parent().unwrap(), NodePath::root().field("a"));
        assert_eq!(NodePath::root().parent(), None);
    }
}
