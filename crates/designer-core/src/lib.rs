//! `designer-core` — Fassade ohne UI. Bündelt die Kern-Crates in einer öffentlichen API.
//! `cli/forge`, `validators` und `project` bauen darauf auf.
//!
//! - [`project::open_project`] / [`project::ProjectHandle`]: eine offene `.aod`-Datei laden,
//!   ändern und speichern. Gespeichert wird über `aod::document::serialize` und
//!   `platform::fs::atomic_write`.
//! - [`plugin_bridge`]: Umwandlung der `aod`-Typen in die Platzhalter-Typen von `plugin-api`.
//! - [`plugins::build_plugin_registry`]: baut die `PluginRegistry` mit den eingebauten Teilen.

pub mod plugin_bridge;
pub mod plugins;
pub mod project;

pub use plugin_bridge::{
    to_plugin_file_command, to_plugin_property_node, to_plugin_transaction, to_plugin_value,
};
pub use plugins::build_plugin_registry;
pub use project::{open_project, ForgeError, ProjectHandle};

// Facade re-exports (architecture.md §1: "bündelt obige Crates zu einer öffentlichen API") - a
// caller depending only on `designer-core` can reach every P3 crate's own public API through here
// without a direct Cargo dependency on it.
pub use aod;
pub use npm_modules;
pub use plugin_api;
pub use platform;
