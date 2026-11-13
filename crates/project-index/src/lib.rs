//! Index über das offene Projekt: alle Dateien, die Objekte, ihre Verweise und Probleme. Der Index
//! baut sich einmal auf (mit Fortschritt) und hält sich danach über den File-Watcher aktuell. Er
//! sendet die Events `forge://index-progress` und `forge://project-changed`.
//!
//! Abhängigkeiten: nicht von `project` (das hängt von dieser Crate ab und re-exportiert, was es früher selbst hatte).

pub mod analyze;
pub mod build;
pub mod dump;
pub mod events;
pub mod layout;
pub mod log;
pub mod model;
pub mod modules;
pub mod progress;
pub mod query;
pub mod references;
pub mod service;
pub mod text_pos;
pub mod update;

pub use analyze::{analyze_file, validate_aod_bytes, FileAnalysis};
pub use build::{build_index, BuildOptions, BuildReport, Cancelled};
pub use events::{ChangeKind, ChangeReason, ChangedFile, IndexPhase, IndexProgress, IndexStatus, ProjectChanged, VerifyOutcome, EVENT_CHANGED, EVENT_PROGRESS};
pub use layout::{object_of, OBJECT_FOLDERS, SCANNED_FOLDERS};
pub use log::{CrashlogIndexLog, IndexLog, NullLog};
pub use model::{FileEntry, FileKey, ObjectEntry, ProblemDto, ProjectIndex, RefEntry, Target, UsageDto};
pub use progress::{NullProgress, ProgressSink};
pub use references::ReferenceIndex;
pub use service::{IndexRegistry, ProjectIndexHandle, ServiceConfig, StartOutcome};
pub use text_pos::{line_col, parse_node_path};
