//! Ein fertiges Modell als Ergebnis eines Transpile-Laufs, neutral für alle, die es weiterverwenden (Deploy, später Hot-Reload).
//! Der Transpiler liefert sie, das Deploy-Plugin nimmt sie. Kein Plugin kennt das andere.

use std::sync::{Arc, Mutex};

/// Ein Modell: Ordner (`entity`), Name (`Person_entity`) und die Bytes der `.aod` im Zielformat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildArtifact {
    pub folder: String,
    pub name: String,
    pub content: Vec<u8>,
}

impl BuildArtifact {
    /// `entity/Person_entity`, der Schlüssel in Plänen und in der Oberfläche.
    pub fn key(&self) -> String {
        format!("{}/{}", self.folder, self.name)
    }
}

/// Der letzte Satz Artefakte im Speicher. Der Besitzer des Transpile-Laufs legt ihn ab, das Deploy liest ihn.
/// Ein neuer Satz ersetzt den alten ganz.
#[derive(Default)]
pub struct ArtifactStore {
    current: Mutex<Option<Arc<Vec<BuildArtifact>>>>,
    /// Für welches Projekt der Satz gilt (Ordner, vereinheitlicht). `None`: unbekannt.
    root: Mutex<Option<String>>,
}

/// Pfad zum Vergleichen: `/`, ohne Schluss-Schrägstrich, klein.
fn normalized(root: &str) -> String {
    root.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

impl ArtifactStore {
    pub fn set(&self, artifacts: Vec<BuildArtifact>) {
        *self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Arc::new(artifacts));
    }

    /// Wie `set`, ohne zu kopieren (der Satz ist schon geteilt).
    pub fn set_shared(&self, artifacts: Arc<Vec<BuildArtifact>>) {
        *self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(artifacts);
    }

    /// Legt den Satz für ein Projekt ab. `None` löscht ihn (der letzte Lauf kam von einer Engine ohne Artefakte).
    pub fn set_for_root(&self, root: &str, artifacts: Option<Arc<Vec<BuildArtifact>>>) {
        *self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = artifacts.as_ref().map(|_| normalized(root));
        *self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = artifacts;
    }

    /// Der Satz, aber nur wenn er zu diesem Projekt gehört.
    pub fn get_for_root(&self, root: &str) -> Option<Arc<Vec<BuildArtifact>>> {
        let stored = self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        if stored.as_deref() == Some(normalized(root).as_str()) {
            self.get()
        } else {
            None
        }
    }

    pub fn clear(&self) {
        *self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self.root.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    pub fn get(&self) -> Option<Arc<Vec<BuildArtifact>>> {
        self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_set_belongs_to_its_project_only() {
        let store = ArtifactStore::default();
        store.set_for_root("C:\\Adito\\Projects\\Hermes\\", Some(Arc::new(vec![BuildArtifact { folder: "entity".into(), name: "A".into(), content: Vec::new() }])));
        assert!(store.get_for_root("c:/adito/projects/hermes").is_some());
        assert!(store.get_for_root("C:/other").is_none());
        store.set_for_root("C:/Adito/Projects/Hermes", None);
        assert!(store.get_for_root("C:/Adito/Projects/Hermes").is_none(), "another engine clears the set");
    }

    #[test]
    fn store_keeps_only_the_latest_set() {
        let store = ArtifactStore::default();
        assert!(store.get().is_none());
        store.set(vec![BuildArtifact { folder: "entity".into(), name: "A_entity".into(), content: b"1".to_vec() }]);
        let first = store.get().unwrap();
        store.set(Vec::new());
        assert_eq!(first[0].key(), "entity/A_entity");
        assert!(store.get().unwrap().is_empty());
        store.clear();
        assert!(store.get().is_none());
    }
}
