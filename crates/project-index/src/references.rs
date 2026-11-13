//! Vorwärts- und Rückwärts-Verweise. Der Schlüssel ist die DATEI (nicht das Objekt): so hängt
//! nichts an der Art des Absenders, und Alias-Verweise stehen als Kurzname da und werden erst bei
//! der Abfrage aufgelöst (unabhängig von der Reihenfolge, in der Dateien indiziert werden).

use crate::model::{FileKey, RefEntry, Target};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub struct ReferenceIndex {
    forward: HashMap<FileKey, Vec<RefEntry>>,
    /// Target to the files that reference it (each file once).
    reverse: HashMap<Target, Vec<FileKey>>,
}

impl ReferenceIndex {
    /// Replaces all references of `file`.
    pub fn set_file(&mut self, file: &FileKey, refs: Vec<RefEntry>) {
        self.remove_file(file);
        if refs.is_empty() {
            return;
        }
        let mut seen: HashSet<&Target> = HashSet::new();
        for r in &refs {
            if seen.insert(&r.target) {
                self.reverse.entry(r.target.clone()).or_default().push(file.clone());
            }
        }
        self.forward.insert(file.clone(), refs);
    }

    pub fn remove_file(&mut self, file: &FileKey) {
        let Some(old) = self.forward.remove(file) else { return };
        let targets: HashSet<Target> = old.into_iter().map(|r| r.target).collect();
        for t in targets {
            if let Some(list) = self.reverse.get_mut(&t) {
                list.retain(|f| f != file);
                if list.is_empty() {
                    self.reverse.remove(&t);
                }
            }
        }
    }

    pub fn references(&self, file: &FileKey) -> &[RefEntry] {
        self.forward.get(file).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Files that point to `target`.
    pub fn referencing_files(&self, target: &Target) -> &[FileKey] {
        self.reverse.get(target).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Alle Ziele mit den Dateien, die auf sie zeigen (für den Debug-Dump).
    pub fn reverse_entries(&self) -> impl Iterator<Item = (&Target, &Vec<FileKey>)> {
        self.reverse.iter()
    }

    pub fn count(&self) -> usize {
        self.forward.values().map(Vec::len).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aod::references::{ObjectId, ReferenceKind};

    fn r(name: &str) -> RefEntry {
        RefEntry { target: Target::Object(ObjectId::entity(name)), kind: ReferenceKind::NeonContextEntity, site: "entity".into(), line: None, column: None }
    }

    #[test]
    fn set_replaces_old_references_and_the_reverse_list() {
        let mut idx = ReferenceIndex::default();
        let a = "a".to_string();
        idx.set_file(&a, vec![r("X"), r("Y")]);
        assert_eq!(idx.referencing_files(&Target::Object(ObjectId::entity("X"))), &[a.clone()]);
        idx.set_file(&a, vec![r("Y")]);
        assert!(idx.referencing_files(&Target::Object(ObjectId::entity("X"))).is_empty());
        assert_eq!(idx.count(), 1);
        idx.remove_file(&a);
        assert_eq!(idx.count(), 0);
        assert!(idx.referencing_files(&Target::Object(ObjectId::entity("Y"))).is_empty());
    }

    #[test]
    fn a_file_with_two_refs_to_one_target_is_listed_once() {
        let mut idx = ReferenceIndex::default();
        idx.set_file(&"a".to_string(), vec![r("X"), r("X")]);
        assert_eq!(idx.referencing_files(&Target::Object(ObjectId::entity("X"))).len(), 1);
        assert_eq!(idx.count(), 2);
    }

    #[test]
    fn many_referrers_can_be_removed_one_by_one() {
        let mut idx = ReferenceIndex::default();
        for i in 0..1000 {
            idx.set_file(&format!("f{i}"), vec![r("Popular")]);
        }
        assert_eq!(idx.referencing_files(&Target::Object(ObjectId::entity("Popular"))).len(), 1000);
        for i in 0..1000 {
            idx.remove_file(&format!("f{i}"));
        }
        assert_eq!(idx.count(), 0);
    }

    #[test]
    fn alias_references_do_not_depend_on_order() {
        // An alias reference is stored as the short name, nothing to resolve while indexing.
        let mut idx = ReferenceIndex::default();
        let e = RefEntry { target: Target::AliasShort("Data_alias".into()), kind: ReferenceKind::DbRecordContainerAlias, site: "x".into(), line: None, column: None };
        idx.set_file(&"entity".to_string(), vec![e]);
        assert_eq!(idx.referencing_files(&Target::AliasShort("Data_alias".into())).len(), 1);
    }
}
