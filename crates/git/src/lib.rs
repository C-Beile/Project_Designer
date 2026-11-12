//! Git für die App: `git_actions` (Übersicht, Commit, Push/Pull, Branches), `git_scm` (Quellcodeverwaltungs-Ansicht).

pub mod clone;
pub mod connect;
pub mod git_actions;
pub mod git_scm;
pub mod plugin;

pub use plugin::GitPlugin;
