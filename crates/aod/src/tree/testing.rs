//! An in-memory `EventSource` test double.
//!
//! Not gated behind `#[cfg(test)]` - `refs`'s own tests (a separate crate) need a working
//! `EventSource` to exercise rename-cascade patch computation without waiting on `aod::document`, and
//! `#[cfg(test)]` items are never visible to a downstream crate. This module is the deliberate,
//! documented stand-in for the real `aod::document`-backed implementation the integration round wires
//! in later (see event_source.rs doc comment) - it is not meant for production use.

use crate::tree::command::{ByteRange, FileCommand};
use crate::tree::event_source::EventSource;
use crate::tree::path::NodePath;
use crate::tree::transaction::Transaction;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct InMemoryEventSource {
    file: PathBuf,
    buffer: Vec<u8>,
    value_spans: HashMap<NodePath, ByteRange>,
    element_spans: HashMap<NodePath, ByteRange>,
    insertion_points: HashMap<NodePath, usize>,
    indents: HashMap<NodePath, Vec<u8>>,
}

impl InMemoryEventSource {
    pub fn new(file: impl Into<PathBuf>, buffer: impl Into<Vec<u8>>) -> Self {
        InMemoryEventSource {
            file: file.into(),
            buffer: buffer.into(),
            value_spans: HashMap::new(),
            element_spans: HashMap::new(),
            insertion_points: HashMap::new(),
            indents: HashMap::new(),
        }
    }

    pub fn buffer(&self) -> &[u8] {
        &self.buffer
    }

    pub fn register_value(&mut self, path: NodePath, range: ByteRange) {
        self.value_spans.insert(path, range);
    }

    pub fn register_element(&mut self, path: NodePath, range: ByteRange) {
        self.element_spans.insert(path, range);
    }

    pub fn register_indent(&mut self, path: NodePath, indent: &[u8]) {
        self.indents.insert(path, indent.to_vec());
    }

    /// Registers where a new child should be spliced in when appended as the last child of
    /// `parent`. This fixture only supports the append case (`after: None`); a hint-aware
    /// implementation is `aod::document`'s concern once the real event index exists.
    pub fn register_insertion_point(&mut self, parent: NodePath, at: usize) {
        self.insertion_points.insert(parent, at);
    }

    /// Splices `command` into the buffer and re-bases every registered span/insertion point that
    /// starts at or after the edited range, so a second edit computed *after* this one lands on
    /// correct offsets - the same bookkeeping a real document/index would need to do.
    pub fn apply(&mut self, command: &FileCommand) {
        let ByteRange { start, end } = command.old_range;
        self.buffer.splice(start..end, command.new_bytes.iter().copied());
        let delta = command.new_bytes.len() as isize - (end - start) as isize;
        let rebase = |r: &mut ByteRange| {
            if r.start >= end {
                r.start = (r.start as isize + delta) as usize;
                r.end = (r.end as isize + delta) as usize;
            }
        };
        for r in self.value_spans.values_mut() {
            rebase(r);
        }
        for r in self.element_spans.values_mut() {
            rebase(r);
        }
        for at in self.insertion_points.values_mut() {
            if *at >= end {
                *at = (*at as isize + delta) as usize;
            }
        }
    }

    pub fn apply_transaction(&mut self, tx: &Transaction) {
        for cmd in &tx.commands {
            self.apply(cmd);
        }
    }
}

impl EventSource for InMemoryEventSource {
    fn file_path(&self) -> &Path {
        &self.file
    }

    fn value_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.value_spans.get(path).copied()
    }

    fn element_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.element_spans.get(path).copied()
    }

    fn bytes_in(&self, range: ByteRange) -> Vec<u8> {
        self.buffer[range.start..range.end].to_vec()
    }

    fn insertion_point(&self, parent: &NodePath, _after: Option<&NodePath>) -> Option<usize> {
        self.insertion_points.get(parent).copied()
    }

    fn indent_for(&self, parent: &NodePath) -> Vec<u8> {
        self.indents.get(parent).cloned().unwrap_or_else(|| b"  ".to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::path::NodePath;

    #[test]
    fn apply_rebases_later_spans_after_a_length_changing_edit() {
        let mut src = InMemoryEventSource::new("f.aod", b"<a>1</a><b>2</b>".to_vec());
        let a_path = NodePath::root().field("a");
        let b_path = NodePath::root().field("b");
        src.register_value(a_path.clone(), ByteRange::new(3, 4));
        src.register_value(b_path.clone(), ByteRange::new(11, 12));

        // Replace "1" with "100" - grows the buffer by 2 bytes before b's span.
        src.apply(&FileCommand {
            file: PathBuf::from("f.aod"),
            old_range: ByteRange::new(3, 4),
            old_bytes: b"1".to_vec(),
            new_bytes: b"100".to_vec(),
        });

        assert_eq!(src.buffer(), b"<a>100</a><b>2</b>");
        assert_eq!(src.value_span(&b_path), Some(ByteRange::new(13, 14)));
    }
}
