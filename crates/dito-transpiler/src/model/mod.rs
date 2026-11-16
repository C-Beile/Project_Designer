// Das Modell im Speicher: ein Baum als Arena (`Vec<Node>`, Kinder als Index-Listen; C#: `List<Node>` mit `int ParentId`).
// Texte und Attribute bleiben rohe Bytes, so wie in der Datei (schon maskiert). Der Writer eines Formats macht daraus Bytes.

pub mod parse;
pub mod tree;
pub mod write;

pub use tree::{Document, Node, NodeId};
