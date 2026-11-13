//! Die Events, die der Index an die Oberfläche sendet (Namen und Payloads, camelCase).

use serde::Serialize;

pub const EVENT_PROGRESS: &str = "forge://index-progress";
pub const EVENT_CHANGED: &str = "forge://project-changed";

/// How many changed files one event lists at most.
pub const MAX_CHANGED_FILES: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexPhase {
    Queued,
    Listing,
    Reading,
    Linking,
    Ready,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexProgress {
    pub project: String,
    pub generation: u64,
    pub phase: IndexPhase,
    pub done: u32,
    pub total: u32,
    pub percent: Option<u8>,
    pub current_file: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Removed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeReason {
    Watcher,
    Git,
    Flood,
    Rescan,
    Focus,
    Modules,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub kind: ChangeKind,
    pub own: bool,
    pub object_type: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanged {
    pub project: String,
    pub generation: u64,
    pub reason: ChangeReason,
    pub changed: Vec<ChangedFile>,
    pub truncated: bool,
    /// Files whose problems may have changed because something they point to appeared or went away.
    pub affected: Vec<String>,
    pub modules_changed: bool,
    /// Too much changed to list it: the UI reloads everything.
    pub full: bool,
    pub own_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub project: String,
    pub generation: u64,
    pub phase: IndexPhase,
    pub done: u32,
    pub total: u32,
    pub files: u32,
    pub objects: u32,
    pub references: u32,
    pub last_build_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyOutcome {
    pub changed: u32,
    pub duration_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payloads_are_camel_case() {
        let p = IndexProgress { project: "p".into(), generation: 1, phase: IndexPhase::Reading, done: 1, total: 2, percent: Some(50), current_file: Some("a".into()), message: None };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(v["currentFile"], "a");
        assert_eq!(v["phase"], "reading");
        let c = ProjectChanged { project: "p".into(), generation: 1, reason: ChangeReason::Git, changed: vec![], truncated: false, affected: vec![], modules_changed: true, full: true, own_only: false };
        let v = serde_json::to_value(c).unwrap();
        assert_eq!(v["modulesChanged"], true);
        assert_eq!(v["ownOnly"], false);
        assert_eq!(v["reason"], "git");
    }
}
