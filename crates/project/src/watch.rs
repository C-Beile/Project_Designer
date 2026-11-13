//! Änderungen von außen: der Stempel (Größe + Zeit) je geöffneter Datei liegt in `platform::fs`.
//! Änderungen im ganzen Projekt erkennt der File-Watcher mit dem Projekt-Index (`project-index`);
//! die Oberfläche bekommt sie als Event `forge://project-changed`.

pub use platform::fs::{file_stamp, FileStamp};
