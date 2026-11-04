// Fourth real `OwnEngine` stage of the own Rust transpiler pipeline (Forge P5), after
// `copy_phase_stage`. Implements the modification-application portion of `transpiler.md` §3: for
// every module the resolver stage reaches, reads its `modification/<id>/<id>.aod` files and
// applies the INSERT/MODIFY/DELETE change each one describes to the already-copied `dist`-
// equivalent files in `output_dir`.
//
// Corpus research (this agent's Phase 1, see `p5-modification-engine-notes.md` for the full
// writeup): searched the entire real-corpus modification set reachable from Hermes (912 files at
// the project root plus 1665 more inside `node_modules/*/modification/`, 2577 total - far more
// than the 250-file sample `transpiler-spec` originally counted). Grouped every file by its
// `<path>` value, restricted to entries sharing a changeType of MODIFY on the SAME scalar leaf,
// to look for a genuine conflict (`transpiler.md` §3's open `ModificationNotApplicableException`
// question - every OTHER duplicate `<path>` found, 297 across the widened corpus, is a shared
// ARRAY COLLECTION being appended to by independent INSERTs, not a conflict).
//
// This found TWO REAL conflicts - the finding `transpiler.md` §3 flagged as most valuable if
// located. Both have the same shape: the Hermes project root AND a dependency module (once
// `@3hills-IT/vendira`, once `@3hills-IT/pos-order`) each ship a MODIFY on the identical scalar
// leaf (`Communication_entity/entityFields/ADDR/valueProcess`,
// `Order_entity/entityFields/DELIVERYADDRESS/mandatoryProcess`), each pointing at a genuinely
// different script body. Comparing both against Hermes's own real `dist/` output settles it
// definitively: **the project root's script wins in both cases - including the
// `DELIVERYADDRESS/mandatoryProcess` case, where the DEPENDENCY's `<position>` (1778848099) is
// numerically LATER than the project root's (1776241591)**. `<position>` therefore does NOT
// decide a real conflict; module precedence does. This matches, and is now real-corpus proof for,
// the same "project root beats any dependency" rule already established for copy-phase path
// collisions and module-graph diamond overrides (`transpiler.md` §2/§4) - one unified precedence
// rule across the whole transpiler, not three separate ones. `transpiler.md` §3 has been updated
// to resolve this UNVERIFIED marking; see `p5-modification-engine-notes.md` for the full evidence
// trail (file paths, positions, script diffs, dist excerpt).
//
// This stage therefore applies modifications in two tiers per target file: every dependency
// module's modifications first (ordered by `<position>` among themselves, still the only ordering
// signal available there and never observed to conflict), then every project-root modification
// last (also `<position>`-ordered among themselves) - so a project-root MODIFY always overwrites
// whatever a dependency wrote, matching the real corpus. Within-tier ordering (two dependencies,
// or two project-root modifications, conflicting with each other) was never observed in the
// corpus and remains UNVERIFIED-but-plausible position-ordering, covered by one clearly-labeled
// synthetic test per the role brief's instruction for exactly this situation.
//
// Also confirmed empirically (not previously documented in `transpiler.md` §3): a DELETE can
// target an element that only exists because an earlier (lower `position`) INSERT from a
// DIFFERENT modification created it - i.e. modifications for one target file are not independent
// of each other and must be applied sequentially against the evolving document, not each against
// the pristine copied file. This stage does exactly that (see `apply_all_to_file`).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use aod_io::{
    build_index, delete_range, insert_at, replace_text_at, AodDocument, AodEvent, EventIndex,
    EventPath, IndexedRange, PathStep, SiblingHint,
};
use module_graph::{ModuleDefinition, ModuleGraph};

use crate::own_engine::copy_phase_stage::{run_copy_phase, CopyPhaseError};
use crate::own_engine::resolver_stage::resolve_module_graph;
use crate::own_engine::{OwnEngine, OwnEngineError};

#[derive(Debug, thiserror::Error)]
pub enum ModificationEngineError {
    #[error(transparent)]
    CopyPhase(#[from] CopyPhaseError),
    #[error("failed to read modification file {path}: {source}")]
    ReadModification { path: PathBuf, source: std::io::Error },
    #[error("failed to parse modification file {path}: {source}")]
    ParseModification { path: PathBuf, source: aod_io::AodError },
    #[error("modification file {path} is missing required field <{field}>")]
    MissingField { path: PathBuf, field: &'static str },
    #[error("failed to write {path}: {source}")]
    Write { path: PathBuf, source: platform::error::PlatformError },
}

/// One `changeType` value, restricted to the three values ever observed on the XML wire
/// (`transpiler.md` §3 - the five/seven Java-side operation names the chief architect originally
/// expected turned out to be an internal distinction the transpiler itself derives from
/// `changeType` + target path shape, not a separate XML value; see [`Operation`] below for how
/// this stage reconstructs that distinction).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChangeType {
    Insert,
    Modify,
    Delete,
}

/// The finer operation classification from `transpiler.md` §3, derived from `ChangeType` plus
/// the resolved target's shape - kept only for diagnostics/reporting, since applying a change
/// never actually branches on it: `ArrayInsert`/`DynamicPrimitiveInsert` both reduce to "insert an
/// element under this container", `ArrayDelete` to "delete this element", and a scalar `Modify`
/// to "replace this leaf's text". No case in the real corpus (searched in Phase 1) required
/// telling `ArrayInsert` apart from a hypothetical `DynamicPrimitiveInsert`, so this stage does
/// not attempt that distinction at runtime - see the notes file for why it stays UNVERIFIED.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    ArrayInsert,
    Modify,
    ArrayDelete,
}

struct ParsedModification {
    position: i64,
    change_type: ChangeType,
    model_type: String,
    model_name: String,
    /// `<path>` split on `/`, WITHOUT the leading `modelName` segment (that segment only
    /// re-states the file selector already carried by `model_type`/`model_name`, never a real
    /// traversal step - confirmed against every real `<path>` value read in Phase 1).
    path_segments: Vec<String>,
    /// Raw bytes to feed to `insert_at`'s `template_bytes` (INSERT) or `replace_text_at`'s
    /// `new_bytes` (MODIFY) - already in the byte-faithful, pre-escaped form both take. `None`
    /// for DELETE, which carries no `<value>`.
    payload: Option<Vec<u8>>,
    /// True for boolean/int wrappers: the payload is the `v` attribute value of the inner
    /// `<value v=".." />`, so a MODIFY replaces the typed `v` attribute of the target instead of its text.
    payload_is_attr: bool,
    /// True when this modification's own `modification/` directory is the project root's,
    /// false for a dependency module - the real-corpus-verified precedence tier (see module doc
    /// comment: project root always wins a same-leaf MODIFY conflict, regardless of
    /// `<position>`). Set by the caller (`run_modification_phase`), which is the only place that
    /// knows which module a given file came from.
    is_project_root: bool,
    source_file: PathBuf,
}

/// Diagnostics from a modification-engine run - mirrors `CopyPhaseReport`'s "just enough to
/// sanity-check a run" scope; `compare.rs` remains the actual correctness authority.
#[derive(Debug, Default, Clone)]
pub struct ModificationEngineReport {
    pub modifications_found: usize,
    pub modifications_applied: usize,
    pub modifications_failed: usize,
    /// `(source .aod path, reason)` for every modification this stage could not apply - kept
    /// small and structured rather than dumped to stdout, per the context-discipline guardrail
    /// (a full Hermes run can produce a couple thousand of these in the worst case; callers
    /// decide what to do with them, this stage never prints).
    pub failures: Vec<(PathBuf, String)>,
}

/// Locates every `modification/<id>/<id>.aod` file reachable from a module's own directory
/// (real corpus layout: `<module>/modification/<uuid-or-slug>/<same-name>.aod`, one file per
/// subdirectory - Phase 1 found 2577 of these across Hermes and its dependencies, including
/// several whose directory name is a truncated slug rather than a bare UUID, so this globs by
/// structure - "exactly one `.aod` file per immediate subdirectory of `modification/`" - rather
/// than assuming a UUID-shaped name).
fn find_modification_files(module_path: &Path) -> Vec<PathBuf> {
    let mod_dir = module_path.join("modification");
    let Ok(entries) = fs::read_dir(&mod_dir) else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let sub = entry.path();
        if !sub.is_dir() {
            continue;
        }
        let Ok(sub_entries) = fs::read_dir(&sub) else { continue };
        for f in sub_entries.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("aod") {
                files.push(p);
            }
        }
    }
    files
}

fn child_path(parent: &EventPath, tag: &str, occurrence: usize) -> EventPath {
    let mut steps = parent.0.clone();
    steps.push(PathStep::Child { tag: tag.to_string(), occurrence });
    EventPath(steps)
}

fn attribute_path(parent: &EventPath, name: &str) -> EventPath {
    let mut steps = parent.0.clone();
    steps.push(PathStep::Attribute(name.to_string()));
    EventPath(steps)
}

fn read_scalar_child(doc: &AodDocument, index: &EventIndex, parent: &EventPath, tag: &str) -> Option<String> {
    let p = child_path(parent, tag, 0);
    let idx = index.text_event_index(doc, &p)?;
    match &doc.events[idx] {
        AodEvent::Text(b) => Some(String::from_utf8_lossy(b).into_owned()),
        _ => None,
    }
}

/// Parses one `modification/<id>/<id>.aod` file's envelope (`transpiler.md` §3's documented
/// common structure). Reuses `aod-io::parse`/`build_index` for this too - the modification
/// envelope is itself a well-formed `.aod`-shaped XML document, so the same event-stream/index
/// machinery this stage uses for the TARGET file applies unchanged here; no separate XML layer
/// was written for this side.
fn parse_modification_file(path: &Path, is_project_root: bool) -> Result<ParsedModification, ModificationEngineError> {
    let bytes = fs::read(path).map_err(|source| ModificationEngineError::ReadModification {
        path: path.to_path_buf(),
        source,
    })?;
    let doc = aod_io::parse(&bytes).map_err(|source| ModificationEngineError::ParseModification {
        path: path.to_path_buf(),
        source,
    })?;
    let index = build_index(&doc);
    let root = EventPath(vec![PathStep::Child { tag: "modification".to_string(), occurrence: 0 }]);

    let missing = |field: &'static str| ModificationEngineError::MissingField { path: path.to_path_buf(), field };

    let change_type_raw = read_scalar_child(&doc, &index, &root, "changeType").ok_or_else(|| missing("changeType"))?;
    let change_type = match change_type_raw.as_str() {
        "INSERT" => ChangeType::Insert,
        "MODIFY" => ChangeType::Modify,
        "DELETE" => ChangeType::Delete,
        other => return Err(ModificationEngineError::MissingField { path: path.to_path_buf(), field: Box::leak(format!("changeType (unknown value {other:?})").into_boxed_str()) }),
    };
    let model_type = read_scalar_child(&doc, &index, &root, "modelType").ok_or_else(|| missing("modelType"))?;
    let model_name = read_scalar_child(&doc, &index, &root, "modelName").ok_or_else(|| missing("modelName"))?;
    let full_path = read_scalar_child(&doc, &index, &root, "path").ok_or_else(|| missing("path"))?;

    // Position lives in an attribute (`<position v="..." />`), not element text.
    let position_element = child_path(&root, "position", 0);
    let position_attr = attribute_path(&position_element, "v");
    let position = match index.get(&position_attr) {
        Some(IndexedRange::Attribute { event, value_bytes }) => match &doc.events[*event] {
            AodEvent::Empty(raw) | AodEvent::Start(raw) => {
                String::from_utf8_lossy(&raw[value_bytes.clone()]).parse::<i64>().unwrap_or(0)
            }
            _ => 0,
        },
        _ => 0,
    };

    // `<path>` segments, dropping the leading modelName selector segment (see `ParsedModification`
    // doc comment) - real corpus values always start with the exact modelName, confirmed across
    // every file read in Phase 1.
    let mut segments: Vec<String> = full_path.split('/').map(str::to_string).collect();
    if !segments.is_empty() {
        segments.remove(0);
    }

    let (payload, payload_is_attr) = match extract_payload(&doc, &index, &root, change_type) {
        Some((bytes, is_attr)) => (Some(bytes), is_attr),
        None => (None, false),
    };

    Ok(ParsedModification {
        position,
        change_type,
        model_type,
        model_name,
        path_segments: segments,
        payload,
        payload_is_attr,
        is_project_root,
        source_file: path.to_path_buf(),
    })
}

/// Extracts the INSERT/MODIFY payload bytes from the modification envelope's `<value>` wrapper
/// (`transpiler.md` §3: `<value><stringValueWrapper|modelValueWrapper><name>value</name>
/// <value>...</value></...></value>` - two nested `<value>` tags, the inner one carrying the
/// actual payload). `None` for DELETE (no `<value>` at all) or if the wrapper shape does not
/// match (defensive - a real corpus surprise here should degrade to "skip this modification",
/// not panic the whole pipeline).
fn extract_payload(doc: &AodDocument, index: &EventIndex, root: &EventPath, change_type: ChangeType) -> Option<(Vec<u8>, bool)> {
    if change_type == ChangeType::Delete {
        return None;
    }
    let outer_value = child_path(root, "value", 0);
    index.get(&outer_value)?;
    let wrapper_tag = ["stringValueWrapper", "modelValueWrapper", "enumValueWrapper", "booleanValueWrapper", "intValueWrapper"]
        .into_iter()
        .find(|t| index.get(&child_path(&outer_value, t, 0)).is_some())?;
    let wrapper = child_path(&outer_value, wrapper_tag, 0);
    let inner_value = child_path(&wrapper, "value", 0);

    match change_type {
        ChangeType::Modify => {
            // Typed scalar (boolean/int wrapper): the value sits in the `v` attribute.
            if let Some(IndexedRange::Attribute { event, value_bytes }) = index.get(&attribute_path(&inner_value, "v")) {
                if let AodEvent::Empty(raw) | AodEvent::Start(raw) = &doc.events[*event] {
                    return Some((raw[value_bytes.clone()].to_vec(), true));
                }
            }
            // Scalar case: the inner `<value>` holds exactly one Text event, already in the
            // pre-escaped byte form `replace_text_at` expects verbatim - no re-encoding needed,
            // the bytes are simply moved from the modification file's own event stream.
            let text_idx = index.text_event_index(doc, &inner_value)?;
            match &doc.events[text_idx] {
                AodEvent::Text(b) => Some((b.clone(), false)),
                _ => None,
            }
        }
        ChangeType::Insert => {
            // Structural case: the inner `<value>`'s own content (its child element, `insert_at`
            // trims surrounding whitespace itself) is the template to insert - re-serialize just
            // that event slice via aod-io's own `serialize`, reusing the same byte-faithful writer
            // rather than hand-rolling XML.
            match index.get(&inner_value) {
                // A plain text value inserted into a list of texts (`siblings`, `variants`, ...): each
                // entry of such a list is an `<element>`.
                Some(IndexedRange::Element(range)) if range.len() == 3 && matches!(&doc.events[range.start + 1], AodEvent::Text(b) if !b.iter().all(|c| c.is_ascii_whitespace())) => {
                    let AodEvent::Text(text) = &doc.events[range.start + 1] else { return None };
                    let mut entry = b"<element>".to_vec();
                    entry.extend_from_slice(text);
                    entry.extend_from_slice(b"</element>");
                    Some((entry, false))
                }
                Some(IndexedRange::Element(range)) if range.len() > 2 => {
                    let inner_events = doc.events[range.start + 1..range.end - 1].to_vec();
                    Some((aod_io::serialize(&AodDocument { events: inner_events }), false))
                }
                _ => None,
            }
        }
        ChangeType::Delete => unreachable!("handled above"),
    }
}

/// Fixed nesting depth, WITHIN THE MODIFICATION FILE ITSELF, at which an INSERT's payload root
/// element sits: `<modification>` (depth 1) contains `<value>` (2) contains `<modelValueWrapper>`
/// (3) contains `<value>` (4) contains the PAYLOAD ROOT (5) - `transpiler.md` §3's envelope,
/// stable across every real INSERT observed in the corpus (see `extract_payload`'s doc comment).
/// `standard_indent(5)` (10 spaces) is therefore the indent every payload template carries for
/// ITS OWN children, regardless of where it ends up being inserted.
const INSERT_PAYLOAD_SOURCE_DEPTH: usize = 5;

/// Parses a whitespace-only indentation `Text` event's bytes (`\r\n` + N spaces, aod-format.md
/// §1.2) back into its depth (`N / 2`). `None` for anything that is not that exact shape (plain
/// internal text content is never whitespace-only, so this only ever matches genuine indentation
/// runs between sibling tags).
fn indent_depth_of(bytes: &[u8]) -> Option<usize> {
    let spaces = bytes.strip_prefix(b"\r\n").or_else(|| bytes.strip_prefix(b"\n"))?;
    if !spaces.is_empty() && spaces.iter().all(|&b| b == b' ') {
        Some(spaces.len() / 2)
    } else {
        None
    }
}

/// Re-indents an INSERT template's internal whitespace from its depth INSIDE the modification
/// file (`INSERT_PAYLOAD_SOURCE_DEPTH`) to the depth it will actually occupy once spliced into
/// the target document (`target_root_depth` - the inserted root element's own `element_depth()`
/// once it exists in the target tree, i.e. one level deeper than the container `apply_one` is
/// inserting into).
///
/// Real-corpus bug this fixes (found by this agent comparing a real `insert_at` run against
/// Hermes's own `dist/neonContext/Order/Order.aod`): `aod_io::insert_at` only computes the
/// indent for the OUTER inserted element itself from the TARGET's structure - its own doc
/// comment says the template's "own nested content is copied through untouched", which is
/// correct for an interactive single-document edit but wrong here, because the template bytes
/// come from the MODIFICATION file's nesting, not the target's. Without this fix, every INSERT's
/// nested children (e.g. `<name>`/`<view>` under a newly inserted `<neonViewReference>`) carried
/// the modification envelope's indentation (10 spaces, depth 5) instead of the target's real
/// depth (6 spaces, depth 3 for a direct child of `Order/references`) - confirmed byte-for-byte
/// against the real `dist/` file, same element count (48 `neonViewReference`s on both sides) but
/// wrong indentation on every inserted element's children.
fn reindent_insert_template(payload: &[u8], target_root_depth: usize) -> Vec<u8> {
    canonical_property_order(&reindent_insert_template_raw(payload, target_root_depth))
}

/// An inserted element is written by the reference with its properties in the schema's order, not in
/// the order the modification file listed them (`stateProcess` before `mandatoryProcess` in the file,
/// the other way round in the output). Elements whose children are all distinct, known properties
/// are sorted; list wrappers (repeated children) and unknown tags keep their order.
fn canonical_property_order(payload: &[u8]) -> Vec<u8> {
    let Ok(doc) = aod_io::parse(payload) else { return payload.to_vec() };
    let events = doc.events;
    let mut out: Vec<AodEvent> = Vec::with_capacity(events.len());
    let mut i = 0;
    while i < events.len() {
        match &events[i] {
            AodEvent::Start(_) => {
                let end = matching_end(&events, i);
                out.extend(sort_element(&events[i..=end]));
                i = end + 1;
            }
            other => {
                out.push(other.clone());
                i += 1;
            }
        }
    }
    aod_io::serialize(&AodDocument { events: out })
}

fn matching_end(events: &[AodEvent], start: usize) -> usize {
    let mut depth = 0usize;
    for (k, ev) in events.iter().enumerate().skip(start) {
        match ev {
            AodEvent::Start(_) => depth += 1,
            AodEvent::End(_) => {
                depth -= 1;
                if depth == 0 {
                    return k;
                }
            }
            _ => {}
        }
    }
    events.len() - 1
}

fn is_blank_text(ev: &AodEvent) -> bool {
    matches!(ev, AodEvent::Text(b) if b.iter().all(|c| c.is_ascii_whitespace()))
}

/// `element` is a Start..End slice; its children are sorted when that is safe, recursively.
fn sort_element(element: &[AodEvent]) -> Vec<AodEvent> {
    let inner = &element[1..element.len() - 1];
    let mut items: Vec<Vec<AodEvent>> = Vec::new();
    let mut indent: Option<AodEvent> = None;
    let mut closing: Option<AodEvent> = None;
    let mut i = 0;
    while i < inner.len() {
        match &inner[i] {
            ev if is_blank_text(ev) => {
                if items.is_empty() && indent.is_none() {
                    indent = Some(ev.clone());
                }
                closing = Some(ev.clone());
                i += 1;
            }
            AodEvent::Start(_) => {
                let end = matching_end(inner, i);
                items.push(sort_element(&inner[i..=end]));
                closing = None;
                i = end + 1;
            }
            AodEvent::Empty(_) => {
                items.push(vec![inner[i].clone()]);
                closing = None;
                i += 1;
            }
            _ => return element.to_vec(),
        }
    }
    let tag_of = |item: &Vec<AodEvent>| item[0].tag_bytes().map(tag_name_of).unwrap_or_default();
    let tags: Vec<String> = items.iter().map(tag_of).collect();
    let distinct = tags.iter().collect::<std::collections::HashSet<_>>().len() == tags.len();
    let parent_tag = element[0].tag_bytes().map(tag_name_of).unwrap_or_default();
    if distinct && items.len() > 1 {
        if let Some(order) = catalog_order(&parent_tag) {
            if tags.iter().all(|t| order.contains(t)) {
                let rank = |t: &String| order.iter().position(|o| o == t).unwrap_or(usize::MAX);
                let mut keyed: Vec<(usize, Vec<AodEvent>)> = items.into_iter().map(|it| (rank(&tag_of(&it)), it)).collect();
                keyed.sort_by_key(|(r, _)| *r);
                items = keyed.into_iter().map(|(_, it)| it).collect();
            }
        }
    }
    let mut out = Vec::with_capacity(element.len());
    out.push(element[0].clone());
    for item in items {
        if let Some(ws) = &indent {
            out.push(ws.clone());
        }
        out.extend(item);
    }
    if let Some(ws) = closing {
        out.push(ws);
    }
    out.push(element[element.len() - 1].clone());
    out
}

fn reindent_insert_template_raw(payload: &[u8], target_root_depth: usize) -> Vec<u8> {
    let delta = target_root_depth as i64 - INSERT_PAYLOAD_SOURCE_DEPTH as i64;
    if delta == 0 {
        return payload.to_vec();
    }
    let Ok(mut doc) = aod_io::parse(payload) else {
        return payload.to_vec();
    };
    for ev in doc.events.iter_mut() {
        if let AodEvent::Text(bytes) = ev {
            if let Some(depth) = indent_depth_of(bytes) {
                let new_depth = (depth as i64 + delta).max(0) as usize;
                *bytes = aod_io::patch::standard_indent(new_depth);
            }
        }
    }
    aod_io::serialize(&doc)
}

/// Resolves one `<path>` segment from an already-resolved parent element to its child's
/// `EventPath`, the operation `transpiler.md` §3's INSERT/DELETE path forms both need and that
/// `aod-io`'s own `EventPath` (occurrence-per-tag-name) cannot do alone: a modification path
/// segment addresses a child EITHER by its own tag name (a fixed structural field, e.g.
/// `entityFields`, `displayValueProcess`) OR, when that fails, by the text of ITS `<name>`
/// child (an array item keyed by UUID or author-chosen identifier, e.g. `STATUS`,
/// `offer_impl`) - confirmed empirically for every path shape in `transpiler.md` §3 and this
/// stage's own Phase 1 corpus scan. Tries the cheap tag-name match first (a single `index.get`),
/// falls back to scanning `parent`'s direct children for a matching `<name>` only when needed.
/// A self-closing element (`<headerFooterLayout />`) that is about to receive children becomes an
/// open/close pair with the closing tag on its own indented line; returns the refreshed index.
fn open_if_self_closing(doc: &mut AodDocument, index: EventIndex, container: &EventPath) -> EventIndex {
    let Some(IndexedRange::Element(range)) = index.get(container) else { return index };
    let at = range.start;
    let AodEvent::Empty(raw) = &doc.events[at] else { return index };
    let mut start = raw.clone();
    while start.last().is_some_and(|b| b.is_ascii_whitespace()) {
        start.pop();
    }
    if start.last() == Some(&b'/') {
        start.pop();
    }
    while start.last().is_some_and(|b| b.is_ascii_whitespace()) {
        start.pop();
    }
    let name = tag_name_of(&start).into_bytes();
    let indent = aod_io::patch::standard_indent(container.element_depth().saturating_sub(1));
    doc.events.splice(at..=at, [AodEvent::Start(start), AodEvent::Text(indent), AodEvent::End(name)]);
    build_index(doc)
}

fn resolve_step(doc: &AodDocument, index: &EventIndex, parent: &EventPath, segment: &str) -> Option<EventPath> {
    if let Some(found) = resolve_step_direct(doc, index, parent, segment) {
        return Some(found);
    }
    // A mixin property holds one concrete sub-object whose own properties are addressed as if they
    // belonged to the mixin property itself (`layout/header` for `<layout><headerFooterLayout>`).
    let concrete = mixin_concrete_child(index, parent)?;
    resolve_step_direct(doc, index, &concrete, segment)
}

/// Properties whose value is a polymorphic sub-object (the Designer's data-model mixins): a path
/// never names the concrete sub-object's own tag.
const MIXIN_CONTAINER_TAGS: &[&str] = &[
    "layout", "aliasDefinitionSub", "auditSyncConfig", "uiConfiguration", "rendererConfig", "entries",
    "aliasConfigSub", "company", "aliasSub", "templateSub",
];

/// The concrete sub-object below a mixin property, when `parent` is one and carries it already.
fn mixin_concrete_child(index: &EventIndex, parent: &EventPath) -> Option<EventPath> {
    let Some(PathStep::Child { tag, .. }) = parent.0.last() else { return None };
    if !MIXIN_CONTAINER_TAGS.contains(&tag.as_str()) {
        return None;
    }
    index
        .iter()
        .filter(|(path, range)| {
            matches!(range, IndexedRange::Element(_))
                && path.0.len() == parent.0.len() + 1
                && path.0.starts_with(&parent.0)
                && matches!(path.0.last(), Some(PathStep::Child { .. }))
        })
        .map(|(path, _)| path.clone())
        .next()
}

fn resolve_step_direct(doc: &AodDocument, index: &EventIndex, parent: &EventPath, segment: &str) -> Option<EventPath> {
    let tag_candidate = child_path(parent, segment, 0);
    if index.get(&tag_candidate).is_some() {
        return Some(tag_candidate);
    }
    for (path, range) in index.iter() {
        if !matches!(range, IndexedRange::Element(_)) {
            continue;
        }
        if path.0.len() != parent.0.len() + 1 || !path.0.starts_with(&parent.0) {
            continue;
        }
        if !matches!(path.0.last(), Some(PathStep::Child { .. })) {
            continue;
        }
        let name_idx = match index.text_event_index(doc, &child_path(path, "name", 0)) {
            Some(i) => i,
            None => continue,
        };
        if let AodEvent::Text(b) = &doc.events[name_idx] {
            if b.as_slice() == segment.as_bytes() {
                return Some(path.clone());
            }
        }
    }
    None
}

/// Finds the document's single root element's `EventPath` (occurrence 0 of whatever its tag is -
/// `.aod` files have exactly one root element, `transpiler.md` §3's envelope table and every real
/// object file observed agree on this). Needed because a modification's `<path>` never restates
/// the root tag name (it starts from the object's structural fields directly).
fn root_path(doc: &AodDocument) -> Option<EventPath> {
    for ev in &doc.events {
        match ev {
            AodEvent::Start(b) | AodEvent::Empty(b) => {
                let tag = tag_name_of(b);
                return Some(EventPath(vec![PathStep::Child { tag, occurrence: 0 }]));
            }
            _ => continue,
        }
    }
    None
}

fn tag_name_of(raw: &[u8]) -> String {
    let len = raw.iter().position(|&c| c == b' ' || c == b'\t' || c == b'\r' || c == b'\n').unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..len]).into_owned()
}

thread_local! {
    static OUTPUT_DIR: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    static ORDER_CACHE: std::cell::RefCell<std::collections::HashMap<(String, String), Vec<Vec<String>>>> = std::cell::RefCell::new(std::collections::HashMap::new());
}

/// The child tag sequences that elements `parent_tag` have in the objects of `model_type` already
/// in the output. A property a modification adds belongs where the objects themselves put it.
fn learn_child_orders(model_type: &str, parent_tag: &str) -> Vec<Vec<String>> {
    let key = (model_type.to_string(), parent_tag.to_string());
    if let Some(found) = ORDER_CACHE.with(|c| c.borrow().get(&key).cloned()) {
        return found;
    }
    let mut sequences: Vec<Vec<String>> = Vec::new();
    let root = OUTPUT_DIR.with(|d| d.borrow().clone()).map(|d| d.join(model_type));
    if let Some(root) = root {
        if let Ok(dirs) = fs::read_dir(&root) {
            for dir in dirs.flatten() {
                let Ok(files) = fs::read_dir(dir.path()) else { continue };
                for file in files.flatten() {
                    if file.path().extension().is_none_or(|e| e != "aod") {
                        continue;
                    }
                    let Ok(bytes) = fs::read(file.path()) else { continue };
                    let text = String::from_utf8_lossy(&bytes);
                    let mut stack: Vec<(String, Vec<String>)> = Vec::new();
                    for line in text.lines() {
                        let t = line.trim();
                        if t.starts_with("<?") || t.is_empty() {
                            continue;
                        }
                        if t.starts_with("</") {
                            if let Some((tag, kids)) = stack.pop() {
                                if tag == parent_tag && kids.len() > 1 && !sequences.contains(&kids) {
                                    sequences.push(kids);
                                }
                            }
                            continue;
                        }
                        let Some(rest) = t.strip_prefix('<') else { continue };
                        let end = rest.find(|c: char| c == '>' || c == ' ' || c == '/').unwrap_or(rest.len());
                        let tag = rest[..end].to_string();
                        if let Some((_, kids)) = stack.last_mut() {
                            if !kids.contains(&tag) {
                                kids.push(tag.clone());
                            }
                        }
                        let closed_here = t.ends_with("/>") || t.contains(&format!("</{tag}>"));
                        if !closed_here {
                            stack.push((tag, Vec::new()));
                        }
                    }
                }
            }
        }
    }
    ORDER_CACHE.with(|c| c.borrow_mut().insert(key, sequences.clone()));
    sequences
}

/// The child order the Designer's own schema gives an element, by the element's tag (`entityField`
/// -> the properties of `entityFieldType` in schema order). Generated from the property catalog.
fn catalog_order(tag: &str) -> Option<Vec<String>> {
    static TABLE: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> = std::sync::OnceLock::new();
    TABLE
        .get_or_init(|| serde_json::from_str(include_str!("child_order.json")).unwrap_or_default())
        .get(tag)
        .cloned()
}

/// Where a new child `seg` goes below `current`: after the nearest sibling that precedes it in the
/// order the objects use, otherwise before the nearest one that follows it, otherwise last.
fn order_hint(doc: &AodDocument, index: &EventIndex, current: &EventPath, seg: &str, model_type: &str) -> SiblingHint {
    let _ = doc;
    let Some(PathStep::Child { tag: parent_tag, .. }) = current.0.last().cloned() else { return SiblingHint::AppendAsLastChild };
    let mut present: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (path, range) in index.iter() {
        if !matches!(range, IndexedRange::Element(_)) || path.0.len() != current.0.len() + 1 || !path.0.starts_with(&current.0) {
            continue;
        }
        if let Some(PathStep::Child { tag, occurrence }) = path.0.last() {
            let slot = present.entry(tag.clone()).or_insert(0);
            *slot = (*slot).max(*occurrence);
        }
    }
    let order = catalog_order(&parent_tag).unwrap_or_else(|| global_order(&learn_child_orders(model_type, &parent_tag)));
    let Some(seg_rank) = order.iter().position(|t| t == seg) else { return SiblingHint::AppendAsLastChild };
    let mut before: Option<(usize, &String, usize)> = None;
    let mut after: Option<(usize, &String)> = None;
    for (tag, &occurrence) in &present {
        let Some(rank) = order.iter().position(|t| t == tag) else { continue };
        if rank < seg_rank {
            if before.is_none_or(|(r, _, _)| rank > r) {
                before = Some((rank, tag, occurrence));
            }
        } else if rank > seg_rank && after.is_none_or(|(r, _)| rank < r) {
            after = Some((rank, tag));
        }
    }
    if let Some((_, tag, occurrence)) = before {
        return SiblingHint::After(child_path(current, tag, occurrence));
    }
    if let Some((_, tag)) = after {
        return SiblingHint::Before(child_path(current, tag, 0));
    }
    SiblingHint::AppendAsLastChild
}

/// One order of all tags seen below a parent: a tag precedes another when most objects put it first.
fn global_order(sequences: &[Vec<String>]) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    for sequence in sequences {
        for tag in sequence {
            if !tags.contains(tag) {
                tags.push(tag.clone());
            }
        }
    }
    let mut count: std::collections::HashMap<(usize, usize), usize> = std::collections::HashMap::new();
    for sequence in sequences {
        let ids: Vec<usize> = sequence.iter().filter_map(|t| tags.iter().position(|x| x == t)).collect();
        for (i, &a) in ids.iter().enumerate() {
            for &b in &ids[i + 1..] {
                *count.entry((a, b)).or_insert(0) += 1;
            }
        }
    }
    let precedes = |a: usize, b: usize| count.get(&(a, b)).copied().unwrap_or(0) > count.get(&(b, a)).copied().unwrap_or(0);
    let mut remaining: Vec<usize> = (0..tags.len()).collect();
    let mut out = Vec::with_capacity(tags.len());
    while !remaining.is_empty() {
        let pick = remaining.iter().copied().find(|&c| !remaining.iter().any(|&o| o != c && precedes(o, c))).unwrap_or(remaining[0]);
        remaining.retain(|&r| r != pick);
        out.push(tags[pick].clone());
    }
    out
}

/// Names that denote a collection the base object may not carry yet (as opposed to a keyed item).
fn is_container_name(seg: &str) -> bool {
    !seg.is_empty() && seg.chars().all(|c| c.is_ascii_alphabetic()) && seg.chars().next().is_some_and(|c| c.is_ascii_lowercase())
}

/// Applies one already-parsed modification to `doc`, rebuilding `doc`'s index fresh each call
/// (mandatory after any patch - `aod-io`'s own module docs: a patch shifts every later event
/// index). Returns the [`Operation`] actually performed, for the report.
fn apply_one(doc: &mut AodDocument, m: &ParsedModification) -> Result<Operation, String> {
    let index = build_index(doc);
    let root = root_path(doc).ok_or_else(|| "target document has no root element".to_string())?;

    let mut current = root;
    let last_index = m.path_segments.len().saturating_sub(1);
    for (i, seg) in m.path_segments.iter().enumerate() {
        match resolve_step(doc, &index, &current, seg) {
            Some(next) => current = next,
            None if m.change_type == ChangeType::Insert && is_container_name(seg) => {
                // The base object has no such collection yet: the reference output creates the
                // missing containers around the inserted element.
                let payload = m.payload.clone().ok_or_else(|| "INSERT without a <value> payload".to_string())?;
                let missing = &m.path_segments[i..];
                let current = mixin_concrete_child(&index, &current).unwrap_or(current);
                let index = open_if_self_closing(doc, index, &current);
                let parent_depth = current.element_depth();
                let inner = reindent_insert_template(payload.trim_ascii(), parent_depth + 1 + missing.len());
                let mut template: Vec<u8> = Vec::new();
                for (k, name) in missing.iter().enumerate() {
                    template.extend_from_slice(format!("<{name}>").as_bytes());
                    template.extend_from_slice(&aod_io::patch::standard_indent(parent_depth + 1 + k));
                }
                template.extend_from_slice(&inner);
                for (k, name) in missing.iter().enumerate().rev() {
                    template.extend_from_slice(&aod_io::patch::standard_indent(parent_depth + k));
                    template.extend_from_slice(format!("</{name}>").as_bytes());
                }
                insert_at(doc, &index, &current, &template, SiblingHint::AppendAsLastChild).map_err(|e| e.to_string())?;
                return Ok(Operation::ArrayInsert);
            }
            None if i == last_index && m.change_type == ChangeType::Modify && m.payload.is_none() => {
                // Resetting a property the object does not carry changes nothing.
                return Ok(Operation::Modify);
            }
            None if i == last_index && m.change_type == ChangeType::Modify && !seg.contains('.') => {
                // ASSUMPTION (not verified against the original Designer): a MODIFY of a scalar property
                // that the base object does not carry yet appends the property to its parent element.
                let payload = m.payload.clone().ok_or_else(|| "MODIFY without a <value> payload".to_string())?;
                let current = mixin_concrete_child(&index, &current).unwrap_or(current);
                let index = open_if_self_closing(doc, index, &current);
                let template = if m.payload_is_attr {
                    [format!("<{seg} v=\"").as_bytes(), payload.as_slice(), b"\" />"].concat()
                } else {
                    [format!("<{seg}>").as_bytes(), payload.as_slice(), format!("</{seg}>").as_bytes()].concat()
                };
                let hint = order_hint(doc, &index, &current, seg, &m.model_type);
                insert_at(doc, &index, &current, &template, hint).map_err(|e| e.to_string())?;
                return Ok(Operation::Modify);
            }
            None => return Err(format!("path segment {seg:?} not found (full path under {:?})", m.path_segments)),
        }
    }

    match m.change_type {
        ChangeType::Modify if m.payload.is_none() => {
            // A MODIFY without a value puts the property back to its default: the element goes.
            let range = match index.get(&current) {
                Some(IndexedRange::Element(r)) => r.clone(),
                _ => return Err("MODIFY target is not an element".to_string()),
            };
            delete_range(doc, range).map_err(|e| e.to_string())?;
            Ok(Operation::Modify)
        }
        ChangeType::Modify => {
            if m.payload_is_attr {
                if let Some(IndexedRange::Attribute { event, value_bytes }) = index.get(&attribute_path(&current, "v")) {
                    let payload = m.payload.clone().ok_or_else(|| "MODIFY without a <value> payload".to_string())?;
                    return match &mut doc.events[*event] {
                        AodEvent::Empty(raw) | AodEvent::Start(raw) => {
                            raw.splice(value_bytes.clone(), payload);
                            Ok(Operation::Modify)
                        }
                        _ => Err("MODIFY target attribute owner is not a tag".to_string()),
                    };
                }
            }
            let text_idx = index
                .text_event_index(doc, &current)
                .ok_or_else(|| "MODIFY target is not a single-text-event scalar leaf".to_string())?;
            let payload = m.payload.clone().ok_or_else(|| "MODIFY without a <value> payload".to_string())?;
            replace_text_at(doc, text_idx..text_idx + 1, payload).map_err(|e| e.to_string())?;
            Ok(Operation::Modify)
        }
        ChangeType::Insert => {
            let payload = m.payload.clone().ok_or_else(|| "INSERT without a <value> payload".to_string())?;
            // `current` is the container the new element is inserted into; its own children
            // (the inserted root among them) sit at `current.element_depth() + 1` in the TARGET
            // document. The payload bytes' internal indentation still reflects where they sat
            // INSIDE the modification envelope, not the target - `reindent_insert_template`
            // corrects that (see its doc comment for the real-corpus bug this fixes).
            let target_root_depth = current.element_depth() + 1;
            let payload = reindent_insert_template(&payload, target_root_depth);
            let index = open_if_self_closing(doc, index, &current);
            insert_at(doc, &index, &current, &payload, SiblingHint::AppendAsLastChild).map_err(|e| e.to_string())?;
            Ok(Operation::ArrayInsert)
        }
        ChangeType::Delete => {
            let range = match index.get(&current) {
                Some(IndexedRange::Element(r)) => r.clone(),
                _ => return Err("DELETE target is not an element".to_string()),
            };
            delete_range(doc, range).map_err(|e| e.to_string())?;
            Ok(Operation::ArrayDelete)
        }
    }
}

/// Applies every modification in `group` (already filtered to one target file) to that file on
/// disk, sequentially (Phase 1 found a real case, see module doc, where a DELETE's target only
/// exists after an earlier INSERT ran - proving modifications for one file are NOT independent
/// and must be applied against the evolving document, not each against the pristine copy).
///
/// Sort key is `(is_project_root, position)`: dependency-authored modifications apply first
/// (ordered by `<position>` among themselves), project-root modifications apply last (also
/// `<position>`-ordered among themselves) - so a later apply from the project root always
/// overwrites an earlier one from a dependency. This is real-corpus-VERIFIED for the
/// project-root-vs-dependency tier (module doc comment: two independent same-leaf MODIFY
/// conflicts in Hermes, both resolved in favor of the project root, one of them despite the
/// dependency's `<position>` being numerically later - proving position alone is not the rule).
/// Position-ordering WITHIN a tier (two dependencies, or two project-root modifications,
/// conflicting with each other) was never observed and stays UNVERIFIED-but-plausible.
fn normalize_sidecars_to_crlf(dir: &Path, output_dir: &Path, referenced: &std::collections::HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            normalize_sidecars_to_crlf(&path, output_dir, referenced);
            continue;
        }
        let is_text = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("js") || e.eq_ignore_ascii_case("adoc"));
        if !is_text {
            continue;
        }
        // Only files the model links to are written again; a file nothing refers to stays as copied.
        let relative = path.strip_prefix(output_dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if !referenced.contains(&relative) {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 20);
        for &b in bytes.iter().filter(|&&b| b != b'\r') {
            if b == b'\n' {
                out.push(b'\r');
            }
            out.push(b);
        }
        if out != bytes {
            let _ = platform::fs::atomic_write(&path, &out);
        }
    }
}

/// The files (relative to the output folder, forward slashes) a model links to with `%aditoprj%/...`.
fn linked_files_of(aod: &Path) -> std::collections::HashSet<String> {
    let text = fs::read(aod).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let mut found = std::collections::HashSet::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("%aditoprj%/") {
        let after = &rest[at + "%aditoprj%/".len()..];
        let end = after.find('<').unwrap_or(after.len());
        found.insert(after[..end].trim().to_string());
        rest = &after[end..];
    }
    found
}

fn apply_all_to_file(target: &Path, mut group: Vec<&ParsedModification>, report: &mut ModificationEngineReport) {
    group.sort_by_key(|m| (m.is_project_root, m.position, m.source_file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));

    let bytes = match fs::read(target) {
        Ok(b) => b,
        Err(e) => {
            for m in &group {
                report.modifications_failed += 1;
                report.failures.push((m.source_file.clone(), format!("target file {} unreadable: {e}", target.display())));
            }
            return;
        }
    };
    let mut doc = match aod_io::parse(&bytes) {
        Ok(d) => d,
        Err(e) => {
            for m in &group {
                report.modifications_failed += 1;
                report.failures.push((m.source_file.clone(), format!("target file {} did not parse: {e}", target.display())));
            }
            return;
        }
    };

    for m in &group {
        match apply_one(&mut doc, m) {
            Ok(_op) => report.modifications_applied += 1,
            Err(reason) => {
                report.modifications_failed += 1;
                report.failures.push((m.source_file.clone(), reason));
            }
        }
    }

    let out_bytes = {
        // The reference writes a modified object with CRLF throughout, also where an inserted
        // fragment came from a modification file with LF endings.
        let raw = aod_io::serialize(&doc);
        let mut crlf = Vec::with_capacity(raw.len() + raw.len() / 30);
        for (i, &b) in raw.iter().enumerate() {
            if b == LF_BYTE && (i == 0 || raw[i - 1] != CR_BYTE) {
                crlf.push(CR_BYTE);
            }
            crlf.push(b);
        }
        crlf
    };
    if let Err(source) = platform::fs::atomic_write(target, &out_bytes) {
        for m in &group {
            report.failures.push((m.source_file.clone(), format!("write-back failed: {source}")));
        }
    }
}

/// Runs the modification-application phase against every module in `graph`, on top of an
/// already-populated `output_dir` (the copy-phase's job, called by [`ModificationEngine::run`]
/// before this). Groups all discovered modifications by their resolved target file so
/// `apply_all_to_file` can apply each target's modifications sequentially against its own
/// evolving document (see that function's doc comment for why order-within-a-file matters).
pub fn run_modification_phase(graph: &ModuleGraph, output_dir: &Path) -> Result<ModificationEngineReport, ModificationEngineError> {
    let mut report = ModificationEngineReport::default();
    OUTPUT_DIR.with(|d| *d.borrow_mut() = Some(output_dir.to_path_buf()));
    ORDER_CACHE.with(|c| c.borrow_mut().clear());

    let mut modules: Vec<(&ModuleDefinition, bool)> = graph.modules.values().map(|m| (m, false)).collect();
    modules.push((&graph.project, true));

    let mut all: Vec<ParsedModification> = Vec::new();
    for (module, is_project_root) in modules {
        for file in find_modification_files(&module.path) {
            match parse_modification_file(&file, is_project_root) {
                Ok(m) => all.push(m),
                Err(e) => report.failures.push((file, e.to_string())),
            }
        }
    }
    report.modifications_found = all.len();

    let mut by_target: BTreeMap<(String, String), Vec<&ParsedModification>> = BTreeMap::new();
    for m in &all {
        by_target.entry((m.model_type.clone(), m.model_name.clone())).or_default().push(m);
    }

    let total_targets = by_target.len();
    for (done, ((model_type, model_name), group)) in by_target.into_iter().enumerate() {
        if done % 25 == 0 {
            crate::own_engine::progress::report_between(35, 65, done, total_targets, "Applying the modifications");
        }
        let target = output_dir.join(&model_type).join(&model_name).join(format!("{model_name}.aod"));
        let existed = target.is_file();
        apply_all_to_file(&target, group, &mut report);
        // The reference transpiler writes a modified object completely new: the scripts and
        // documentation files that belong to it come out with CRLF line endings (verified against
        // a clean reference run: 45 modified entities all CRLF, 183 untouched ones verbatim).
        if existed {
            if let Some(object_dir) = target.parent() {
                let referenced = linked_files_of(&target);
                normalize_sidecars_to_crlf(object_dir, output_dir, &referenced);
            }
        }
    }

    Ok(report)
}

/// `OwnEngine` wiring: resolves the module graph, runs the copy phase (reused unchanged from
/// `copy_phase_stage`), then applies every discovered modification on top of the copied files.
/// This is the pipeline's fourth stage - see `p5-modification-engine-notes.md` for the measured
/// match rate.
pub struct ModificationEngine;

impl OwnEngine for ModificationEngine {
    fn name(&self) -> &str {
        "ModificationEngine (resolver + copy-phase + modification-application stage; linked-files not yet wired)"
    }

    fn run(&self, project_home: &Path, output_dir: &Path) -> Result<(), OwnEngineError> {
        let graph = resolve_module_graph(project_home)?;
        run_copy_phase(&graph, output_dir).map_err(|e| OwnEngineError::Message(e.to_string()))?;
        run_modification_phase(&graph, output_dir).map(|_report| ()).map_err(|e| OwnEngineError::Message(e.to_string()))
    }
}

/// Merges modification files onto the bytes of one base object, in the transpiler's order
/// (dependency tier first, project root last, `<position>` within a tier). `(file, is_project_root)`.
/// Used by Forge to prove that a written modification yields the expected merged object.
pub fn merge_modifications_into_bytes(base: &[u8], files: &[(PathBuf, bool)]) -> Result<Vec<u8>, String> {
    let mut parsed = Vec::new();
    for (file, is_project_root) in files {
        parsed.push(parse_modification_file(file, *is_project_root).map_err(|e| e.to_string())?);
    }
    parsed.sort_by_key(|m| (m.is_project_root, m.position));
    let mut doc = aod_io::parse(base).map_err(|e| e.to_string())?;
    for m in &parsed {
        apply_one(&mut doc, m).map_err(|e| format!("{}: {e}", m.source_file.display()))?;
    }
    Ok(aod_io::serialize(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use module_graph::AditoType;
    use semver::Version;
    use std::collections::BTreeMap as StdBTreeMap;

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "modification-engine-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).expect("failed to create scratch dir");
        dir
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn modification_envelope(change_type: &str, position: i64, model_type: &str, model_name: &str, path: &str, value: &str) -> String {
        // Real `.aod`/modification files always use CRLF (`copy_phase_stage`'s own
        // CRLF-normalization finding) - `indent_depth_of`'s `\r\n`-prefix check (and therefore
        // `reindent_insert_template`) only recognizes indentation runs in that exact form, so
        // fixtures need the same line endings as real files to actually exercise it.
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<modification xmlns="http://www.adito.de/2018/ao/Model" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" VERSION="1.2.0" xsi:schemaLocation="http://www.adito.de/2018/ao/Model adito://models/xsd/modification/1.2.0">
  <name>test</name>
  <majorModelMode>DISTRIBUTED</majorModelMode>
  <changeType>{change_type}</changeType>
  <position v="{position}" />
  <modelType>{model_type}</modelType>
  <modelName>{model_name}</modelName>
  <path>{path}</path>{value}
</modification>"#
        )
        .replace('\n', "\r\n")
    }

    /// Own fixture, matches the real corpus shape exactly (`5d7ba8f9...` in Hermes, see this
    /// module's doc comment): a MODIFY replaces one scalar leaf's text.
    #[test]
    fn modify_replaces_scalar_leaf_text() {
        let dir = scratch_dir("modify");
        let target = dir.join("entity/Foo_entity/Foo_entity.aod");
        write(&target, "<entity>\r\n  <title>Old</title>\r\n</entity>");

        let mod_file = dir.join("modification/m1/m1.aod");
        write(
            &mod_file,
            &modification_envelope(
                "MODIFY", 1, "entity", "Foo_entity", "Foo_entity/title",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>New</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );

        let m = parse_modification_file(&mod_file, false).unwrap();
        assert_eq!(m.change_type, ChangeType::Modify);
        assert_eq!(m.payload.as_deref(), Some(b"New".as_slice()));

        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&m], &mut report);
        assert_eq!(report.modifications_applied, 1);
        assert_eq!(report.modifications_failed, 0);

        let result = fs::read_to_string(&target).unwrap();
        assert!(result.contains("<title>New</title>"), "got: {result}");
        assert!(!result.contains("Old"));

        fs::remove_dir_all(&dir).ok();
    }

    /// Real corpus shape (`04594665...` in Hermes): an INSERT appends a new element, with its
    /// own name carried inside the inserted element itself, to a collection addressed only by
    /// its container tag.
    #[test]
    fn insert_appends_new_element_to_a_named_collection() {
        let dir = scratch_dir("insert");
        let target = dir.join("neonContext/Order/Order.aod");
        write(&target, "<neonContext>\r\n  <references>\r\n  </references>\r\n</neonContext>");

        let mod_file = dir.join("modification/m1/m1.aod");
        write(
            &mod_file,
            &modification_envelope(
                "INSERT", 1, "neonContext", "Order", "Order/references",
                "\n  <value>\n    <modelValueWrapper>\n      <name>value</name>\n      <value>\n        <neonViewReference>\n          <name>abc-123</name>\n          <view>SomeView</view>\n        </neonViewReference>\n      </value>\n    </modelValueWrapper>\n  </value>",
            ),
        );

        let m = parse_modification_file(&mod_file, false).unwrap();
        assert_eq!(m.change_type, ChangeType::Insert);

        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&m], &mut report);
        assert_eq!(report.modifications_applied, 1, "{:?}", report.failures);

        let result = fs::read_to_string(&target).unwrap();
        assert!(result.contains("<neonViewReference>"), "got: {result}");
        // Exact-indentation assertions (real-corpus regression, see `reindent_insert_template`'s
        // doc comment): the inserted root sits one level under `<references>` (4 spaces), and
        // ITS children one level deeper still (6 spaces) - NOT the 10 spaces the payload carried
        // inside the modification envelope. A plain `.contains(...)` substring check would miss
        // this entirely, which is exactly how this bug first got past the original version of
        // this test.
        assert!(
            result.contains("\r\n    <neonViewReference>\r\n      <name>abc-123</name>\r\n      <view>SomeView</view>\r\n    </neonViewReference>"),
            "expected the inserted element AND its children to be re-indented to the target's depth, got: {result}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Real corpus shape (`3c40d9e1...` in Hermes): a DELETE addresses one array item by a
    /// UUID key (its own `<name>` child text), no `<value>` present.
    #[test]
    fn delete_removes_the_element_matching_its_name_keyed_path_segment() {
        let dir = scratch_dir("delete");
        let target = dir.join("entityWebservice/Foo_ws/Foo_ws.aod");
        write(
            &target,
            "<entityWebservice>\r\n  <webserviceFields>\r\n    <webserviceField>\r\n      <name>keep-me</name>\r\n    </webserviceField>\r\n    <webserviceField>\r\n      <name>doomed-uuid</name>\r\n    </webserviceField>\r\n  </webserviceFields>\r\n</entityWebservice>",
        );

        let mod_file = dir.join("modification/m1/m1.aod");
        write(&mod_file, &modification_envelope("DELETE", 1, "entityWebservice", "Foo_ws", "Foo_ws/webserviceFields/doomed-uuid", ""));

        let m = parse_modification_file(&mod_file, false).unwrap();
        assert_eq!(m.change_type, ChangeType::Delete);
        assert!(m.payload.is_none());

        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&m], &mut report);
        assert_eq!(report.modifications_applied, 1, "{:?}", report.failures);

        let result = fs::read_to_string(&target).unwrap();
        assert!(result.contains("keep-me"), "got: {result}");
        assert!(!result.contains("doomed-uuid"), "got: {result}");

        fs::remove_dir_all(&dir).ok();
    }

    /// Real-corpus finding (see module doc comment): a DELETE can legitimately target an element
    /// that only exists because an EARLIER modification (lower `position`) inserted it first -
    /// proving modifications for one target file must be applied sequentially, not independently
    /// against the pristine base file.
    #[test]
    fn later_delete_removes_an_element_an_earlier_insert_just_created() {
        let dir = scratch_dir("insert-then-delete");
        let target = dir.join("entityWebservice/Foo_ws/Foo_ws.aod");
        write(&target, "<entityWebservice>\r\n  <webserviceFields>\r\n  </webserviceFields>\r\n</entityWebservice>");

        let insert_file = dir.join("modification/m1/m1.aod");
        write(
            &insert_file,
            &modification_envelope(
                "INSERT", 1, "entityWebservice", "Foo_ws", "Foo_ws/webserviceFields",
                "\n  <value>\n    <modelValueWrapper>\n      <name>value</name>\n      <value>\n        <webserviceField>\n          <name>fresh-uuid</name>\n        </webserviceField>\n      </value>\n    </modelValueWrapper>\n  </value>",
            ),
        );
        let delete_file = dir.join("modification/m2/m2.aod");
        write(&delete_file, &modification_envelope("DELETE", 2, "entityWebservice", "Foo_ws", "Foo_ws/webserviceFields/fresh-uuid", ""));

        let insert_mod = parse_modification_file(&insert_file, false).unwrap();
        let delete_mod = parse_modification_file(&delete_file, false).unwrap();

        // Deliberately passed out of position order - `apply_all_to_file` must sort by
        // `<position>` itself, not rely on caller order.
        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&delete_mod, &insert_mod], &mut report);
        assert_eq!(report.modifications_applied, 2, "{:?}", report.failures);

        let result = fs::read_to_string(&target).unwrap();
        assert!(!result.contains("fresh-uuid"), "insert-then-delete should leave no trace: {result}");

        fs::remove_dir_all(&dir).ok();
    }

    /// Synthetic within-tier conflict test (explicitly labeled as such: Phase 1 found no real
    /// two-dependencies-conflicting or two-project-root-modifications-conflicting case anywhere
    /// in the corpus, see module doc - only cross-tier conflicts were found, covered by the
    /// REAL-corpus test below). Two MODIFYs target the identical scalar leaf from the SAME tier
    /// (both dependency-authored here); this stage's documented, UNVERIFIED-but-plausible
    /// within-tier policy is "apply in ascending `<position>` order, last write wins" - proven
    /// directly here with the higher-position modification's value surviving regardless of which
    /// order they are handed in.
    #[test]
    fn synthetic_same_tier_conflicting_modifies_resolve_by_position_last_wins() {
        let dir = scratch_dir("conflict");
        let target = dir.join("entity/Foo_entity/Foo_entity.aod");
        write(&target, "<entity>\r\n  <title>Old</title>\r\n</entity>");

        let earlier = dir.join("modification/m1/m1.aod");
        write(
            &earlier,
            &modification_envelope(
                "MODIFY", 100, "entity", "Foo_entity", "Foo_entity/title",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>FromEarlier</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );
        let later = dir.join("modification/m2/m2.aod");
        write(
            &later,
            &modification_envelope(
                "MODIFY", 200, "entity", "Foo_entity", "Foo_entity/title",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>FromLater</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );

        let earlier_mod = parse_modification_file(&earlier, false).unwrap();
        let later_mod = parse_modification_file(&later, false).unwrap();

        // Handed in reverse position order on purpose.
        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&later_mod, &earlier_mod], &mut report);
        assert_eq!(report.modifications_applied, 2, "{:?}", report.failures);

        let result = fs::read_to_string(&target).unwrap();
        assert!(result.contains("<title>FromLater</title>"), "higher-position MODIFY must win within a tier: {result}");

        fs::remove_dir_all(&dir).ok();
    }

    /// REAL-corpus-grounded conflict test - the single most important finding of this agent's
    /// Phase 1 (see module doc comment for the full evidence trail): Hermes ships two genuinely
    /// conflicting MODIFYs on `Order_entity/entityFields/DELIVERYADDRESS/mandatoryProcess`, one
    /// from the project root (`<position>` 1776241591) and one from the `@3hills-IT/pos-order`
    /// dependency (`<position>` 1778848099 - LATER). Comparing both against Hermes's own real
    /// `dist/entity/Order_entity/Order_entity.aod` shows the PROJECT ROOT's script is what
    /// actually shipped, despite its earlier `<position>` - proving `<position>` alone cannot be
    /// the merge rule and that module precedence (project root beats any dependency) is what
    /// decides a real conflict. This test reproduces that exact shape with placeholder script
    /// text standing in for the two real (and materially different) `mandatoryProcess.js` bodies.
    #[test]
    fn real_corpus_shape_project_root_modify_wins_over_dependency_modify_despite_later_position() {
        let dir = scratch_dir("precedence");
        let target = dir.join("entity/Order_entity/Order_entity.aod");
        write(&target, "<entity>\r\n  <entityFields>\r\n    <entityField>\r\n      <name>DELIVERYADDRESS</name>\r\n      <mandatoryProcess>old</mandatoryProcess>\r\n    </entityField>\r\n  </entityFields>\r\n</entity>");

        let project_root_mod = dir.join("modification/proot/proot.aod");
        write(
            &project_root_mod,
            &modification_envelope(
                "MODIFY", 1776241591, "entity", "Order_entity", "Order_entity/entityFields/DELIVERYADDRESS/mandatoryProcess",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>fromProjectRoot</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );
        let dependency_mod = dir.join("modification/dep/dep.aod");
        write(
            &dependency_mod,
            &modification_envelope(
                "MODIFY", 1778848099, "entity", "Order_entity", "Order_entity/entityFields/DELIVERYADDRESS/mandatoryProcess",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>fromDependency</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );

        let project_root = parse_modification_file(&project_root_mod, true).unwrap();
        let dependency = parse_modification_file(&dependency_mod, false).unwrap();

        // Handed with the dependency (numerically later position) last, the way a naive
        // position-only sort would apply it - the tier ordering must still put project root last.
        let mut report = ModificationEngineReport::default();
        apply_all_to_file(&target, vec![&project_root, &dependency], &mut report);
        assert_eq!(report.modifications_applied, 2, "{:?}", report.failures);

        let result = fs::read_to_string(&target).unwrap();
        assert!(
            result.contains("<mandatoryProcess>fromProjectRoot</mandatoryProcess>"),
            "project root must win over a dependency regardless of <position>: {result}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Own fixture proving the merger-order requirement from the role brief: a base module
    /// defines an object, an "overriding" module (later in resolution order is irrelevant here -
    /// modification files are keyed by target, not by which module authored them) ships a
    /// modification/ that patches the base module's own object, the applied result reflects
    /// both.
    #[test]
    fn full_pipeline_applies_a_dependency_supplied_modification_onto_a_base_module_object() {
        let base_root = scratch_dir("base-module");
        write(&base_root.join("entity/Shared_entity/Shared_entity.aod"), "<entity>\r\n  <title>Base</title>\r\n</entity>");

        let override_root = scratch_dir("override-module");
        write(
            &override_root.join("modification/m1/m1.aod"),
            &modification_envelope(
                "MODIFY", 1, "entity", "Shared_entity", "Shared_entity/title",
                "\n  <value>\n    <stringValueWrapper>\n      <name>value</name>\n      <value>Overridden</value>\n    </stringValueWrapper>\n  </value>",
            ),
        );

        let project_root = scratch_dir("project-root");

        fn fake_module(name: &str, path: PathBuf) -> ModuleDefinition {
            ModuleDefinition {
                name: name.to_string(),
                version: Version::new(1, 0, 0),
                adito_type: AditoType::Module,
                dependencies: StdBTreeMap::new(),
                peer_dependencies: StdBTreeMap::new(),
                overrides: StdBTreeMap::new(),
                path,
            }
        }

        let mut modules = StdBTreeMap::new();
        modules.insert("@aditosoftware/base".to_string(), fake_module("@aditosoftware/base", base_root.clone()));
        modules.insert("@aditosoftware/override".to_string(), fake_module("@aditosoftware/override", override_root.clone()));
        let graph = ModuleGraph {
            project: fake_module("@3hills-it/testproject", project_root.clone()),
            modules,
            edges: StdBTreeMap::new(),
            unresolved_external: Default::default(),
            duplicates: Vec::new(),
            diamonds_resolved_via_override: Vec::new(),
        };

        let output_dir = scratch_dir("output");
        run_copy_phase(&graph, &output_dir).unwrap();
        let report = run_modification_phase(&graph, &output_dir).unwrap();
        assert_eq!(report.modifications_applied, 1, "{:?}", report.failures);

        let result = fs::read_to_string(output_dir.join("entity/Shared_entity/Shared_entity.aod")).unwrap();
        assert!(result.contains("<title>Overridden</title>"), "got: {result}");

        fs::remove_dir_all(&base_root).ok();
        fs::remove_dir_all(&override_root).ok();
        fs::remove_dir_all(&project_root).ok();
        fs::remove_dir_all(&output_dir).ok();
    }
}

const CR_BYTE: u8 = 13;
const LF_BYTE: u8 = 10;
