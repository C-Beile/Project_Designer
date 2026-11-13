//! `ProjectHandle`: the minimal, real end-to-end proof that the wiring holds
//! (architecture.md §1 "Datenfluss Edit -> Save", §4 "Persistenzschicht").
//!
//! `open_project` reads a real `.aod` file, parses it with `aod::document::parse`, projects it into a
//! `aod::tree::PropertyTree` via the real `AodDocumentSource` adapter (not
//! `testing::InMemoryEventSource`), and hands back a handle. `set_property` edits the typed tree
//! *and* the underlying document through the same adapter instance (shared via `Rc<RefCell<_>>`
//! so both sides of the edit stay in sync without needing a `PropertyTree::source_mut()` getter -
//! deliberately not added to `aod::tree`'s already-verified `tree.rs`, see this round's
//! integration notes). `save()` re-serializes the live document and writes it through
//! `platform::fs::atomic_write` - the real architecture.md §4 persistence path, not a stand-in.

use aod::tree::command::ByteRange;
use aod::tree::event_source::EventSource;
use aod::tree::path::NodePath;
use aod::tree::tree::PropertyTree;
use aod::tree::value::{PropertyValue, ScalarValue};
use aod::tree::AodDocumentSource;
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

#[derive(Debug, thiserror::Error)]
pub enum ForgeError {
    #[error("failed to read project file {path}: {source}")]
    Read { path: PathBuf, #[source] source: std::io::Error },
    #[error("malformed .aod file {path}: {source}")]
    Xml { path: PathBuf, #[source] source: aod::document::AodError },
    #[error(transparent)]
    Tree(#[from] aod::tree::error::Error),
    #[error(transparent)]
    Adapter(#[from] aod::tree::AdapterError),
    #[error(transparent)]
    Platform(#[from] platform::PlatformError),
    #[error("node at path '{0}' does not exist in this project's tree")]
    NodeNotFound(String),
}

/// A thin `EventSource` forwarder over a shared, ref-counted `AodDocumentSource`. Lets
/// `ProjectHandle` keep its own handle to the same live document the `PropertyTree` reads spans
/// from, so a `set_property` call can update both the typed cache (via `PropertyTree::set_scalar`)
/// and the real document bytes (via `AodDocumentSource::apply_scalar_text_replace`) without
/// either copy drifting out of sync.
#[derive(Clone)]
struct SharedAodSource {
    file: PathBuf,
    inner: Rc<RefCell<AodDocumentSource>>,
}

impl SharedAodSource {
    fn from_rc(inner: Rc<RefCell<AodDocumentSource>>) -> Self {
        let file = inner.borrow().file_path().to_path_buf();
        SharedAodSource { file, inner }
    }
}

impl EventSource for SharedAodSource {
    fn file_path(&self) -> &Path {
        // Cached separately: EventSource::file_path returns &Path tied to &self, which a
        // RefCell::borrow() guard (a temporary) cannot satisfy - see module doc.
        &self.file
    }

    fn value_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.inner.borrow().value_span(path)
    }

    fn element_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.inner.borrow().element_span(path)
    }

    fn bytes_in(&self, range: ByteRange) -> Vec<u8> {
        self.inner.borrow().bytes_in(range)
    }

    fn insertion_point(&self, parent: &NodePath, after: Option<&NodePath>) -> Option<usize> {
        self.inner.borrow().insertion_point(parent, after)
    }

    fn indent_for(&self, parent: &NodePath) -> Vec<u8> {
        self.inner.borrow().indent_for(parent)
    }
}

/// An open project object (one `.aod` file), backed by a real, in-memory `AodDocument` and its
/// typed `PropertyTree` projection.
pub struct ProjectHandle {
    file: PathBuf,
    shared: Rc<RefCell<AodDocumentSource>>,
    tree: PropertyTree<SharedAodSource>,
    /// The file started with a UTF-8 byte order mark. The parser drops it, so `save` writes it back:
    /// opening and saving must not change bytes the user did not touch.
    bom: bool,
}

/// Loads `path`, parses it as a real `.aod` document, and projects it into an editable
/// `ProjectHandle`. Never touches `GitRepos_ADITO` directly - callers are expected to point this
/// at their own copied test fixtures, exactly like every other P3 crate's corpus tests.
pub fn open_project(path: impl Into<PathBuf>) -> Result<ProjectHandle, ForgeError> {
    let file = path.into();
    let raw = std::fs::read(&file).map_err(|source| ForgeError::Read { path: file.clone(), source })?;
    open_project_bytes(file, &raw)
}

/// Like `open_project`, for bytes the caller already read (so a file is read once, not twice).
pub fn open_project_bytes(file: PathBuf, raw: &[u8]) -> Result<ProjectHandle, ForgeError> {
    let bom = raw.starts_with(&[0xEF, 0xBB, 0xBF]);
    let bytes: &[u8] = if bom { &raw[3..] } else { raw };
    let doc = aod::document::parse(bytes).map_err(|source| ForgeError::Xml { path: file.clone(), source })?;

    let adapter = AodDocumentSource::new(file.clone(), doc);
    let root_value = adapter.project();

    let shared = Rc::new(RefCell::new(adapter));
    let source = SharedAodSource::from_rc(shared.clone());
    let tree = PropertyTree::from_value(source, root_value);

    Ok(ProjectHandle { file, shared, tree, bom })
}

impl ProjectHandle {
    pub fn file(&self) -> &Path {
        &self.file
    }

    /// Reads the current (possibly edited, not-yet-saved) typed value at `path`.
    pub fn value_at(&self, path: &NodePath) -> Option<&PropertyValue> {
        let node = self.tree.node_at(path)?;
        Some(self.tree.value_of(node))
    }

    /// Edit-flow entry point (architecture.md §1/§3): updates the typed `PropertyTree` cache
    /// *and* the real underlying `AodDocument` in one call, so `value_at` and a subsequent
    /// `save()` both observe the change. Only the `Text`-content scalar case is wired through to
    /// a real document mutation right now - see `AodDocumentSource`'s module doc for the typed
    /// (`v="..."`) attribute case, which is read-only until `aod::document` grows a matching patch
    /// primitive.
    pub fn set_property(&mut self, path: &NodePath, value: ScalarValue) -> Result<(), ForgeError> {
        let node = self
            .tree
            .node_at(path)
            .ok_or_else(|| ForgeError::NodeNotFound(path.to_string()))?;

        self.tree.set_scalar(node, value.clone())?;

        let new_bytes = aod::tree::codec::encode_scalar(&value);
        self.shared.borrow_mut().apply_scalar_text_replace(path, new_bytes)?;
        Ok(())
    }

    /// Byte range of a scalar's value (text content or the `v="..."` attribute value) in the
    /// current serialized document.
    pub fn value_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.shared.borrow().value_span(path)
    }

    /// Byte range of a whole element including its leading indentation whitespace.
    pub fn element_span(&self, path: &NodePath) -> Option<ByteRange> {
        self.shared.borrow().element_span(path)
    }

    /// Append position inside `parent` (before its closing tag's indentation) and the standard
    /// indentation for a new child there - used when the parent has no child to copy from.
    pub fn append_point(&self, parent: &NodePath) -> Option<(usize, Vec<u8>)> {
        let source = self.shared.borrow();
        let at = source.insertion_point(parent, None)?;
        Some((at, source.indent_for(parent)))
    }

    pub fn serialized_bytes(&self) -> Vec<u8> {
        self.shared.borrow().serialized_bytes().to_vec()
    }

    /// Structural edits the typed tree cannot express in place (setting a typed `v="..."`
    /// attribute, adding a property element that was not in the file yet): the caller computes
    /// the exact byte splice, this re-parses the result and only accepts it if `aod::document` re-emits
    /// it byte for byte, so the file never changes outside the spliced range.
    pub fn splice(&mut self, range: ByteRange, replacement: &[u8]) -> Result<(), ForgeError> {
        let current = self.serialized_bytes();
        if range.start > range.end || range.end > current.len() {
            return Err(ForgeError::NodeNotFound(format!("byte range {}..{}", range.start, range.end)));
        }
        let mut next = Vec::with_capacity(current.len() + replacement.len());
        next.extend_from_slice(&current[..range.start]);
        next.extend_from_slice(replacement);
        next.extend_from_slice(&current[range.end..]);
        self.replace_document(next)
    }

    /// Replaces the whole live document (used by splice and by snapshot-based undo/redo).
    pub fn replace_document(&mut self, bytes: Vec<u8>) -> Result<(), ForgeError> {
        let doc = aod::document::parse(&bytes).map_err(|source| ForgeError::Xml { path: self.file.clone(), source })?;
        if aod::document::serialize(&doc) != bytes {
            return Err(ForgeError::NodeNotFound("edit would not round-trip byte-exactly".to_string()));
        }
        let adapter = AodDocumentSource::new(self.file.clone(), doc);
        let root_value = adapter.project();
        let shared = Rc::new(RefCell::new(adapter));
        let source = SharedAodSource::from_rc(shared.clone());
        self.tree = PropertyTree::from_value(source, root_value);
        self.shared = shared;
        Ok(())
    }

    /// Persistence path (architecture.md §4): re-serializes the live `AodDocument` and writes it
    /// through `platform::fs::atomic_write` - real temp-file-then-rename semantics, not a direct
    /// `std::fs::write`. With no prior `set_property` call this reproduces the P2 spike's proven
    /// "load -> save without edits -> byte-identical" property, now through the full wired path.
    pub fn save(&mut self) -> Result<(), ForgeError> {
        let mut bytes = Vec::new();
        if self.bom {
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        bytes.extend_from_slice(self.shared.borrow().serialized_bytes());
        platform::fs::atomic_write(&self.file, &bytes)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A timestamp alone is not a reliable uniqueness source for two tests in the same process
    // started microseconds apart (observed colliding under `cargo test --workspace` on this
    // machine's clock resolution) - an in-process atomic counter guarantees distinct directories
    // regardless of clock granularity.
    static FIXTURE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn fixture_copy(name: &str) -> PathBuf {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
        let unique = FIXTURE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir()
            .join(format!("designer-core-e2e-{}-{}", std::process::id(), unique));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join(name);
        std::fs::copy(&src, &dest).unwrap();
        dest
    }

    /// The end-to-end proof required by this round's brief: load a real `.aod` fixture -> change
    /// a scalar field through the typed tree -> save -> reload from disk -> the new value is
    /// there. Exercises `EventSource` (real `AodDocumentSource`), the scalar edit flow
    /// (`PropertyTree::set_scalar`), and the persistence path (`platform::fs::atomic_write`) in
    /// one real, on-disk round trip - no mocks anywhere in the chain.
    #[test]
    fn load_edit_save_reload_reflects_the_new_value() {
        let path = fixture_copy("PROJECT_Sales.aod");

        let mut handle = open_project(&path).expect("must open the real fixture");
        let title_path = NodePath::root().field("title");
        assert_eq!(handle.value_at(&title_path).and_then(|v| v.as_text()), Some("Role_Sales"));

        handle
            .set_property(&title_path, ScalarValue::Text("Role_Sales_Changed".to_string()))
            .expect("scalar edit must succeed");
        handle.save().expect("save must succeed");

        let reloaded = open_project(&path).expect("must reopen the saved file");
        assert_eq!(
            reloaded.value_at(&title_path).and_then(|v| v.as_text()),
            Some("Role_Sales_Changed")
        );

        // The edited field's raw bytes on disk must reflect the new value verbatim, proving the
        // write went through the real serialize -> atomic_write path, not just the in-memory cache.
        let on_disk = std::fs::read(&path).unwrap();
        assert!(String::from_utf8_lossy(&on_disk).contains("<title>Role_Sales_Changed</title>"));

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// The structural counterpart the brief calls out explicitly: loading a file and saving it
    /// straight back without any edit must be byte-identical to the original - the core
    /// guarantee from `spike-round-trip.md`/`aod::document`, now proven through the full wired
    /// `open_project`/`save` path instead of `aod::document::round_trip_check` directly.
    #[test]
    fn load_and_save_without_editing_is_byte_identical() {
        let path = fixture_copy("PROJECT_Sales.aod");
        let original = std::fs::read(&path).unwrap();

        let mut handle = open_project(&path).expect("must open the real fixture");
        handle.save().expect("save must succeed");

        let after = std::fs::read(&path).unwrap();
        assert_eq!(after, original, "save without any edit must not change a single byte");

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }
}
