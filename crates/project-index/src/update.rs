//! Änderungen einspielen. Zwei Schritte, damit die Schreibsperre nur kurz gehalten wird:
//! `compute_delta` liest und analysiert OHNE Sperre (nur lesender Zugriff auf den Index),
//! `apply_delta` trägt das Ergebnis ein. Der Abgleich per `stat` entscheidet, was wirklich passiert
//! ist; die Pfade eines Batches sagen nur, was berührt wurde. Ein Ordner wird als ganzer Teilbaum
//! abgeglichen (der Explorer meldet beim Umbenennen oft nur den Ordner selbst).

use crate::build::{forget_file, read_object, rel_of, store_object, walk_files, Cancelled, ObjectRead};
use crate::events::{ChangeKind, ChangedFile};
use crate::layout::object_of;
use crate::model::{FileEntry, FileKey, ProjectIndex, Target};
use aod::references::ObjectId;
use app_base::parallel::parallel_map;
use file_watcher::IgnoreRules;
use platform::fs::{path_key, stamp_of};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Upsert {
    pub key: FileKey,
    pub entry: FileEntry,
    pub kind: ChangeKind,
    pub object: Option<(&'static str, String, ObjectRead)>,
}

#[derive(Default)]
pub struct Delta {
    pub removed: Vec<(FileKey, ChangedFile)>,
    pub upserts: Vec<Upsert>,
}

impl Delta {
    pub fn is_empty(&self) -> bool {
        self.removed.is_empty() && self.upserts.is_empty()
    }

    pub fn len(&self) -> usize {
        self.removed.len() + self.upserts.len()
    }
}

#[derive(Debug, Default)]
pub struct Applied {
    pub changed: Vec<ChangedFile>,
    /// Files whose problems may have changed (they point to something that appeared or vanished).
    pub affected: Vec<String>,
}

/// The target an object of this family can be pointed to by.
fn object_target(object_type: &str, name: &str) -> Option<Target> {
    use aod::references::ObjectKind;
    let kind = match object_type {
        "entity" => ObjectKind::Entity,
        "neonView" => ObjectKind::View,
        "entityWebservice" => ObjectKind::Webservice,
        _ => return None,
    };
    Some(Target::Object(ObjectId::new(kind, name)))
}

fn changed_file(entry_path: &Path, rel: &str, kind: ChangeKind, own: bool) -> ChangedFile {
    let (object_type, name) = object_of(rel).map(|(t, n)| (Some(t.to_string()), Some(n))).unwrap_or((None, None));
    ChangedFile { path: entry_path.to_string_lossy().into_owned(), kind, own, object_type, name }
}

/// Compares the disk below `paths` with the index and reads what is new or changed.
/// `own` holds the keys of files the app wrote itself.
pub fn compute_delta(index: &ProjectIndex, paths: &[PathBuf], own: &HashSet<FileKey>, rules: &IgnoreRules, threads: usize, cancel: &AtomicBool) -> Result<Delta, Cancelled> {
    let root = &index.root;
    let root_key = path_key(root);
    let root_comps = root.components().count();
    let mut disk: BTreeMap<FileKey, FileEntry> = BTreeMap::new();
    let mut existing: BTreeSet<FileKey> = BTreeSet::new();

    for p in paths {
        let key = path_key(p);
        if key != root_key && !key.starts_with(&format!("{root_key}/")) {
            continue;
        }
        if index.files.contains_key(&key) {
            existing.insert(key.clone());
        }
        let prefix = format!("{key}/");
        for (k, _) in index.files.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)) {
            existing.insert(k.clone());
        }
        match std::fs::metadata(p) {
            Ok(m) if m.is_dir() => {
                let dir_rel = rel_of(p, root_comps);
                if !dir_rel.is_empty() && rules.is_ignored(&dir_rel) {
                    continue;
                }
                for f in walk_files(root, p, rules, cancel, |_| {})? {
                    disk.insert(path_key(&f.path), f);
                }
            }
            Ok(m) => {
                let rel = rel_of(p, root_comps);
                if !rules.is_ignored(&rel) {
                    disk.insert(key, FileEntry { path: p.clone(), rel, stamp: Some(stamp_of(&m)) });
                }
            }
            Err(_) => {}
        }
    }

    let mut delta = Delta::default();
    let mut to_read: Vec<(FileKey, FileEntry, ChangeKind)> = Vec::new();
    for (key, entry) in disk.iter() {
        let kind = match index.files.get(key) {
            None => ChangeKind::Added,
            Some(old) if old.stamp.is_none() || old.stamp != entry.stamp => ChangeKind::Modified,
            Some(_) => continue,
        };
        to_read.push((key.clone(), entry.clone(), kind));
    }
    for key in existing.iter().filter(|k| !disk.contains_key(*k)) {
        if let Some(old) = index.files.get(key) {
            delta.removed.push((key.clone(), changed_file(&old.path, &old.rel, ChangeKind::Removed, own.contains(key))));
        }
    }

    let jobs: Vec<(usize, &'static str, String)> = to_read.iter().enumerate().filter_map(|(i, (_, e, _))| object_of(&e.rel).map(|(t, n)| (i, t, n))).collect();
    let reads = parallel_map(&jobs, threads, |(i, object_type, name)| {
        if cancel.load(Ordering::Relaxed) {
            return None;
        }
        Some(read_object(&to_read[*i].1.path, object_type, name))
    });
    if cancel.load(Ordering::Relaxed) {
        return Err(Cancelled);
    }
    let mut reads_by_index: BTreeMap<usize, ObjectRead> = BTreeMap::new();
    for ((i, _, _), r) in jobs.iter().zip(reads) {
        if let Some(r) = r {
            reads_by_index.insert(*i, r);
        }
    }
    let object_info: BTreeMap<usize, (&'static str, String)> = jobs.into_iter().map(|(i, t, n)| (i, (t, n))).collect();
    for (i, (key, entry, kind)) in to_read.into_iter().enumerate() {
        let object = match (object_info.get(&i), reads_by_index.remove(&i)) {
            (Some((t, n)), Some(read)) => Some((*t, n.clone(), read)),
            _ => None,
        };
        delta.upserts.push(Upsert { key, entry, kind, object });
    }
    Ok(delta)
}

fn linked_targets(rel: &str) -> [Target; 2] {
    [Target::LinkedFile(format!("%aditoprj%/{rel}")), Target::LinkedFile(rel.to_string())]
}

/// Enters the delta into the index.
pub fn apply_delta(index: &mut ProjectIndex, delta: Delta, own: &HashSet<FileKey>) -> Applied {
    let mut targets: Vec<Target> = Vec::new();
    let mut changed: Vec<ChangedFile> = Vec::new();

    for (key, change) in delta.removed {
        if let Some(obj) = index.objects.get(&key) {
            targets.extend(object_target(obj.object_type, &obj.name));
            if let Some(short) = &obj.alias_target_name {
                targets.push(Target::AliasShort(short.clone()));
            }
        } else if let Some(f) = index.files.get(&key) {
            targets.extend(linked_targets(&f.rel));
        }
        forget_file(index, &key);
        changed.push(change);
    }

    for u in delta.upserts {
        let is_new = u.kind == ChangeKind::Added;
        let old_alias = index.objects.get(&u.key).and_then(|o| o.alias_target_name.clone());
        let change = changed_file(&u.entry.path, &u.entry.rel, u.kind, own.contains(&u.key));
        let path = u.entry.path.clone();
        index.files.insert(u.key.clone(), u.entry);
        match u.object {
            Some((object_type, name, read)) => {
                if is_new {
                    targets.extend(object_target(object_type, &name));
                }
                store_object(index, &u.key, &path, object_type, &name, read);
                let new_alias = index.objects.get(&u.key).and_then(|o| o.alias_target_name.clone());
                if old_alias != new_alias {
                    targets.extend(old_alias.map(Target::AliasShort));
                    targets.extend(new_alias.map(Target::AliasShort));
                }
            }
            None => {
                if is_new {
                    targets.extend(linked_targets(&change_rel(&change, &index.root)));
                }
            }
        }
        changed.push(change);
    }

    let changed_paths: HashSet<&str> = changed.iter().map(|c| c.path.as_str()).collect();
    let mut affected: BTreeSet<String> = BTreeSet::new();
    for t in &targets {
        for key in index.refs.referencing_files(t) {
            if let Some(f) = index.files.get(key) {
                let p = f.path.to_string_lossy().into_owned();
                if !changed_paths.contains(p.as_str()) {
                    affected.insert(p);
                }
            }
        }
    }
    Applied { changed, affected: affected.into_iter().collect() }
}

/// The path of a changed file relative to the project (for linked-file targets).
fn change_rel(change: &ChangedFile, root: &Path) -> String {
    let comps = root.components().count();
    rel_of(Path::new(&change.path), comps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::testing::*;
    use crate::build::{build_index, BuildOptions};
    use crate::log::NullLog;
    use crate::progress::NullProgress;

    fn build(root: &Path) -> ProjectIndex {
        build_index(root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(false), &NullLog).unwrap().0
    }

    fn update(index: &mut ProjectIndex, paths: &[PathBuf]) -> Applied {
        let own = HashSet::new();
        let delta = compute_delta(index, paths, &own, &IgnoreRules::standard(), 4, &AtomicBool::new(false)).unwrap();
        apply_delta(index, delta, &own)
    }

    #[test]
    fn a_changed_file_is_re_read_and_a_deleted_one_is_forgotten() {
        let root = temp_project();
        let a = write_object(&root, "neonContext", "A", &context("A", "X_entity"));
        let mut index = build(&root);
        assert_eq!(index.problems().len(), 1);

        std::fs::write(&a, format!("{}\n<!-- longer -->", context("A", "Y_entity"))).unwrap();
        let applied = update(&mut index, &[a.clone()]);
        assert_eq!(applied.changed.len(), 1);
        assert_eq!(applied.changed[0].kind, ChangeKind::Modified);
        assert!(index.problems()[0].message.contains("Y_entity"));

        std::fs::remove_file(&a).unwrap();
        let applied = update(&mut index, &[a]);
        assert_eq!(applied.changed[0].kind, ChangeKind::Removed);
        assert!(index.objects.is_empty());
        assert!(index.problems().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_new_file_is_added_and_makes_referrers_affected() {
        let root = temp_project();
        let a = write_object(&root, "neonContext", "A", &context("A", "New_entity"));
        let mut index = build(&root);
        assert_eq!(index.problems().len(), 1);
        let e = write_object(&root, "entity", "New_entity", &entity("New_entity"));
        let applied = update(&mut index, &[e]);
        assert_eq!(applied.changed[0].kind, ChangeKind::Added);
        assert_eq!(applied.changed[0].name.as_deref(), Some("New_entity"));
        assert_eq!(applied.affected, vec![a.to_string_lossy().into_owned()]);
        assert!(index.problems().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_renamed_folder_touched_only_by_its_own_path_is_compared_as_a_subtree() {
        let root = temp_project();
        write_object(&root, "entity", "Old_entity", &entity("Old_entity"));
        let mut index = build(&root);
        let old_dir = root.join("entity/Old_entity");
        let new_dir = root.join("entity/Newer_entity");
        std::fs::rename(&old_dir, &new_dir).unwrap();
        std::fs::rename(new_dir.join("Old_entity.aod"), new_dir.join("Newer_entity.aod")).unwrap();
        // only the folder paths are reported
        let applied = update(&mut index, &[old_dir, new_dir]);
        assert_eq!(applied.changed.len(), 2);
        assert!(index.by_name.contains_key(&("entity", "Newer_entity".to_string())));
        assert!(!index.by_name.contains_key(&("entity", "Old_entity".to_string())));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_whole_project_reconcile_finds_everything_and_nothing_twice() {
        let root = temp_project();
        write_object(&root, "entity", "A_entity", &entity("A_entity"));
        let mut index = build(&root);
        write_object(&root, "entity", "B_entity", &entity("B_entity"));
        std::fs::remove_dir_all(root.join("entity/A_entity")).unwrap();
        let applied = update(&mut index, &[root.clone()]);
        assert_eq!(applied.changed.len(), 2);
        let again = update(&mut index, &[root.clone()]);
        assert!(again.changed.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_new_linked_file_makes_its_referrers_affected() {
        let root = temp_project();
        let e = write_object(
            &root,
            "entity",
            "F_entity",
            "<entity>\n  <name>F_entity</name>\n  <entityFields>\n    <entityField>\n      <name>f</name>\n      <valueProcess>%aditoprj%/process/p/value.js</valueProcess>\n    </entityField>\n  </entityFields>\n</entity>\n",
        );
        let mut index = build(&root);
        assert_eq!(index.problems().len(), 1, "the linked file is missing");
        std::fs::create_dir_all(root.join("process/p")).unwrap();
        let js = root.join("process/p/value.js");
        std::fs::write(&js, "x").unwrap();
        let applied = update(&mut index, &[js]);
        assert_eq!(applied.affected, vec![e.to_string_lossy().into_owned()]);
        assert!(index.problems().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
