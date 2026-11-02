//! Patch-level undo primitive (architecture.md §3, ADR-0005 point 2).
//!
//! A `FileCommand` is deliberately the *only* unit of change `core-model` hands upward: it never
//! exposes a tree snapshot. Undo/redo cost is therefore a handful of byte ranges per touched
//! file, not a copy of the project tree - the whole point of the patch-level (not tree-level)
//! design ADR-0005 argues for.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: usize,
    pub end: usize,
}

impl ByteRange {
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "a byte range must not end before it starts");
        ByteRange { start, end }
    }

    /// An empty range at a single offset - the shape an insertion's "old" range takes,
    /// since nothing is being replaced, only added.
    pub fn point(at: usize) -> Self {
        ByteRange { start: at, end: at }
    }

    pub fn len(&self) -> usize {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }
}

/// One targeted byte-range mutation against one file's source document.
///
/// Shape matches architecture.md §3 exactly: `{ file, old_bytes_range, old_bytes, new_bytes }`.
/// All three edit kinds the architecture distinguishes collapse into this one struct:
/// - scalar edit: `old_range` non-empty, `new_bytes` non-empty (replace).
/// - insert: `old_range` empty (a point), `old_bytes` empty, `new_bytes` non-empty.
/// - delete: `old_range` non-empty, `new_bytes` empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileCommand {
    pub file: PathBuf,
    pub old_range: ByteRange,
    pub old_bytes: Vec<u8>,
    pub new_bytes: Vec<u8>,
}

impl FileCommand {
    /// The inverse of this command: applying `old_bytes` back over the range the new bytes now
    /// occupy. This is what undo replays - same byte-range mechanics, opposite direction.
    pub fn inverse(&self) -> FileCommand {
        let new_range = ByteRange::new(self.old_range.start, self.old_range.start + self.new_bytes.len());
        FileCommand {
            file: self.file.clone(),
            old_range: new_range,
            old_bytes: self.new_bytes.clone(),
            new_bytes: self.old_bytes.clone(),
        }
    }
}
