//! Basis der App ohne Projekt-, Git- oder Datenbanklogik: Crashlog, Backup vor dem Überschreiben,
//! Schreibschutz für Modul-Objekte, Pfade der Designer-Installation, Fensternamen und die
//! Maskierung von Geheimnissen in Texten.

pub mod backup;
pub mod config;
pub mod crashlog;
pub mod designer_paths;
pub mod fs_guard;
pub mod layout;
pub mod parallel;
pub mod project_dir;
pub mod scrub;
pub mod window_labels;
pub mod window_state;
