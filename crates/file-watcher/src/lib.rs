//! Beobachtet einen Projektordner und liefert gebündelte Pakete (`Batch`) der berührten Pfade.
//! Kein Tauri, keine Events: der Besitzer (der Projekt-Index) bekommt die Pakete über einen Callback.
//! Ein Batch sagt nur, WELCHE Pfade berührt wurden. Was passiert ist, prüft der Empfänger per `stat`.

pub mod batcher;
pub mod ignore;
pub mod session;
pub mod watch_set;

pub use batcher::{Batch, BatchKind, Batcher, FloodReason, RescanReason, TouchedPath, WatchConfig};
pub use ignore::IgnoreRules;
pub use session::WatchSession;
