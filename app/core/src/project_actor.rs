//! Owns every open `forge_core::ProjectHandle` on one dedicated thread.
//!
//! **Why an actor thread, not `Mutex<HashMap<_, ProjectHandle>>` in Tauri-managed state:**
//! `ProjectHandle` holds an `Rc<RefCell<AodDocumentSource>>` (see `forge-core/src/project.rs` -
//! deliberate, to share the live document between the tree and the write-back path without a
//! `core-model` change). `Rc` is `!Send`, so `ProjectHandle` cannot live in `tauri::State`, which
//! requires `Send + Sync` for anything `.manage()`d. Rather than work around that inside
//! `forge-core` (out of scope - `forge-core` is a dependency, not something this agent edits),
//! all `ProjectHandle`s are kept on one thread that never moves them; every Tauri command talks
//! to that thread over an `mpsc` channel of small, `Send` request/reply structs. This is also
//! exactly the "long operations off the UI thread" shape architecture.md §5 describes for other
//! background work (transpiler, indexing) - here applied to project I/O for a structural reason
//! (`Send`) rather than a latency one, but the same pattern.

use crate::catalog::sheet::{self, NavNode, PropertySheet};
use crate::catalog::Catalog;
use crate::history::{EditEntry, EditHistory, HistoryItem};
use crate::tree::{ensure_writable, list_tree_children, object_type_for_leaf_path, resolve_leaf_path, scan_project_tree, TreeNode};
use crate::wire::{parse_node_path, WireValue};
use core_model::path::NodePath;
use core_model::value::PropertyValue as CoreValue;
use forge_core::ProjectHandle;
use plugin_kernel::types::Diagnostic;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;

/// `object_type`-indexed dispatch table for `list_diagnostics`, analogous to `tree.rs`'s
/// `OBJECT_FOLDERS`. Replaces this function's previous hard-wired call to the two entity
/// validators (see `p4-editor-entity-notes.md` §2/§5, the deliberately deferred generalisation -
/// this is the "first team building a second validator family" the note asked to do it).
/// Extend this table, not `list_diagnostics`'s body, to add a new object type's validators - each
/// entry owns its own flatten+registry+validate_project internally (see
/// `entity_validators::diagnostics_for` / `view_context_dashboard_validators::*_diagnostics_for`).
pub const VALIDATORS_BY_OBJECT_TYPE: &[(&str, fn(&CoreValue) -> Vec<Diagnostic>)] = &[
    ("entity", crate::entity_validators::diagnostics_for),
    ("neonView", crate::view_context_dashboard_validators::view_diagnostics_for),
    ("neonContext", crate::view_context_dashboard_validators::context_diagnostics_for),
    ("neonDashboard", crate::view_context_dashboard_validators::dashboard_diagnostics_for),
    ("aliasDefinition", crate::alias_validators::diagnostics_for),
    ("language", crate::language_validators::diagnostics_for),
    ("system", crate::system_validators::diagnostics_for),
    ("preferences", crate::preferences_validators::diagnostics_for),
    ("application", crate::application_validators::diagnostics_for),
    ("entityWebservice", crate::webservice_validators::diagnostics_for),
    ("report", crate::report_validators::diagnostics_for),
];

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticDto {
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UndoRedoOutcome {
    pub tree: WireValue,
    pub can_undo: bool,
    pub can_redo: bool,
}

/// Raw `.aod` text of an open object as the Source tab shows it. `text` includes unsaved edits.
#[derive(Debug, Clone, Serialize)]
pub struct SourceDto {
    pub text: String,
    pub read_only: bool,
}

type Reply<T> = Sender<Result<T, String>>;

enum Request {
    ScanTree { project_root: PathBuf, reply: Reply<Vec<TreeNode>> },
    TreeChildren { node_id: String, reply: Reply<Vec<TreeNode>> },
    GetPropertyTree { node_id: String, reply: Reply<WireValue> },
    SetProperty { node_id: String, path: String, value: WireValue, reply: Reply<WireValue> },
    Undo { node_id: String, reply: Reply<UndoRedoOutcome> },
    Redo { node_id: String, reply: Reply<UndoRedoOutcome> },
    Save { node_id: String, force: bool, reply: Reply<()> },
    ExternalChanges { node_ids: Vec<String>, reply: Reply<Vec<String>> },
    Reload { node_id: String, reply: Reply<()> },
    ListDiagnostics { node_id: String, reply: Reply<Vec<DiagnosticDto>> },
    GetSheet { node_id: String, path: String, catalog: Option<Arc<Catalog>>, reply: Reply<PropertySheet> },
    GetNavigator { node_id: String, reply: Reply<Vec<NavNode>> },
    SetSheetProperty { node_id: String, path: String, name: String, value: WireValue, typed: bool, reply: Reply<UndoRedoOutcome> },
    RemoveSheetProperty { node_id: String, path: String, name: String, reply: Reply<UndoRedoOutcome> },
    GetSource { node_id: String, reply: Reply<SourceDto> },
    SetSource { node_id: String, text: String, reply: Reply<UndoRedoOutcome> },
    EnableModification { node_id: String, project_root: PathBuf, reply: Reply<()> },
    SetModificationProperty { node_id: String, path: String, name: String, value: WireValue, typed: bool, kind: String, reply: Reply<ModificationOutcome> },
    SetModificationScript { node_id: String, path: String, name: String, content: String, reply: Reply<ModificationOutcome> },
    DiscardModification { project_root: PathBuf, dir: String, reply: Reply<()> },
    ResetProperty { node_id: String, path: String, name: String, reply: Reply<ResetOutcome> },
    ResetElement { node_id: String, path: String, reply: Reply<ResetOutcome> },
    ActivateMapping { node_id: String, path: String, reply: Reply<ActivateOutcome> },
}

/// Result of activating a grey Navigator entry: the path of the new element and the changed tree; a
/// module object additionally reports the modification file.
#[derive(Debug, Clone, Serialize)]
pub struct ActivateOutcome {
    pub path: String,
    pub tree: UndoRedoOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modification: Option<ModificationOutcome>,
}

/// Result of Set to Default: the new tree for a change in the object's own file, and what happened to
/// the project's modification files for a module object.
#[derive(Debug, Clone, Serialize)]
pub struct ResetOutcome {
    pub tree: UndoRedoOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modification: Option<ModificationOutcome>,
}

/// Result of one edit of a module object: what happened to the project's modification files.
pub type ModificationOutcome = crate::modification_write::Outcome;

/// Handle Tauri-managed state holds: just a channel sender, which *is* `Send + Sync`
/// (`Sender<Request>` is `Send` because `Request` is `Send`; wrapping in a `Mutex` makes the
/// handle `Sync` too, satisfying `tauri::State`'s bound without touching `forge-core`).
#[derive(Clone)]
pub struct ProjectActorHandle {
    tx: Sender<Request>,
}

impl ProjectActorHandle {
    pub fn spawn() -> Self {
        let (tx, rx) = channel::<Request>();
        thread::Builder::new()
            .name("forge-project-actor".into())
            .spawn(move || run(rx))
            .expect("failed to spawn the project actor thread");
        ProjectActorHandle { tx }
    }

    fn call<T>(&self, build: impl FnOnce(Reply<T>) -> Request) -> Result<T, String> {
        let (reply_tx, reply_rx) = channel();
        self.tx
            .send(build(reply_tx))
            .map_err(|_| "project actor thread is gone".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "project actor thread dropped the reply channel".to_string())?
    }

    pub fn scan_tree(&self, project_root: PathBuf) -> Result<Vec<TreeNode>, String> {
        self.call(|reply| Request::ScanTree { project_root, reply })
    }

    pub fn tree_children(&self, node_id: String) -> Result<Vec<TreeNode>, String> {
        self.call(|reply| Request::TreeChildren { node_id, reply })
    }

    pub fn get_property_tree(&self, node_id: String) -> Result<WireValue, String> {
        self.call(|reply| Request::GetPropertyTree { node_id, reply })
    }

    pub fn set_property(&self, node_id: String, path: String, value: WireValue) -> Result<WireValue, String> {
        self.call(|reply| Request::SetProperty { node_id, path, value, reply })
    }

    /// Property sheet of the element at `path` (`$` = the object itself), resolved against the
    /// Designer's property catalog when one is available.
    pub fn property_sheet(&self, node_id: String, path: String, catalog: Option<Arc<Catalog>>) -> Result<PropertySheet, String> {
        self.call(|reply| Request::GetSheet { node_id, path, catalog, reply })
    }

    pub fn navigator(&self, node_id: String) -> Result<Vec<NavNode>, String> {
        self.call(|reply| Request::GetNavigator { node_id, reply })
    }

    /// Sets property `name` of the element at `path`, also when it is not in the file yet or is
    /// stored as a typed `v="..."` attribute (`typed` decides the form of a new element).
    pub fn set_sheet_property(&self, node_id: String, path: String, name: String, value: WireValue, typed: bool) -> Result<UndoRedoOutcome, String> {
        self.call(|reply| Request::SetSheetProperty { node_id, path, name, value, typed, reply })
    }

    /// Removes property `name` of the element at `path` again (clearing a value in the Properties
    /// panel); only the element's own line leaves the file.
    pub fn remove_sheet_property(&self, node_id: String, path: String, name: String) -> Result<UndoRedoOutcome, String> {
        self.call(|reply| Request::RemoveSheetProperty { node_id, path, name, reply })
    }

    /// Raw document text of the object, including edits not saved yet.
    pub fn get_source(&self, node_id: String) -> Result<SourceDto, String> {
        self.call(|reply| Request::GetSource { node_id, reply })
    }

    /// Replaces the whole document with `text`. Rejected (document unchanged) when the text is
    /// not well-formed or would not be re-emitted byte for byte; otherwise one undo step.
    pub fn set_source(&self, node_id: String, text: String) -> Result<UndoRedoOutcome, String> {
        self.call(|reply| Request::SetSource { node_id, text, reply })
    }

    /// Switches a module object into modification mode: its edits are written as modifications of
    /// the project (nothing is written until the first edit).
    pub fn enable_modification(&self, node_id: String, project_root: PathBuf) -> Result<(), String> {
        self.call(|reply| Request::EnableModification { node_id, project_root, reply })
    }

    pub fn set_modification_property(&self, node_id: String, path: String, name: String, value: WireValue, typed: bool, kind: String) -> Result<ModificationOutcome, String> {
        self.call(|reply| Request::SetModificationProperty { node_id, path, name, value, typed, kind, reply })
    }

    pub fn set_modification_script(&self, node_id: String, path: String, name: String, content: String) -> Result<ModificationOutcome, String> {
        self.call(|reply| Request::SetModificationScript { node_id, path, name, content, reply })
    }

    /// Set to Default of one property: removes it from the file, or deletes the project's modification of it.
    pub fn reset_property(&self, node_id: String, path: String, name: String) -> Result<ResetOutcome, String> {
        self.call(|reply| Request::ResetProperty { node_id, path, name, reply })
    }

    /// Activates a grey Navigator entry: creates its mapping without setting any property.
    pub fn activate_mapping(&self, node_id: String, path: String) -> Result<ActivateOutcome, String> {
        self.call(|reply| Request::ActivateMapping { node_id, path, reply })
    }

    /// Set to Default of one element (for example a field mapping): removes its definition.
    pub fn reset_element(&self, node_id: String, path: String) -> Result<ResetOutcome, String> {
        self.call(|reply| Request::ResetElement { node_id, path, reply })
    }

    /// Deletes a redundant modification after the user confirmed.
    pub fn discard_modification(&self, project_root: PathBuf, dir: String) -> Result<(), String> {
        self.call(|reply| Request::DiscardModification { project_root, dir, reply })
    }

    pub fn undo(&self, node_id: String) -> Result<UndoRedoOutcome, String> {
        self.call(|reply| Request::Undo { node_id, reply })
    }

    pub fn redo(&self, node_id: String) -> Result<UndoRedoOutcome, String> {
        self.call(|reply| Request::Redo { node_id, reply })
    }

    /// Writes the object. Fails with a message starting `CONFLICT:` when the file on disk changed
    /// since it was opened (for example by an external Git operation); nothing is written then.
    pub fn save(&self, node_id: String) -> Result<(), String> {
        self.call(|reply| Request::Save { node_id, force: false, reply })
    }

    /// Writes the object although the file changed on disk meanwhile (the old disk version is
    /// kept by the automatic backup).
    pub fn save_overwrite(&self, node_id: String) -> Result<(), String> {
        self.call(|reply| Request::Save { node_id, force: true, reply })
    }

    /// Which of the given objects are open in the actor and changed (or vanished) on disk since.
    pub fn external_changes(&self, node_ids: Vec<String>) -> Result<Vec<String>, String> {
        self.call(|reply| Request::ExternalChanges { node_ids, reply })
    }

    /// Drops the in-memory copy (including its undo history) so the next access reads the disk.
    pub fn reload(&self, node_id: String) -> Result<(), String> {
        self.call(|reply| Request::Reload { node_id, reply })
    }

    pub fn list_diagnostics(&self, node_id: String) -> Result<Vec<DiagnosticDto>, String> {
        self.call(|reply| Request::ListDiagnostics { node_id, reply })
    }
}

/// One currently-open `.aod` object, of any object type the actor knows how to scan
/// (`tree::OBJECT_FOLDERS`) - not entity-specific despite the historical name still showing up in
/// a couple of doc comments below (kept accurate, not renamed everywhere, to keep this diff
/// mechanical).
struct OpenObject {
    handle: ProjectHandle,
    history: EditHistory<HistoryItem>,
    /// The object's structural shape (field names / array lengths), captured once at open time.
    /// See `live_snapshot`'s doc for why this is needed at all.
    shape: CoreValue,
    /// Resolved once at open time via `tree::object_type_for_leaf_path` (§ P4 dispatch table
    /// above) - `None` for a node id whose path does not sit under any recognised
    /// `OBJECT_FOLDERS` entry (defensive; `resolve_leaf_path` already guarantees a real file, but
    /// not that it is under a recognised object folder). `list_diagnostics` treats `None` the same
    /// as an object type with no registered validators: an empty diagnostics list, not an error.
    object_type: Option<&'static str>,
    /// Size and modification time of the file when it was read or last written by this actor.
    stamp: Option<crate::watch::FileStamp>,
}

/// **Documented `core-model` behaviour this works around (not a bug - see `PropertyTree::from_value`/
/// `build_node` in `core-model/src/tree.rs`):** a structural node's cached `PropertyValue` (an
/// `Object`/`Array`) is captured once, at tree-construction time, as a full nested snapshot - it
/// is never recomputed from its children's current values. Only a *leaf scalar* node's own cached
/// value is updated in place by `set_scalar`. That means `ProjectHandle::value_at(&NodePath::root())`
/// after an edit still returns the *original* nested tree with the edited leaf unchanged, even
/// though `value_at(&exact_leaf_path)` correctly returns the new value (proven by
/// `forge-core/src/project.rs`'s own end-to-end test, which only ever reads one exact leaf path).
///
/// `live_snapshot` reconstructs a fully up-to-date nested value by walking the *shape* captured
/// at open time (field names/array lengths do not change without `insert`/`delete`, which this
/// round never calls) and re-querying `value_at` for every leaf position individually - the one
/// per-node operation that *is* guaranteed live. This is the only way to hand the frontend a
/// correct "whole object" view with `forge-core`'s current public API; a `ProjectHandle` method
/// that returns a live nested snapshot directly (recomputing `Object`/`Array` from current child
/// values) would let this function disappear - flagged as a `forge-core` API gap in
/// `p4-editor-entity-notes.md`.
fn live_snapshot(handle: &ProjectHandle, path: &NodePath, shape: &CoreValue) -> CoreValue {
    match shape {
        CoreValue::Object(fields) => CoreValue::Object(
            fields
                .iter()
                .map(|(key, child_shape)| (key.clone(), live_snapshot(handle, &path.field(key), child_shape)))
                .collect(),
        ),
        CoreValue::Array(items) => CoreValue::Array(
            items
                .iter()
                .enumerate()
                .map(|(i, child_shape)| live_snapshot(handle, &path.index(i), child_shape))
                .collect(),
        ),
        CoreValue::Scalar(_) => handle.value_at(path).cloned().unwrap_or_else(|| shape.clone()),
    }
}

fn run(rx: Receiver<Request>) {
    let mut open: HashMap<String, OpenObject> = HashMap::new();
    let mut modifiable: HashMap<String, PathBuf> = HashMap::new();

    while let Ok(request) = rx.recv() {
        // A panic while handling one request must not kill the actor for the rest of the session:
        // the caller gets an error (its reply channel is dropped), the panic hook has logged it.
        let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match request {
            Request::ScanTree { project_root, reply } => {
                let _ = reply.send(scan_project_tree(&project_root));
            }
            Request::TreeChildren { node_id, reply } => {
                let _ = reply.send(list_tree_children(&node_id));
            }
            Request::GetPropertyTree { node_id, reply } => {
                let result = ensure_open(&mut open, &node_id).map(|entry| {
                    let value = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);
                    WireValue::from_core(&value)
                });
                let _ = reply.send(result);
            }
            Request::SetProperty { node_id, path, value, reply } => {
                let result = ensure_writable(Path::new(&node_id)).and_then(|()| set_property(&mut open, &node_id, &path, value));
                let _ = reply.send(result);
            }
            Request::Undo { node_id, reply } => {
                let result = undo(&mut open, &node_id);
                let _ = reply.send(result);
            }
            Request::Redo { node_id, reply } => {
                let result = redo(&mut open, &node_id);
                let _ = reply.send(result);
            }
            Request::Save { node_id, force, reply } => {
                let result = ensure_writable(Path::new(&node_id)).and_then(|()| ensure_open(&mut open, &node_id)).and_then(|entry| {
                    let path = resolve_leaf_path(&node_id)?;
                    if !force && crate::watch::file_stamp(&path) != entry.stamp {
                        return Err(format!(
                            "CONFLICT: '{}' was changed on disk after it was opened here (for example by Git). Nothing was written.",
                            path.display()
                        ));
                    }
                    entry.handle.save().map_err(|e| friendly_write_error(&path, &e.to_string()))?;
                    entry.stamp = crate::watch::file_stamp(&path);
                    Ok(())
                });
                let _ = reply.send(result);
            }
            Request::ExternalChanges { node_ids, reply } => {
                let changed = node_ids
                    .into_iter()
                    .filter(|id| match (open.get(id), resolve_leaf_path(id)) {
                        (Some(entry), Ok(path)) => crate::watch::file_stamp(&path) != entry.stamp,
                        (Some(_), Err(_)) => true,
                        _ => false,
                    })
                    .collect();
                let _ = reply.send(Ok(changed));
            }
            Request::Reload { node_id, reply } => {
                open.remove(&node_id);
                let _ = reply.send(Ok(()));
            }
            Request::ListDiagnostics { node_id, reply } => {
                let result = list_diagnostics(&mut open, &node_id);
                let _ = reply.send(result);
            }
            Request::GetSheet { node_id, path, catalog, reply } => {
                let mode = modifiable.contains_key(&node_id);
                let mut result = property_sheet(&mut open, &node_id, &path, catalog.as_deref(), mode);
                if let Ok(sheet) = &mut result {
                    sheet.modification = mode;
                }
                let _ = reply.send(result);
            }
            Request::EnableModification { node_id, project_root, reply } => {
                let result = if !crate::tree::is_under_node_modules(Path::new(&node_id)) {
                    Err("only objects of installed modules (node_modules) need a modification".to_string())
                } else if crate::tree::is_under_node_modules(&project_root) || !project_root.is_dir() {
                    Err("the project folder is invalid".to_string())
                } else {
                    modifiable.insert(node_id, project_root);
                    Ok(())
                };
                let _ = reply.send(result);
            }
            Request::SetModificationProperty { node_id, path, name, value, typed, kind, reply } => {
                let result = modification_set_property(&mut open, &modifiable, &node_id, &path, &name, value, typed, &kind);
                let _ = reply.send(result);
            }
            Request::SetModificationScript { node_id, path, name, content, reply } => {
                let _ = reply.send(modification_set_script(&modifiable, &node_id, &path, &name, content));
            }
            Request::DiscardModification { project_root, dir, reply } => {
                let _ = reply.send(crate::modification_write::discard(&project_root, &dir));
            }
            Request::ResetProperty { node_id, path, name, reply } => {
                let result = if modifiable.contains_key(&node_id) {
                    modification_reset(&mut open, &modifiable, &node_id, &path, Some(&name))
                } else {
                    ensure_writable(Path::new(&node_id))
                        .and_then(|()| remove_sheet_property(&mut open, &node_id, &path, &name))
                        .map(|tree| ResetOutcome { tree, modification: None })
                };
                let _ = reply.send(result);
            }
            Request::ResetElement { node_id, path, reply } => {
                let result = if modifiable.contains_key(&node_id) {
                    modification_reset(&mut open, &modifiable, &node_id, &path, None)
                } else {
                    ensure_writable(Path::new(&node_id))
                        .and_then(|()| remove_element(&mut open, &node_id, &path))
                        .map(|tree| ResetOutcome { tree, modification: None })
                };
                let _ = reply.send(result);
            }
            Request::ActivateMapping { node_id, path, reply } => {
                let result = if modifiable.contains_key(&node_id) {
                    activate_in_modification(&mut open, &modifiable, &node_id, &path)
                } else {
                    ensure_writable(Path::new(&node_id)).and_then(|()| activate_mapping(&mut open, &node_id, &path))
                };
                let _ = reply.send(result);
            }
            Request::GetNavigator { node_id, reply } => {
                let _ = reply.send(navigator(&mut open, &node_id));
            }
            Request::SetSheetProperty { node_id, path, name, value, typed, reply } => {
                let result = ensure_writable(Path::new(&node_id)).and_then(|()| {
                    if path.contains(NEW_MARK) {
                        set_virtual_property(&mut open, &node_id, &path, &name, value, typed)
                    } else {
                        set_sheet_property(&mut open, &node_id, &path, &name, value, typed)
                    }
                });
                let _ = reply.send(result);
            }
            Request::RemoveSheetProperty { node_id, path, name, reply } => {
                let result = ensure_writable(Path::new(&node_id)).and_then(|()| remove_sheet_property(&mut open, &node_id, &path, &name));
                let _ = reply.send(result);
            }
            Request::GetSource { node_id, reply } => {
                let _ = reply.send(get_source(&mut open, &node_id));
            }
            Request::SetSource { node_id, text, reply } => {
                let result = ensure_writable(Path::new(&node_id)).and_then(|()| set_source(&mut open, &node_id, text));
                let _ = reply.send(result);
            }
        }));
        if handled.is_err() {
            crate::crashlog::write_entry("ERROR", "the project actor survived a panic while handling a request");
        }
    }
}

/// Turns a raw write error into a message a user can act on (read-only files, locked files).
pub fn friendly_write_error(path: &Path, raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("access is denied") || lower.contains("zugriff") || lower.contains("permission denied") || lower.contains("read-only") {
        return format!("'{}' could not be written: the file is read-only or locked by another program. Make it writable (or close the other program) and save again. ({raw})", path.display());
    }
    format!("failed to save '{}': {raw}", path.display())
}

fn get_source(open: &mut HashMap<String, OpenObject>, node_id: &str) -> Result<SourceDto, String> {
    let entry = ensure_open(open, node_id)?;
    let text = String::from_utf8(entry.handle.serialized_bytes()).map_err(|_| "the file is not valid UTF-8".to_string())?;
    Ok(SourceDto { text, read_only: crate::tree::is_under_node_modules(Path::new(node_id)) })
}

fn set_source(open: &mut HashMap<String, OpenObject>, node_id: &str, text: String) -> Result<UndoRedoOutcome, String> {
    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let entry = ensure_open(open, node_id)?;
    let before = entry.handle.serialized_bytes();
    let mut after = text.into_bytes();
    // The editor widget hides a byte order mark; without it the file would silently lose it.
    if before.starts_with(BOM) && !after.starts_with(BOM) {
        after.splice(0..0, BOM.iter().copied());
    }
    if after == before {
        return Ok(outcome(entry));
    }
    ensure_well_formed(&after)?;
    // The document parser trusts balanced input; a panic there must not take the actor thread
    // (and with it every open object) down. `replace_document` builds the new tree before it
    // swaps it in, so an unwinding call leaves the old document intact.
    let replaced = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| entry.handle.replace_document(after.clone())))
        .map_err(|_| "source rejected, document unchanged: the text could not be parsed".to_string())?;
    replaced.map_err(|e| format!("source rejected, document unchanged: {e}"))?;
    refresh_shape(entry);
    entry.history.record(HistoryItem::Document { before, after });
    Ok(outcome(entry))
}

/// Stops text with mismatched, unclosed or multiple root elements before it reaches the parser.
fn ensure_well_formed(bytes: &[u8]) -> Result<(), String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let mut depth = 0usize;
    let mut roots = 0usize;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(_)) => {
                if depth == 0 {
                    roots += 1;
                }
                depth += 1;
            }
            Ok(Event::Empty(_)) => {
                if depth == 0 {
                    roots += 1;
                }
            }
            Ok(Event::End(_)) => depth = depth.saturating_sub(1),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(format!("source rejected, document unchanged: XML error at byte {}: {e}", reader.buffer_position())),
        }
        buf.clear();
    }
    if depth != 0 {
        return Err("source rejected, document unchanged: an element is not closed".to_string());
    }
    if roots != 1 {
        return Err("source rejected, document unchanged: exactly one root element is required".to_string());
    }
    Ok(())
}

fn ensure_open<'a>(open: &'a mut HashMap<String, OpenObject>, node_id: &str) -> Result<&'a mut OpenObject, String> {
    if !open.contains_key(node_id) {
        let path = resolve_leaf_path(node_id)?;
        let object_type = object_type_for_leaf_path(&path);
        let stamp = crate::watch::file_stamp(&path);
        let raw = std::fs::read(&path).map_err(|e| format!("cannot read '{}': {e}", path.display()))?;
        crate::problems::validate_aod_bytes(&raw).map_err(|e| format!("'{}' cannot be opened: {e}", path.display()))?;
        drop(raw);
        let handle = forge_core::open_project(path).map_err(|e| e.to_string())?;
        let shape = handle.value_at(&NodePath::root()).expect("root node always exists").clone();
        open.insert(node_id.to_string(), OpenObject { handle, history: EditHistory::new(), shape, object_type, stamp });
    }
    Ok(open.get_mut(node_id).expect("just inserted"))
}

fn set_property(
    open: &mut HashMap<String, OpenObject>,
    node_id: &str,
    path_str: &str,
    value: WireValue,
) -> Result<WireValue, String> {
    let path = parse_node_path(path_str)?;
    let new_scalar = value
        .as_core_scalar()
        .ok_or_else(|| "set_property only accepts a scalar (text/bool/int) value".to_string())?;

    let entry = ensure_open(open, node_id)?;
    let old_value = entry
        .handle
        .value_at(&path)
        .ok_or_else(|| format!("node at path '{path_str}' does not exist"))?
        .clone();
    let old_scalar = old_value
        .as_scalar()
        .ok_or_else(|| format!("node at path '{path_str}' is not a scalar field"))?
        .clone();

    entry.handle.set_property(&path, new_scalar.clone()).map_err(|e| e.to_string())?;
    entry.history.record(HistoryItem::Scalar(EditEntry { path, old: old_scalar, new: new_scalar }));

    let root = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);
    Ok(WireValue::from_core(&root))
}

fn undo(open: &mut HashMap<String, OpenObject>, node_id: &str) -> Result<UndoRedoOutcome, String> {
    let entry = ensure_open(open, node_id)?;
    let history_entry = entry.history.undo().ok_or_else(|| "nothing to undo".to_string())?;
    apply_history(entry, history_entry, false)?;
    let root = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);
    Ok(UndoRedoOutcome {
        tree: WireValue::from_core(&root),
        can_undo: entry.history.can_undo(),
        can_redo: entry.history.can_redo(),
    })
}

fn redo(open: &mut HashMap<String, OpenObject>, node_id: &str) -> Result<UndoRedoOutcome, String> {
    let entry = ensure_open(open, node_id)?;
    let history_entry = entry.history.redo().ok_or_else(|| "nothing to redo".to_string())?;
    apply_history(entry, history_entry, true)?;
    let root = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);
    Ok(UndoRedoOutcome {
        tree: WireValue::from_core(&root),
        can_undo: entry.history.can_undo(),
        can_redo: entry.history.can_redo(),
    })
}

fn apply_history(entry: &mut OpenObject, item: HistoryItem, forward: bool) -> Result<(), String> {
    match item {
        HistoryItem::Scalar(e) => entry
            .handle
            .set_property(&e.path, if forward { e.new } else { e.old })
            .map_err(|e| e.to_string()),
        HistoryItem::Document { before, after } => {
            entry.handle.replace_document(if forward { after } else { before }).map_err(|e| e.to_string())?;
            refresh_shape(entry);
            Ok(())
        }
    }
}

/// After a structural edit the element structure changed, so `live_snapshot`'s shape is re-read.
fn refresh_shape(entry: &mut OpenObject) {
    entry.shape = entry.handle.value_at(&NodePath::root()).expect("root node always exists").clone();
}

fn outcome(entry: &OpenObject) -> UndoRedoOutcome {
    let root = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);
    UndoRedoOutcome { tree: WireValue::from_core(&root), can_undo: entry.history.can_undo(), can_redo: entry.history.can_redo() }
}

/// Name of the document's top-level element, i.e. the ADITO model type (`entity`, `neonContext`).
pub fn root_tag(bytes: &[u8]) -> String {
    let mut i = 0;
    while let Some(off) = bytes[i..].iter().position(|&c| c == b'<') {
        let start = i + off + 1;
        match bytes.get(start) {
            Some(b'?') | Some(b'!') => i = start,
            Some(_) => {
                let end = bytes[start..]
                    .iter()
                    .position(|c| c.is_ascii_whitespace() || *c == b'>' || *c == b'/')
                    .map(|e| start + e)
                    .unwrap_or(bytes.len());
                return String::from_utf8_lossy(&bytes[start..end]).into_owned();
            }
            None => break,
        }
    }
    String::new()
}

/// `%aditoprj%` of an object file: `<root>/<typeFolder>/<Name>/<Name>.aod`.
pub(crate) fn object_project_root(file: &Path) -> Option<PathBuf> {
    file.parent()?.parent()?.parent().map(Path::to_path_buf)
}

fn linked_preview(project_root: Option<&Path>, reference: &str) -> Option<String> {
    let content = crate::linked_file::read_linked_file(project_root?, reference).ok()?;
    let line = content.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(line.chars().take(200).collect())
}

fn property_sheet(open: &mut HashMap<String, OpenObject>, node_id: &str, path: &str, catalog: Option<&Catalog>, modification: bool) -> Result<PropertySheet, String> {
    let virtual_target = split_virtual(path);
    let node_path = match virtual_target {
        Some((container, _)) => parse_node_path(container)?,
        None => parse_node_path(path)?,
    };
    let entry = ensure_open(open, node_id)?;
    let model_type = root_tag(&entry.handle.serialized_bytes());
    let mut root = WireValue::from_core(&live_snapshot(&entry.handle, &NodePath::root(), &entry.shape));
    let node_path = match virtual_target {
        Some((_, name)) => add_virtual_mapping(&mut root, &node_path, name)?,
        None => node_path,
    };
    let file = Path::new(node_id);
    let read_only = (crate::tree::is_under_node_modules(file) && !modification).then_some(sheet::READ_ONLY_MODULE);
    let project_root = object_project_root(file);
    let mut result = sheet::resolve_sheet(catalog, &model_type, &root, &node_path, read_only, &|r| linked_preview(project_root.as_deref(), r))?;
    for row in result.groups.iter_mut().flat_map(|g| g.rows.iter_mut()) {
        if row.kind == crate::catalog::PropKind::Linked && !row.set {
            row.new_reference = linked_new_reference(file, &root, &node_path, &row.name);
        }
    }
    if virtual_target.is_some() {
        result.path = path.to_string();
    }
    Ok(result)
}

/// Where the linked file of a not yet set code property is created, following the Designer's
/// layout `<type>/<Object>/<container>/<element name>/.../<property>.js` (for example
/// `entity/Foo_entity/entityfields/city/valueProcess.js`).
pub fn linked_new_reference(file: &Path, root: &WireValue, path: &NodePath, prop: &str) -> Option<String> {
    use core_model::path::PathSegment;
    let dir = file.parent()?;
    let object = dir.file_name()?.to_str()?;
    let folder = dir.parent()?.file_name()?.to_str()?;
    let segs = path.segments();
    let mut parts: Vec<String> = Vec::new();
    let mut cur = NodePath::root();
    let mut i = 0;
    while i < segs.len() {
        let PathSegment::Field(container) = &segs[i] else { return None };
        cur = cur.field(container);
        i += 1;
        let Some(PathSegment::Field(element)) = segs.get(i) else {
            parts.push(container.to_lowercase());
            break;
        };
        cur = cur.field(element);
        i += 1;
        if let Some(PathSegment::Index(n)) = segs.get(i) {
            cur = cur.index(*n);
            i += 1;
        }
        let name = sheet::field(sheet::value_at(root, &cur)?, "name").and_then(sheet::text_of)?;
        parts.push(container.to_lowercase());
        parts.push(name.to_lowercase());
    }
    let middle = if parts.is_empty() { String::new() } else { format!("{}/", parts.join("/")) };
    Some(format!("%aditoprj%/{folder}/{object}/{middle}{prop}.js"))
}

fn remove_sheet_property(open: &mut HashMap<String, OpenObject>, node_id: &str, path_str: &str, name: &str) -> Result<UndoRedoOutcome, String> {
    let parent = parse_node_path(path_str)?;
    let target = parent.field(name);
    let entry = ensure_open(open, node_id)?;
    let existing = entry.handle.value_at(&target).cloned().ok_or_else(|| format!("'{name}' is not set"))?;
    if existing.as_scalar().is_none() {
        return Err(format!("'{name}' is not a single value and cannot be removed here"));
    }
    let before = entry.handle.serialized_bytes();
    let span = entry.handle.element_span(&target).ok_or_else(|| format!("'{name}' not found in the document"))?;
    entry.handle.splice(span, b"").map_err(|e| e.to_string())?;
    let after = entry.handle.serialized_bytes();
    refresh_shape(entry);
    entry.history.record(HistoryItem::Document { before, after });
    Ok(outcome(entry))
}

fn navigator(open: &mut HashMap<String, OpenObject>, node_id: &str) -> Result<Vec<NavNode>, String> {
    let entry = ensure_open(open, node_id)?;
    let model_type = root_tag(&entry.handle.serialized_bytes());
    let root = WireValue::from_core(&live_snapshot(&entry.handle, &NodePath::root(), &entry.shape));
    let name = sheet::field(&root, "name").and_then(sheet::text_of).unwrap_or_default();
    let js = if model_type == "process" {
        let project_root = object_project_root(Path::new(node_id));
        sheet::field(&root, "process")
            .and_then(sheet::text_of)
            .and_then(|r| crate::linked_file::read_linked_file(project_root.as_deref()?, &r).ok())
    } else {
        None
    };
    Ok(sheet::navigator(&model_type, &root, &name, js.as_deref()))
}

fn encode_attr(raw: &str) -> String {
    core_model::codec::encode_text(raw).replace('"', "&quot;")
}

fn scalar_text(value: &core_model::value::ScalarValue) -> String {
    use core_model::value::ScalarValue;
    match value {
        ScalarValue::Text(t) => t.clone(),
        ScalarValue::Bool(b) => b.to_string(),
        ScalarValue::Int(i) => i.to_string(),
    }
}

/// Writes one property of the element at `path_str`:
/// - existing text element: the regular scalar edit (value-granular undo);
/// - existing typed `<x v="..." />`: replaces exactly the attribute value bytes;
/// - missing: appends a new child element after the element's last child, copying that
///   child's indentation, so the file diff is exactly the one new line.
fn set_sheet_property(
    open: &mut HashMap<String, OpenObject>,
    node_id: &str,
    path_str: &str,
    name: &str,
    value: WireValue,
    typed: bool,
) -> Result<UndoRedoOutcome, String> {
    let parent = parse_node_path(path_str)?;
    let target = parent.field(name);
    let new_scalar = value.as_core_scalar().ok_or_else(|| "only scalar values can be set".to_string())?;
    let new_text = scalar_text(&new_scalar);
    let entry = ensure_open(open, node_id)?;
    let before = entry.handle.serialized_bytes();

    match entry.handle.value_at(&target).cloned() {
        Some(existing) => {
            let old_scalar = existing.as_scalar().ok_or_else(|| format!("'{name}' is not a single value"))?.clone();
            let span = entry.handle.element_span(&target).ok_or_else(|| format!("'{name}' not found in the document"))?;
            let self_closing = before[span.start..span.end].trim_ascii_end().ends_with(b"/>");
            if self_closing {
                let value_span = entry.handle.value_span(&target).ok_or_else(|| format!("'{name}' has no v attribute"))?;
                entry.handle.splice(value_span, encode_attr(&new_text).as_bytes()).map_err(|e| e.to_string())?;
                let after = entry.handle.serialized_bytes();
                refresh_shape(entry);
                entry.history.record(HistoryItem::Document { before, after });
            } else {
                let new = core_model::value::ScalarValue::Text(new_text);
                entry.handle.set_property(&target, new.clone()).map_err(|e| e.to_string())?;
                entry.history.record(HistoryItem::Scalar(EditEntry { path: target, old: old_scalar, new }));
            }
        }
        None => {
            let element = if typed {
                format!("<{name} v=\"{}\" />", encode_attr(&new_text))
            } else {
                format!("<{name}>{}</{name}>", core_model::codec::encode_text(&new_text))
            };
            let parent_value = entry.handle.value_at(&parent).cloned().ok_or_else(|| format!("no element at '{path_str}'"))?;
            let CoreValue::Object(fields) = &parent_value else {
                return Err(format!("'{path_str}' cannot hold properties"));
            };
            let mut last: Option<core_model::command::ByteRange> = None;
            for (key, child) in fields {
                let paths: Vec<NodePath> = match child {
                    CoreValue::Array(items) => (0..items.len()).map(|i| parent.field(key).index(i)).collect(),
                    _ => vec![parent.field(key)],
                };
                for p in paths {
                    if let Some(span) = entry.handle.element_span(&p) {
                        if last.map(|l| span.end > l.end).unwrap_or(true) {
                            last = Some(span);
                        }
                    }
                }
            }
            let (at, indent) = match last {
                Some(span) => {
                    let ws_len = before[span.start..span.end].iter().position(|&c| c == b'<').unwrap_or(0);
                    (span.end, before[span.start..span.start + ws_len].to_vec())
                }
                None => entry.handle.append_point(&parent).ok_or_else(|| format!("cannot add to '{path_str}'"))?,
            };
            let mut insert = indent;
            insert.extend_from_slice(element.as_bytes());
            entry
                .handle
                .splice(core_model::command::ByteRange::new(at, at), &insert)
                .map_err(|e| e.to_string())?;
            let after = entry.handle.serialized_bytes();
            refresh_shape(entry);
            entry.history.record(HistoryItem::Document { before, after });
        }
    }
    Ok(outcome(entry))
}

/// Identity of the module object a modification belongs to, read from the untouched file on disk.
fn pristine_object(node_id: &str) -> Result<(forge_core::ProjectHandle, CoreValue, crate::modification_write::ObjectRef, PathBuf), String> {
    let pristine = forge_core::open_project(PathBuf::from(node_id)).map_err(|e| e.to_string())?;
    let root = pristine.value_at(&NodePath::root()).ok_or("object has no root")?.clone();
    let model_type = root_tag(&pristine.serialized_bytes());
    let model_name = match &root {
        CoreValue::Object(fields) => fields.iter().find(|(k, _)| k == "name").and_then(|(_, v)| v.as_scalar()).map(scalar_text).unwrap_or_default(),
        _ => String::new(),
    };
    let module_root = object_project_root(Path::new(node_id)).ok_or("object is not in the standard folder layout")?;
    let obj = crate::modification_write::ObjectRef { project_root: PathBuf::new(), model_type, model_name };
    Ok((pristine, root, obj, module_root))
}

#[allow(clippy::too_many_arguments)]
fn modification_set_property(
    open: &mut HashMap<String, OpenObject>,
    modifiable: &HashMap<String, PathBuf>,
    node_id: &str,
    path_str: &str,
    name: &str,
    value: WireValue,
    typed: bool,
    kind: &str,
) -> Result<ModificationOutcome, String> {
    use crate::modification_write::{modification_path, modify, ModValue, ObjectRef};
    use core_model::value::ScalarValue;
    if path_str.contains(NEW_MARK) {
        return modification_insert_mapping(open, modifiable, node_id, path_str, name, value, typed);
    }
    let project_root = modifiable.get(node_id).ok_or("choose 'Create Modification' for this object first")?.clone();
    let parent = parse_node_path(path_str)?;
    let new_scalar = value.as_core_scalar().ok_or("only scalar values can be modified")?;
    let new_value = match (&new_scalar, kind) {
        (_, "enum") => return Err("Enum properties cannot be modified yet: the enum class name for the modification is not known to Forge.".into()),
        (_, "number") => return Err("Number properties cannot be modified yet.".into()),
        (ScalarValue::Bool(b), _) => ModValue::Bool(*b),
        (ScalarValue::Int(i), _) => ModValue::Int(*i),
        (ScalarValue::Text(t), _) => ModValue::Text(t.clone()),
    };
    let (pristine, root, obj, _) = pristine_object(node_id)?;
    let original = pristine.value_at(&parent.field(name)).and_then(|v| v.as_scalar()).map(scalar_text);
    let segments = modification_path(&root, &parent, name)?;
    let outcome = modify(&ObjectRef { project_root, ..obj }, &segments, new_value, original.as_deref())?;
    // Keep the in-memory copy of the module object (never saved) in line with the effective result.
    set_sheet_property(open, node_id, path_str, name, value, typed)?;
    if let Some(entry) = open.get_mut(node_id) {
        entry.history = EditHistory::new();
    }
    Ok(outcome)
}

fn modification_set_script(
    modifiable: &HashMap<String, PathBuf>,
    node_id: &str,
    path_str: &str,
    name: &str,
    content: String,
) -> Result<ModificationOutcome, String> {
    use crate::modification_write::{modification_path, modify, ModValue, ObjectRef};
    let project_root = modifiable.get(node_id).ok_or("choose 'Create Modification' for this object first")?.clone();
    let parent = parse_node_path(path_str)?;
    let (pristine, root, obj, module_root) = pristine_object(node_id)?;
    let original = pristine
        .value_at(&parent.field(name))
        .and_then(|v| v.as_scalar())
        .map(scalar_text)
        .and_then(|reference| crate::linked_file::read_linked_file(&module_root, &reference).ok());
    let segments = modification_path(&root, &parent, name)?;
    let file_name = format!("{}.js", name);
    modify(&ObjectRef { project_root, ..obj }, &segments, ModValue::Script { file_name, content }, original.as_deref())
}

// ---------------------------------------------------------------------------------------------
// Navigator entries without a definition (grey) and Set to Default

/// Marks a Navigator entry that has no mapping in the file yet: `<record container path>#new:<binding>`.
/// Selecting it shows the properties of a mapping with default values; the first edit creates it.
use sheet::NEW_MARK;

fn split_virtual(path: &str) -> Option<(&str, &str)> {
    path.split_once(NEW_MARK)
}

/// Element name of a field mapping of a record container, `dbRecordContainer` -> `dbRecordFieldMapping`.
fn mapping_tag(container: &NodePath) -> String {
    use core_model::path::PathSegment;
    let tag = container.segments().iter().rev().find_map(|s| if let PathSegment::Field(f) = s { Some(f.clone()) } else { None });
    match tag {
        Some(t) if t.ends_with("Container") => format!("{}FieldMapping", &t[..t.len() - "Container".len()]),
        _ => "dbRecordFieldMapping".to_string(),
    }
}

/// Element name of the mapping for one binding: field bindings (`X.value`, `X.displayValue`) use the
/// container's field mapping, every other binding is a consumer and uses `consumerMapping`.
fn mapping_tag_for(container: &NodePath, binding: &str) -> String {
    if binding.ends_with(".value") || binding.ends_with(".displayValue") {
        mapping_tag(container)
    } else {
        "consumerMapping".to_string()
    }
}

/// Path of the mapping called `name` below `container`, using the projection's conventions
/// (single occurrence without index).
fn find_mapping_path(root: &WireValue, container: &NodePath, name: &str) -> Option<NodePath> {
    let tag = mapping_tag_for(container, name);
    let list_path = container.field("recordFieldMappings");
    let list = sheet::value_at(root, &list_path)?;
    let WireValue::Object { fields } = list else { return None };
    for f in fields.iter().filter(|f| f.key == tag) {
        match &f.value {
            WireValue::Array { items } => {
                if let Some(i) = items.iter().position(|it| sheet::field(it, "name").and_then(sheet::text_of).as_deref() == Some(name)) {
                    return Some(list_path.field(&tag).index(i));
                }
            }
            single => {
                if sheet::field(single, "name").and_then(sheet::text_of).as_deref() == Some(name) {
                    return Some(list_path.field(&tag));
                }
            }
        }
    }
    None
}

/// Adds an empty mapping called `name` to a copy of the property tree, so its Properties can be shown.
fn add_virtual_mapping(root: &mut WireValue, container: &NodePath, name: &str) -> Result<NodePath, String> {
    use crate::wire::WireField;
    use core_model::path::PathSegment;
    if let Some(existing) = find_mapping_path(root, container, name) {
        return Ok(existing);
    }
    let tag = mapping_tag_for(container, name);
    let mut cur: &mut WireValue = root;
    for seg in container.segments() {
        cur = match (seg, cur) {
            (PathSegment::Field(n), WireValue::Object { fields }) => &mut fields.iter_mut().find(|f| &f.key == n).ok_or_else(|| format!("no element at '{container}'"))?.value,
            (PathSegment::Index(i), WireValue::Array { items }) => items.get_mut(*i).ok_or_else(|| format!("no element at '{container}'"))?,
            (PathSegment::Index(0), other) => other,
            _ => return Err(format!("no element at '{container}'")),
        };
    }
    let WireValue::Object { fields } = cur else { return Err(format!("'{container}' cannot hold mappings")) };
    let item = WireValue::Object { fields: vec![WireField { key: "name".into(), value: WireValue::Text { value: name.to_string() } }] };
    let list_path = container.field("recordFieldMappings");
    match fields.iter_mut().find(|f| f.key == "recordFieldMappings") {
        Some(list) => {
            let WireValue::Object { fields: inner } = &mut list.value else { return Err("recordFieldMappings is not a list of mappings".into()) };
            match inner.iter_mut().find(|f| f.key == tag) {
                Some(f) => match &mut f.value {
                    WireValue::Array { items } => {
                        items.push(item);
                        Ok(list_path.field(&tag).index(items.len() - 1))
                    }
                    other => {
                        let old = other.clone();
                        *other = WireValue::Array { items: vec![old, item] };
                        Ok(list_path.field(&tag).index(1))
                    }
                },
                None => {
                    inner.push(WireField { key: tag.clone(), value: item });
                    Ok(list_path.field(&tag))
                }
            }
        }
        None => {
            fields.push(WireField { key: "recordFieldMappings".into(), value: WireValue::Object { fields: vec![WireField { key: tag.clone(), value: item }] } });
            Ok(list_path.field(&tag))
        }
    }
}

/// Creates the mapping `name` in the document (one new element after the last mapping, same
/// indentation) and returns its path. Does not touch the undo history.
fn materialize_mapping(entry: &mut OpenObject, container: &NodePath, name: &str) -> Result<NodePath, String> {
    let live = WireValue::from_core(&live_snapshot(&entry.handle, &NodePath::root(), &entry.shape));
    if let Some(existing) = find_mapping_path(&live, container, name) {
        return Ok(existing);
    }
    let list_path = container.field("recordFieldMappings");
    let tag = mapping_tag_for(container, name);
    let before = entry.handle.serialized_bytes();
    let list_value = entry.handle.value_at(&list_path).cloned().ok_or("This record container has no recordFieldMappings element yet; add the first mapping in the Source tab.")?;
    let CoreValue::Object(children) = &list_value else { return Err("recordFieldMappings cannot hold mappings".into()) };
    let mut last: Option<core_model::command::ByteRange> = None;
    for (key, child) in children {
        let paths: Vec<NodePath> = match child {
            CoreValue::Array(items) => (0..items.len()).map(|i| list_path.field(key).index(i)).collect(),
            _ => vec![list_path.field(key)],
        };
        for p in paths {
            if let Some(span) = entry.handle.element_span(&p) {
                if last.map(|l| span.end > l.end).unwrap_or(true) {
                    last = Some(span);
                }
            }
        }
    }
    let (at, indent) = match last {
        Some(span) => {
            let ws_len = before[span.start..span.end].iter().position(|&c| c == b'<').unwrap_or(0);
            (span.end, before[span.start..span.start + ws_len].to_vec())
        }
        None => entry.handle.append_point(&list_path).ok_or("cannot add a mapping to this record container")?,
    };
    let eol = if before.contains(&b'\r') { "\r\n" } else { "\n" };
    let spaces: Vec<u8> = indent.iter().rev().take_while(|&&c| c == b' ').copied().collect();
    let sp = String::from_utf8_lossy(&spaces).into_owned();
    let element = format!("<{tag}>{eol}{sp}  <name>{}</name>{eol}{sp}</{tag}>", core_model::codec::encode_text(name));
    let mut insert = indent;
    insert.extend_from_slice(element.as_bytes());
    entry.handle.splice(core_model::command::ByteRange::new(at, at), &insert).map_err(|e| e.to_string())?;
    refresh_shape(entry);
    let live = WireValue::from_core(&live_snapshot(&entry.handle, &NodePath::root(), &entry.shape));
    find_mapping_path(&live, container, name).ok_or_else(|| "the new mapping was not found after inserting it".to_string())
}

/// First edit of a grey Navigator entry: creates the mapping and sets the property, as ONE undo step.
fn set_virtual_property(
    open: &mut HashMap<String, OpenObject>,
    node_id: &str,
    path_str: &str,
    name: &str,
    value: WireValue,
    typed: bool,
) -> Result<UndoRedoOutcome, String> {
    let (container_str, binding) = split_virtual(path_str).ok_or("not a virtual path")?;
    let container = parse_node_path(container_str)?;
    let entry = ensure_open(open, node_id)?;
    let before = entry.handle.serialized_bytes();
    let real = materialize_mapping(entry, &container, binding)?;
    if let Err(e) = set_sheet_property(open, node_id, &real.to_string(), name, value, typed) {
        let entry = ensure_open(open, node_id)?;
        let _ = entry.handle.replace_document(before);
        refresh_shape(entry);
        return Err(e);
    }
    let entry = ensure_open(open, node_id)?;
    let after = entry.handle.serialized_bytes();
    let _ = entry.history.undo();
    entry.history.record(HistoryItem::Document { before, after });
    Ok(outcome(entry))
}

/// Activating a grey entry of an object of the project: the mapping is created with its name only;
/// one undo step.
fn activate_mapping(open: &mut HashMap<String, OpenObject>, node_id: &str, path_str: &str) -> Result<ActivateOutcome, String> {
    let (container_str, binding) = split_virtual(path_str).ok_or("This entry already has a definition.")?;
    let container = parse_node_path(container_str)?;
    let entry = ensure_open(open, node_id)?;
    let before = entry.handle.serialized_bytes();
    let real = materialize_mapping(entry, &container, binding)?;
    let after = entry.handle.serialized_bytes();
    if before != after {
        entry.history.record(HistoryItem::Document { before, after });
    }
    Ok(ActivateOutcome { path: real.to_string(), tree: outcome(entry), modification: None })
}

/// Same for a module object: the mapping is written as modification of the open project.
fn activate_in_modification(
    open: &mut HashMap<String, OpenObject>,
    modifiable: &HashMap<String, PathBuf>,
    node_id: &str,
    path_str: &str,
) -> Result<ActivateOutcome, String> {
    use crate::modification_write::{insert, modification_path, ObjectRef};
    let project_root = modifiable.get(node_id).ok_or("choose 'Create Modification' for this object first")?.clone();
    let (container_str, binding) = split_virtual(path_str).ok_or("This entry already has a definition.")?;
    let container = parse_node_path(container_str)?;
    let tag = mapping_tag_for(&container, binding);
    let element_xml = format!("<{tag}>\n  <name>{}</name>\n</{tag}>", core_model::codec::encode_text(binding));
    let live = {
        let entry = ensure_open(open, node_id)?;
        live_snapshot(&entry.handle, &NodePath::root(), &entry.shape)
    };
    let container_segments = modification_path(&live, &container, "recordFieldMappings")?;
    let (_, _, obj, _) = pristine_object(node_id)?;
    let result = insert(&ObjectRef { project_root, ..obj }, &container_segments, binding, &element_xml)?;
    let entry = ensure_open(open, node_id)?;
    let real = materialize_mapping(entry, &container, binding)?;
    entry.history = EditHistory::new();
    Ok(ActivateOutcome { path: real.to_string(), tree: outcome(entry), modification: Some(result) })
}

/// Same for a module object: the new mapping is inserted as modification and the in-memory copy follows.
#[allow(clippy::too_many_arguments)]
fn modification_insert_mapping(
    open: &mut HashMap<String, OpenObject>,
    modifiable: &HashMap<String, PathBuf>,
    node_id: &str,
    path_str: &str,
    name: &str,
    value: WireValue,
    typed: bool,
) -> Result<ModificationOutcome, String> {
    use crate::modification_write::{insert, modification_path, ObjectRef};
    let project_root = modifiable.get(node_id).ok_or("choose 'Create Modification' for this object first")?.clone();
    let (container_str, binding) = split_virtual(path_str).ok_or("not a virtual path")?;
    let container = parse_node_path(container_str)?;
    let scalar = value.as_core_scalar().ok_or("only scalar values can be set")?;
    let text = scalar_text(&scalar);
    let tag = mapping_tag_for(&container, binding);
    let prop_xml = if typed { format!("<{name} v=\"{}\" />", encode_attr(&text)) } else { format!("<{name}>{}</{name}>", core_model::codec::encode_text(&text)) };
    let element_xml = format!("<{tag}>\n  <name>{}</name>\n  {prop_xml}\n</{tag}>", core_model::codec::encode_text(binding));
    let live = {
        let entry = ensure_open(open, node_id)?;
        live_snapshot(&entry.handle, &NodePath::root(), &entry.shape)
    };
    let container_segments = modification_path(&live, &container, "recordFieldMappings")?;
    let (_, _, obj, _) = pristine_object(node_id)?;
    let result = insert(&ObjectRef { project_root, ..obj }, &container_segments, binding, &element_xml)?;
    set_virtual_property(open, node_id, path_str, name, value, typed)?;
    if let Some(entry) = open.get_mut(node_id) {
        entry.history = EditHistory::new();
    }
    Ok(result)
}

/// Set to Default of an element: removes exactly its own lines; one undo step.
fn remove_element(open: &mut HashMap<String, OpenObject>, node_id: &str, path_str: &str) -> Result<UndoRedoOutcome, String> {
    let target = parse_node_path(path_str)?;
    if target.is_root() {
        return Err("The object itself cannot be set to default.".into());
    }
    let entry = ensure_open(open, node_id)?;
    let existing = entry.handle.value_at(&target).cloned().ok_or("This entry has no definition of its own; it already shows the defaults.")?;
    if !matches!(existing, CoreValue::Object(_)) {
        return Err("This entry is not an element and cannot be removed here.".into());
    }
    let before = entry.handle.serialized_bytes();
    let span = entry.handle.element_span(&target).ok_or("The element was not found in the document.")?;
    entry.handle.splice(span, b"").map_err(|e| e.to_string())?;
    let after = entry.handle.serialized_bytes();
    refresh_shape(entry);
    entry.history.record(HistoryItem::Document { before, after });
    Ok(outcome(entry))
}

/// Set to Default of a module object's property (`name` given) or element: the module itself is never
/// changed, the project's modification is deleted instead and the in-memory copy is read again.
fn modification_reset(
    open: &mut HashMap<String, OpenObject>,
    modifiable: &HashMap<String, PathBuf>,
    node_id: &str,
    path_str: &str,
    name: Option<&str>,
) -> Result<ResetOutcome, String> {
    use crate::modification_write::{discard, find_insert, find_modify, modification_path, Action, ObjectRef, Outcome};
    let project_root = modifiable.get(node_id).ok_or("choose 'Create Modification' for this object first")?.clone();
    let target = parse_node_path(path_str)?;
    let live = {
        let entry = ensure_open(open, node_id)?;
        live_snapshot(&entry.handle, &NodePath::root(), &entry.shape)
    };
    let (_, _, obj, _) = pristine_object(node_id)?;
    let obj = ObjectRef { project_root: project_root.clone(), ..obj };
    let dir = match name {
        Some(prop) => {
            let segments = modification_path(&live, &target, prop)?;
            find_modify(&obj, &segments).ok_or("The value comes from the module itself; there is no modification of the project to remove.")?
        }
        None => {
            let mut segments = modification_path(&live, &target, "")?;
            segments.pop();
            let element = segments.pop().ok_or("The object itself cannot be set to default.")?;
            find_insert(&obj, &segments, &element).ok_or("This element comes from the module itself; there is no modification of the project to remove.")?
        }
    };
    discard(&project_root, &dir)?;
    open.remove(node_id);
    let entry = ensure_open(open, node_id)?;
    Ok(ResetOutcome { tree: outcome(entry), modification: Some(Outcome { action: Action::Removed, dir: Some(dir) }) })
}
fn list_diagnostics(open: &mut HashMap<String, OpenObject>, node_id: &str) -> Result<Vec<DiagnosticDto>, String> {
    let entry = ensure_open(open, node_id)?;
    let root = live_snapshot(&entry.handle, &NodePath::root(), &entry.shape);

    // Table dispatch on `object_type` (see `VALIDATORS_BY_OBJECT_TYPE` above) - an object type
    // with no registered entry (or no resolvable object type at all) simply has no diagnostics,
    // same "silently skip the unrecognised case" philosophy `tree.rs`'s `OBJECT_FOLDERS` uses.
    let diagnostics = entry
        .object_type
        .and_then(|object_type| {
            VALIDATORS_BY_OBJECT_TYPE
                .iter()
                .find(|(candidate, _)| *candidate == object_type)
                .map(|(_, diagnostics_fn)| diagnostics_fn(&root))
        })
        .unwrap_or_default();

    Ok(diagnostics
        .into_iter()
        .map(|d| DiagnosticDto {
            severity: format!("{:?}", d.severity),
            message: d.message,
            path: d.path,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // A timestamp alone collides under `cargo test`'s parallel scheduling (same lesson
    // `forge-core/src/project.rs`'s own E2E tests already hit and fixed, see
    // `p3-forge-core-integration-notes.md`) - an atomic counter guarantees distinct directories
    // regardless of clock granularity.
    static FIXTURE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    /// `object_type_folder` (`"entity"`/`"neonView"`/`"neonContext"`/`"neonDashboard"`) is kept as
    /// the copy's direct grandparent directory name, mirroring the real project layout
    /// (`<project>/<folder>/<Instance>/<Instance>.aod`, aod-format.md §2) - `list_diagnostics`
    /// now resolves `object_type` from the node id's own path via `object_type_for_leaf_path`
    /// (VALIDATORS_BY_OBJECT_TYPE dispatch above), so a fixture copy that loses that ancestor
    /// folder name would silently get zero diagnostics regardless of what the validators find.
    fn fixture_copy(object_type_folder: &str, name: &str) -> PathBuf {
        let src = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/DemoProject")
            .join(object_type_folder)
            .join(name)
            .join(format!("{name}.aod"));
        let unique = FIXTURE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir()
            .join(format!("forge-app-actor-test-{}-{unique}", std::process::id()))
            .join(object_type_folder)
            .join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join(format!("{name}.aod"));
        std::fs::copy(&src, &dest).unwrap();
        dest
    }

    /// Removes the whole unique per-test temp root (two levels above the `.aod` file - see
    /// `fixture_copy`'s `<object_type_folder>/<name>/<name>.aod` layout), not just the immediate
    /// parent, so no empty `<object_type_folder>` directories accumulate in the OS temp dir.
    fn cleanup(path: &Path) {
        std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).ok();
    }

    #[test]
    fn actor_opens_edits_saves_and_reloads_a_real_fixture() {
        let path = fixture_copy("entity", "THHIT_Committee_entity");
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        let tree = actor.get_property_tree(node_id.clone()).unwrap();
        let title_before = find_text(&tree, &["title"]).unwrap();
        assert_eq!(title_before, "THHIT_Committee_entity");

        let updated = actor
            .set_property(node_id.clone(), "title".into(), WireValue::Text { value: "Changed".into() })
            .unwrap();
        assert_eq!(find_text(&updated, &["title"]).unwrap(), "Changed");

        actor.save(node_id.clone()).unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("<title>Changed</title>"));

        cleanup(&path);
    }

    #[test]
    fn objects_of_installed_modules_are_never_written() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/DemoProject/entity/THHIT_Committee_entity/THHIT_Committee_entity.aod");
        let unique = FIXTURE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let base = std::env::temp_dir().join(format!("forge-app-actor-ro-{}-{unique}", std::process::id()));
        let dir = base.join("node_modules/@mods/alpha/entity/THHIT_Committee_entity");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("THHIT_Committee_entity.aod");
        std::fs::copy(&src, &path).unwrap();
        let before = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        assert!(actor.get_property_tree(node_id.clone()).is_ok(), "reading stays possible");
        let err = actor.set_property(node_id.clone(), "title".into(), WireValue::Text { value: "X".into() }).unwrap_err();
        assert!(err.contains("read-only"), "{err}");
        assert!(actor.save(node_id).unwrap_err().contains("read-only"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_dir_all(&base).ok();
    }

    /// "Fertig"-Kriterium 1 (Round-Trip verlustfrei), exercised through this app's own generic
    /// `save()` path (not just `forge-core`'s own test) - loading a real fixture through the
    /// actor and saving without any edit must reproduce the file byte-for-byte.
    #[test]
    fn zero_edit_save_through_the_actor_is_byte_identical() {
        let path = fixture_copy("entity", "THHIT_FocusTopic_entity");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap(); // opens the file, no edits
        actor.save(node_id).unwrap();

        let after_bytes = std::fs::read(&path).unwrap();
        assert_eq!(after_bytes, original_bytes, "save without any edit must not change a single byte");

        cleanup(&path);
    }

    /// Same "Fertig"-Kriterium 1 check as above, run for the P4 second family too (one fixture per
    /// object type is enough - the round-trip guarantee comes from `forge-core`'s serializer, not
    /// from anything object-type-specific in this app crate; this just proves the actor's generic
    /// `save()` path doesn't accidentally special-case entity).
    #[test]
    fn zero_edit_save_is_byte_identical_for_view_context_and_dashboard() {
        for (object_type_folder, name) in [
            ("neonView", "THHIT_ActivityMain_view"),
            ("neonContext", "THHIT_Tour"),
            ("neonDashboard", "Home"),
        ] {
            let path = fixture_copy(object_type_folder, name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "{object_type_folder}/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 4 (Undo/Redo korrekt): edit -> save (bytes A) -> undo -> save (must be
    /// byte-identical to the pristine original) -> redo -> save (must be byte-identical to A
    /// again). Verified on real on-disk bytes at every step, not just the in-memory value.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level() {
        let path = fixture_copy("entity", "THHIT_ExternalKeys_entity");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(node_id.clone(), "title".into(), WireValue::Text { value: "Edited_Title".into() })
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<title>Edited_Title</title>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        assert!(after_undo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(after_redo.can_undo);
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Same "Fertig"-Kriterium 4 check as above, run for the P4 second family - one distinct
    /// top-level-ish scalar field per object type (`neonView` has no `title`, per aod-format.md
    /// §1/§3, so it edits `layout.masterSlaveLayout.master` instead; `neonContext`/`neonDashboard`
    /// both have a real `title`).
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_view_context_and_dashboard() {
        for (object_type_folder, name, path_str, new_value) in [
            ("neonView", "THHIT_ActivityMain_view", "layout.masterSlaveLayout.master", "11111111-1111-1111-1111-111111111111"),
            ("neonContext", "THHIT_Tour", "title", "Edited_Tour_Title"),
            ("neonDashboard", "Home", "title", "Edited_Dashboard_Title"),
        ] {
            let path = fixture_copy(object_type_folder, name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor
                .set_property(node_id.clone(), path_str.into(), WireValue::Text { value: new_value.into() })
                .unwrap();
            actor.save(node_id.clone()).unwrap();
            let edited_bytes = std::fs::read(&path).unwrap();
            assert_ne!(edited_bytes, original_bytes, "{object_type_folder}/{name}: edit must change the bytes");

            let after_undo = actor.undo(node_id.clone()).unwrap();
            assert!(!after_undo.can_undo);
            actor.save(node_id.clone()).unwrap();
            let undone_bytes = std::fs::read(&path).unwrap();
            assert_eq!(undone_bytes, original_bytes, "{object_type_folder}/{name}: undo must restore the original bytes");

            let after_redo = actor.redo(node_id.clone()).unwrap();
            assert!(!after_redo.can_redo);
            actor.save(node_id).unwrap();
            let redone_bytes = std::fs::read(&path).unwrap();
            assert_eq!(redone_bytes, edited_bytes, "{object_type_folder}/{name}: redo must reproduce the edited bytes");

            cleanup(&path);
        }
    }

    #[test]
    fn diagnostics_flag_a_duplicate_field_name_in_a_real_fixture_copy() {
        let path = fixture_copy("entity", "THHIT_Committee_entity");
        // Deliberately corrupt a copy to create a duplicate entityField name for the validator
        // to catch - never touches the original fixture.
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("DATE_NEW", "DATE_EDIT", 1);
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate entityField name 'DATE_EDIT'")));

        cleanup(&path);
    }

    /// Actor-integration test (not just the pure validator unit tests in
    /// `view_context_dashboard_validators.rs`): the `object_type` dispatch table in
    /// `list_diagnostics` must actually route a `neonView` node id to the view validators - proven
    /// against a real, corrupted fixture copy, same bar as the entity test above.
    #[test]
    fn diagnostics_flag_a_dangling_master_reference_in_a_real_view_fixture_copy() {
        let path = fixture_copy("neonView", "THHIT_ActivityMain_view");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<master>aba154fa-0375-4b3b-9427-e3e5c6fbed46</master>",
            "<master>does-not-exist</master>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's master UUID text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("does-not-exist")));

        cleanup(&path);
    }

    /// Same actor-integration proof for `neonContext` dispatch.
    #[test]
    fn diagnostics_flag_a_primary_view_missing_from_the_catalogue_in_a_real_context_fixture_copy() {
        let path = fixture_copy("neonContext", "THHIT_Tour");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<filterView>THHIT_TourFilter_view</filterView>",
            "<filterView>THHIT_TourFilter_v2_view</filterView>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's filterView text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("THHIT_TourFilter_v2_view")));

        cleanup(&path);
    }

    /// Same actor-integration proof for `neonDashboard` dispatch.
    #[test]
    fn diagnostics_flag_overlapping_dashlets_in_a_real_dashboard_fixture_copy() {
        let path = fixture_copy("neonDashboard", "Home");
        let original = std::fs::read_to_string(&path).unwrap();
        // MailDropzoneDashlet is the only dashlet at xPos=1 - moving it onto InformationDashlet's
        // (0, 0) cell creates a real overlap.
        let corrupted = original.replacen("<xPos v=\"1\" />", "<xPos v=\"0\" />", 1);
        assert_ne!(original, corrupted, "the fixture's xPos=1 text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("(0, 0)")));

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 1 for the P4 third family (`aliasDefinition`), **including** the
    /// documented `customProperties` indentation quirk (aod-format.md §1.2, `p4-editor-alias-db.md`
    /// prerequisite reading point 3): `THHIT_Data_alias` has 54 `customProperties` occurrences whose
    /// surrounding indentation deviates from the file's normal 2-space nesting - a byte-identical
    /// zero-edit save through this fixture is the real proof the serializer preserves that quirk
    /// rather than just the simple/regular case (`THHIT_System_alias`, no `customProperties` at all).
    #[test]
    fn zero_edit_save_is_byte_identical_for_alias_including_the_customproperties_quirk() {
        for (object_type_folder, name) in [
            ("aliasDefinition", "THHIT_Data_alias"),   // has the customProperties indentation quirk
            ("aliasDefinition", "THHIT_System_alias"), // simple case, no customProperties at all
        ] {
            let path = fixture_copy(object_type_folder, name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "{object_type_folder}/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 4 for `aliasDefinition`: edit `targetAliasName` -> save -> undo -> save
    /// (= original bytes) -> redo -> save (= edited bytes), all checked on real on-disk bytes.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_alias() {
        let path = fixture_copy("aliasDefinition", "THHIT_System_alias");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(
                node_id.clone(),
                "aliasDefinitionSub.aliasDefDb.targetAliasName".into(),
                WireValue::Text { value: "_____SYSTEMALIAS_EDITED".into() },
            )
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<targetAliasName>_____SYSTEMALIAS_EDITED</targetAliasName>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        assert!(after_undo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(after_redo.can_undo);
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Actor-integration proof for `aliasDefinition` dispatch, rule #1 (`EmptyTargetAliasNameValidator`)
    /// - against a real, corrupted fixture copy, same bar as the entity/view/context/dashboard tests.
    #[test]
    fn diagnostics_flag_an_empty_target_alias_name_in_a_real_alias_fixture_copy() {
        let path = fixture_copy("aliasDefinition", "THHIT_System_alias");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<targetAliasName>_____SYSTEMALIAS</targetAliasName>",
            "<targetAliasName></targetAliasName>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's targetAliasName text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("targetAliasName is empty")));

        cleanup(&path);
    }

    /// Actor-integration proof for `aliasDefinition` dispatch, rule #2 (`DuplicateColumnNameValidator`)
    /// - renames one `entityFieldDb.name` in the `THHIT_AUDIT` table to collide with a sibling
    /// column (`AUDITID`) in that same table.
    #[test]
    fn diagnostics_flag_a_duplicate_column_name_in_a_real_alias_fixture_copy() {
        let path = fixture_copy("aliasDefinition", "THHIT_Data_alias");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<name>DATASETID</name>", "<name>AUDITID</name>", 1);
        assert_ne!(original, corrupted, "the fixture's DATASETID text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate column name 'AUDITID'")));

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 1 for the P4 fourth family (`language`): a zero-edit save through both
    /// real fixtures must reproduce the exact original bytes - `_____LANGUAGE_de` (1710 lines, 425
    /// `stringEntry` pairs, the full realistic case) and `_____LANGUAGE_pl` (14 lines, a single
    /// entry, the simple case) - aod-format.md §1.2 already documents `language` files as one of
    /// the "cleanly-generated, no indentation quirk" object types, so this is expected to pass
    /// without any language-specific serializer work, same as the two prior families' own
    /// byte-fidelity tests already proved for their own fixtures.
    #[test]
    fn zero_edit_save_is_byte_identical_for_language() {
        for name in ["_____LANGUAGE_de", "_____LANGUAGE_pl"] {
            let path = fixture_copy("language", name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "language/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 4 for `language`: edit the one real translation value in the simple
    /// `_____LANGUAGE_pl` fixture -> save -> undo -> save (= original bytes) -> redo -> save (=
    /// edited bytes), all checked on real on-disk bytes - same shape as the alias family's own
    /// undo/redo proof.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_language() {
        let path = fixture_copy("language", "_____LANGUAGE_pl");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        // `_____LANGUAGE_pl` has exactly one `stringEntry` - core-model's real projector only
        // collapses same-tag siblings into an indexed `Array` when there is more than one
        // occurrence (`core-model/src/aod_io_adapter.rs::group_children`), so the single entry's
        // path here is the un-indexed `keyValueMap.stringEntry.value`, not `...stringEntry[0]...`.
        actor
            .set_property(
                node_id.clone(),
                "keyValueMap.stringEntry.value".into(),
                WireValue::Text { value: "Zmieniona wartość".into() },
            )
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<value>Zmieniona wartość</value>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        assert!(after_undo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(after_redo.can_undo);
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Actor-integration proof for `language` dispatch, rule #1 (`DuplicateTranslationKeyValidator`)
    /// - against a real, corrupted fixture copy: renames the `Added` entry's key to collide with
    /// the sibling `Pending` entry, both present in the real, uncorrupted `_____LANGUAGE_de` file.
    #[test]
    fn diagnostics_flag_a_duplicate_translation_key_in_a_real_language_fixture_copy() {
        let path = fixture_copy("language", "_____LANGUAGE_de");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<name>Added</name>", "<name>Pending</name>", 1);
        assert_ne!(original, corrupted, "the fixture's Added key text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate translation key 'Pending'")));

        cleanup(&path);
    }

    /// Actor-integration proof for `language` dispatch, rule #2 (`EmptyTranslationValueValidator`)
    /// - against a real, corrupted fixture copy: blanks the `Added` entry's real translation value.
    #[test]
    fn diagnostics_flag_an_empty_translation_value_in_a_real_language_fixture_copy() {
        let path = fixture_copy("language", "_____LANGUAGE_de");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<value>Hinzugefügt</value>", "<value></value>", 1);
        assert_ne!(original, corrupted, "the fixture's Hinzugefügt value text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("translation value is empty")));

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 1 for the P4 fifth family (`system`/`preferences`/`application`): a
    /// zero-edit save through all three real fixtures must reproduce the exact original bytes -
    /// `system` gets two instances (`dev1`: the common shape, `prod`: the one with the typed
    /// `productiveSystem` attribute) since the object type has no repeated child elements at all
    /// (no R26 relevance there, see `system_validators.rs`'s module doc).
    #[test]
    fn zero_edit_save_is_byte_identical_for_system_preferences_and_application() {
        for (object_type_folder, name) in [
            ("system", "dev1"),
            ("system", "prod"),
            ("preferences", "_____PREFERENCES_PROJECT"),
            ("application", "_____SYSTEM_APPLICATION_NEON"),
        ] {
            let path = fixture_copy(object_type_folder, name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "{object_type_folder}/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 1 for `entityWebservice` (P4 sixth family): all three real fixtures cover
    /// the family's own R26 shapes - `THHIT_Tour_ws` (single `webserviceMethods`/`loginTypeId`
    /// element, single `webserviceFieldConsumer` with its own nested list), `Operation_ws` (5-element
    /// `webserviceMethods` array, a `webserviceFieldConsumer` with no nested fields of its own), and
    /// `THHIT_PersonUpdate_ws` (a single, un-indexed `webserviceField` total - the minimal real
    /// shape). Zero-edit save must reproduce the exact original bytes for all three.
    #[test]
    fn zero_edit_save_is_byte_identical_for_entity_webservice() {
        for name in ["THHIT_Tour_ws", "Operation_ws", "THHIT_PersonUpdate_ws"] {
            let path = fixture_copy("entityWebservice", name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "entityWebservice/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 4 for `entityWebservice`: edit `readProvider` -> save -> undo -> save (=
    /// original bytes) -> redo -> save (= edited bytes), all checked on real on-disk bytes.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_entity_webservice() {
        let path = fixture_copy("entityWebservice", "Operation_ws");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(node_id.clone(), "readProvider".into(), WireValue::Text { value: "#EDITED_PROVIDER".into() })
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<readProvider>#EDITED_PROVIDER</readProvider>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Actor-integration proof for `entityWebservice` dispatch #1 - against a real, corrupted
    /// fixture copy: strips `Operation_ws`'s 5 real `webserviceMethods` down to none.
    #[test]
    fn diagnostics_flag_empty_webservice_methods_in_a_real_webservice_fixture_copy() {
        let path = fixture_copy("entityWebservice", "Operation_ws");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "  <webserviceMethods>\r\n    <element>GET</element>\r\n    <element>POST</element>\r\n    <element>PUT</element>\r\n    <element>DELETE</element>\r\n    <element>PATCH</element>\r\n  </webserviceMethods>\r\n",
            "  <webserviceMethods></webserviceMethods>\r\n",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's webserviceMethods block must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("no HTTP method")));

        cleanup(&path);
    }

    /// Actor-integration proof for `entityWebservice` dispatch #2 - against a real, corrupted
    /// fixture copy: renames `THHIT_Tour_ws`'s `COUNTRY` field to collide with its real sibling
    /// `TOURTITLE` in the same top-level `webserviceFields` scope.
    #[test]
    fn diagnostics_flag_a_duplicate_webservice_field_name_in_a_real_webservice_fixture_copy() {
        let path = fixture_copy("entityWebservice", "THHIT_Tour_ws");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<webserviceFieldName>COUNTRY</webserviceFieldName>", "<webserviceFieldName>TOURTITLE</webserviceFieldName>", 1);
        assert_ne!(original, corrupted, "the fixture's COUNTRY field name must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate webserviceFieldName 'TOURTITLE'")));

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 1 for `report` (P4 seventh family): all three real fixtures cover the
    /// family's own R26 shapes - `Organisation_report` (4-element `subReports`/3-element `images`
    /// arrays, plus `icon`/`iconInactive`), `Salesorder_report` (single un-indexed `subreport`/
    /// `image`, an `alias`), and `THHIT_ResourceOperation_report` (the minimal real shape - no
    /// `subReports`/`images` at all). Zero-edit save must reproduce the exact original `.aod`
    /// bytes for all three. The carried `.jrxml` resource files sitting alongside each fixture in
    /// `tests/fixtures/DemoProject/report/` are not touched by `fixture_copy` (it copies only the
    /// `.aod`, see its own doc comment) or by anything `ReportEditor`/this actor calls - there is
    /// no code path in this family that ever opens or writes a `.jrxml`/`.jasper` byte at all
    /// (module doc's "carried, not edited" decision), so no separate byte-identity assertion for
    /// them is needed here.
    #[test]
    fn zero_edit_save_is_byte_identical_for_report() {
        for name in ["Organisation_report", "Salesorder_report", "THHIT_ResourceOperation_report"] {
            let path = fixture_copy("report", name);
            let original_bytes = std::fs::read(&path).unwrap();
            let node_id = path.to_string_lossy().into_owned();
            let actor = ProjectActorHandle::spawn();

            actor.get_property_tree(node_id.clone()).unwrap();
            actor.save(node_id).unwrap();

            let after_bytes = std::fs::read(&path).unwrap();
            assert_eq!(after_bytes, original_bytes, "report/{name}: save without any edit must not change a single byte");

            cleanup(&path);
        }
    }

    /// "Fertig"-Kriterium 4 for `report`: edit `title` -> save -> undo -> save (= original bytes) ->
    /// redo -> save (= edited bytes), all checked on real on-disk bytes.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_report() {
        let path = fixture_copy("report", "Organisation_report");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(node_id.clone(), "title".into(), WireValue::Text { value: "Edited Title".into() })
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<title>Edited Title</title>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Actor-integration proof for `report` dispatch #1 - against a real, corrupted fixture copy:
    /// blanks `THHIT_ResourceOperation_report`'s real `reportData` path.
    #[test]
    fn diagnostics_flag_empty_report_data_in_a_real_report_fixture_copy() {
        let path = fixture_copy("report", "THHIT_ResourceOperation_report");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<reportData>%aditoprj%/report/THHIT_ResourceOperation_report/reportData.jrxml</reportData>",
            "<reportData></reportData>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's reportData value must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("no design source")));

        cleanup(&path);
    }

    /// Actor-integration proof for `report` dispatch #2 - against a real, corrupted fixture copy:
    /// renames `Organisation_report`'s `Aufgaben` subreport to collide with its real sibling
    /// `Historien` in the same `subReports` scope.
    #[test]
    fn diagnostics_flag_a_duplicate_subreport_name_in_a_real_report_fixture_copy() {
        let path = fixture_copy("report", "Organisation_report");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<name>Aufgaben</name>", "<name>Historien</name>", 1);
        assert_ne!(original, corrupted, "the fixture's Aufgaben subreport name must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate subreport name 'Historien'")));

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 4 for `system`: edit `serverConfigPath` -> save -> undo -> save (=
    /// original bytes) -> redo -> save (= edited bytes), all checked on real on-disk bytes.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_system() {
        let path = fixture_copy("system", "dev1");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(node_id.clone(), "serverConfigPath".into(), WireValue::Text { value: "$PROJECTHOME/edited.xml".into() })
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<serverConfigPath>$PROJECTHOME/edited.xml</serverConfigPath>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        assert!(after_undo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(after_redo.can_undo);
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 4 for `preferences`: edit `projectName` -> save -> undo -> save (=
    /// original bytes) -> redo -> save (= edited bytes).
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_preferences() {
        let path = fixture_copy("preferences", "_____PREFERENCES_PROJECT");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(node_id.clone(), "projectName".into(), WireValue::Text { value: "Edited Project Name".into() })
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<projectName>Edited Project Name</projectName>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// "Fertig"-Kriterium 4 for `application`: edit a nested node's `title`
    /// (`entityNode.childNodes.entityNode[0].title`, the first real child "Contactmanagement" ->
    /// "Contact Management") -> save -> undo -> save (= original bytes) -> redo -> save (= edited
    /// bytes) - proves the write-back path works at real recursive depth, not just at the root.
    #[test]
    fn edit_undo_redo_round_trips_on_byte_level_for_application() {
        let path = fixture_copy("application", "_____SYSTEM_APPLICATION_NEON");
        let original_bytes = std::fs::read(&path).unwrap();
        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();

        actor.get_property_tree(node_id.clone()).unwrap();
        actor
            .set_property(
                node_id.clone(),
                "entityNode.childNodes.entityNode[0].title".into(),
                WireValue::Text { value: "Edited Title".into() },
            )
            .unwrap();
        actor.save(node_id.clone()).unwrap();
        let edited_bytes = std::fs::read(&path).unwrap();
        assert_ne!(edited_bytes, original_bytes, "the edit must actually have changed the bytes");
        assert!(String::from_utf8_lossy(&edited_bytes).contains("<title>Edited Title</title>"));

        let after_undo = actor.undo(node_id.clone()).unwrap();
        assert!(!after_undo.can_undo);
        actor.save(node_id.clone()).unwrap();
        let undone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(undone_bytes, original_bytes, "undo must restore the exact original bytes");

        let after_redo = actor.redo(node_id.clone()).unwrap();
        assert!(!after_redo.can_redo);
        actor.save(node_id.clone()).unwrap();
        let redone_bytes = std::fs::read(&path).unwrap();
        assert_eq!(redone_bytes, edited_bytes, "redo must reproduce the exact edited bytes");

        cleanup(&path);
    }

    /// Actor-integration proof for `system` dispatch - against a real, corrupted fixture copy.
    #[test]
    fn diagnostics_flag_an_empty_server_config_path_in_a_real_system_fixture_copy() {
        let path = fixture_copy("system", "dev1");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<serverConfigPath>$PROJECTHOME/others/cloud/hermes1.dev.htc1.adito.cloud_serverconfig_system.xml</serverConfigPath>",
            "<serverConfigPath></serverConfigPath>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's serverConfigPath text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("serverConfigPath is empty")));

        cleanup(&path);
    }

    /// Actor-integration proof for `preferences` dispatch - against a real, corrupted fixture copy.
    #[test]
    fn diagnostics_flag_mail_enabled_without_a_repository_alias_in_a_real_preferences_fixture_copy() {
        let path = fixture_copy("preferences", "_____PREFERENCES_PROJECT");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen(
            "<mailRepositoryAlias>defaultDbRepository</mailRepositoryAlias>",
            "<mailRepositoryAlias></mailRepositoryAlias>",
            1,
        );
        assert_ne!(original, corrupted, "the fixture's mailRepositoryAlias text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("mailRepositoryAlias is empty")));

        cleanup(&path);
    }

    /// Actor-integration proof for `application` dispatch - renames `Group22`'s `SearchSync` child
    /// to collide with its sibling `INTERNAL_ADMINISTRATOR` (both real, present in the same
    /// `childNodes` group in the uncorrupted fixture).
    #[test]
    fn diagnostics_flag_a_duplicate_sibling_name_in_a_real_application_fixture_copy() {
        let path = fixture_copy("application", "_____SYSTEM_APPLICATION_NEON");
        let original = std::fs::read_to_string(&path).unwrap();
        let corrupted = original.replacen("<name>SearchSync</name>", "<name>INTERNAL_ADMINISTRATOR</name>", 1);
        assert_ne!(original, corrupted, "the fixture's SearchSync text must match exactly for this test to be meaningful");
        std::fs::write(&path, corrupted).unwrap();

        let node_id = path.to_string_lossy().into_owned();
        let actor = ProjectActorHandle::spawn();
        let diagnostics = actor.list_diagnostics(node_id).unwrap();

        assert!(diagnostics.iter().any(|d| d.message.contains("duplicate entityNode name 'INTERNAL_ADMINISTRATOR'")));

        cleanup(&path);
    }

    fn find_text(value: &WireValue, path: &[&str]) -> Option<String> {
        let mut current = value;
        for segment in path {
            match current {
                WireValue::Object { fields } => {
                    current = &fields.iter().find(|f| f.key == *segment)?.value;
                }
                _ => return None,
            }
        }
        match current {
            WireValue::Text { value } => Some(value.clone()),
            _ => None,
        }
    }
}
