use crate::tree::path::NodePath;
use crate::tree::tree::NodeId;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("node {0:?} does not exist in this tree")]
    NodeNotFound(NodeId),
    #[error("node at {0} is not a scalar - cannot apply a scalar edit")]
    NotScalar(NodePath),
    #[error("node at {0} is not a container - cannot insert/remove a child")]
    NotContainer(NodePath),
    #[error("the event source has no span registered for path {0} - it may not exist in the source document yet")]
    UnknownSpan(NodePath),
    #[error("the event source could not determine an insertion point under {0}")]
    NoInsertionPoint(NodePath),
}
