//! Die Daten des Index.

use crate::references::ReferenceIndex;
use aod::references::{ObjectId, ReferenceKind};
use platform::fs::FileStamp;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

/// `platform::fs::path_key` of a file path.
pub type FileKey = String;

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub path: PathBuf,
    /// Path inside the project, '/'-separated.
    pub rel: String,
    /// `None` = could not be read, the next comparison tries again.
    pub stamp: Option<FileStamp>,
}

#[derive(Debug, Clone)]
pub struct ObjectEntry {
    pub object_type: &'static str,
    pub name: String,
    pub root_tag: String,
    pub parsed: bool,
    /// `aliasDefDb.targetAliasName` of an alias object.
    pub alias_target_name: Option<String>,
}

/// What a reference points to.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Target {
    /// Entity, view or webservice by name.
    Object(ObjectId),
    /// The short alias name (`targetAliasName`) as written; resolved at query time.
    AliasShort(String),
    /// `%aditoprj%/...` linked file.
    LinkedFile(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefEntry {
    pub target: Target,
    pub kind: ReferenceKind,
    /// Node path of the referencing element inside the file (without the root tag).
    pub site: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProblemDto {
    /// The object file (also the tree node id).
    pub node_id: String,
    pub object: String,
    pub object_type: String,
    /// `parse`, `validator` or `reference`.
    pub source: String,
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UsageDto {
    pub node_id: String,
    pub object: String,
    pub object_type: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    /// What the referencing element is, e.g. `ViewReference`.
    pub kind: String,
}

/// Installed npm modules: which objects they bring and the stamps that tell when they changed.
#[derive(Debug, Clone, Default)]
pub struct ModuleState {
    pub package_json: Option<FileStamp>,
    pub package_lock: Option<FileStamp>,
    pub hidden_lock: Option<FileStamp>,
    /// Object folder (`entity`, `neonView`, ...) to the names of the objects the modules bring.
    pub names_by_folder: HashMap<&'static str, HashSet<String>>,
    /// `targetAliasName` to the name of the alias object, for module aliases.
    pub alias_targets: HashMap<String, String>,
}

#[derive(Debug, Default)]
pub struct ProjectIndex {
    pub root: PathBuf,
    pub generation: u64,
    /// All files that are not ignored (also `.js`, `.jrxml`).
    pub files: BTreeMap<FileKey, FileEntry>,
    /// `.aod` objects in the scanned folders.
    pub objects: HashMap<FileKey, ObjectEntry>,
    pub by_name: HashMap<(&'static str, String), FileKey>,
    pub refs: ReferenceIndex,
    /// Parse and validator problems per file (reference problems are computed at query time).
    pub static_problems: HashMap<FileKey, Vec<ProblemDto>>,
    pub modules: ModuleState,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct IndexCounts {
    pub files: u32,
    pub objects: u32,
    pub references: u32,
}

impl ProjectIndex {
    pub fn counts(&self) -> IndexCounts {
        IndexCounts { files: self.files.len() as u32, objects: self.objects.len() as u32, references: self.refs.count() as u32 }
    }
}
