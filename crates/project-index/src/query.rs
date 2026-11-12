//! Lese-API des Index. Alles hier ist rein lesend und rechnet aus dem Stand: Verweis-Probleme
//! ("Ziel fehlt") sind NICHT pro Datei gespeichert, weil sie sich ändern, sobald irgendwo ein Ziel
//! auftaucht oder verschwindet.

use crate::layout::{object_folder_rank, OBJECT_FOLDERS};
use crate::model::{FileEntry, FileKey, ObjectEntry, ProblemDto, ProjectIndex, RefEntry, Target, UsageDto};
use aod::references::{ObjectId, ObjectKind};
use platform::fs::path_key;
use std::collections::HashSet;
use std::path::Path;

/// Reports references to alias objects that do not exist (the old problem scan never did).
/// A reference names an alias by its short name (`targetAliasName`); it counts as found when a
/// project alias or an alias of an installed module declares it.
pub const REPORT_MISSING_ALIASES: bool = true;

/// The object type (= folder) an `ObjectKind` lives in.
fn folder_of(kind: ObjectKind) -> Option<&'static str> {
    match kind {
        ObjectKind::Entity => Some("entity"),
        ObjectKind::View => Some("neonView"),
        ObjectKind::Webservice => Some("entityWebservice"),
        ObjectKind::Alias => Some("aliasDefinition"),
        _ => None,
    }
}

impl ProjectIndex {
    /// An object of the project or of an installed module.
    pub fn object_exists(&self, object_type: &str, name: &str) -> bool {
        if self.by_name.keys().any(|(t, n)| *t == object_type && n == name) {
            return true;
        }
        self.modules.names_by_folder.get(object_type).is_some_and(|names| names.contains(name))
    }

    fn object_exists_fast(&self, folder: &'static str, name: &str) -> bool {
        self.by_name.contains_key(&(folder, name.to_string())) || self.modules.names_by_folder.get(folder).is_some_and(|n| n.contains(name))
    }

    fn linked_file_exists(&self, text: &str) -> bool {
        let rel = text.strip_prefix("%aditoprj%/").unwrap_or(text);
        let path = self.root.join(rel);
        self.files.contains_key(&path_key(&path)) || path.is_file()
    }

    /// `Some((exists, what))` for a target the problem scan checks, `None` for one it skips.
    fn check(&self, target: &Target, aliases: &HashSet<&str>) -> Option<(bool, &'static str)> {
        match target {
            Target::Object(id) => {
                let folder = folder_of(id.kind)?;
                let what = match id.kind {
                    ObjectKind::Entity => "entity",
                    ObjectKind::View => "view",
                    ObjectKind::Webservice => "webservice",
                    _ => return None,
                };
                Some((self.object_exists_fast(folder, &id.name), what))
            }
            Target::LinkedFile(text) => Some((self.linked_file_exists(text), "linked file")),
            Target::AliasShort(short) => {
                // Without installed modules the system aliases (`Data_alias`, ...) cannot be known: say nothing.
                if !REPORT_MISSING_ALIASES || !self.modules_installed() {
                    return None;
                }
                Some((aliases.contains(short.as_str()), "alias"))
            }
        }
    }

    /// Objects of installed npm modules are known (`node_modules` has packages).
    fn modules_installed(&self) -> bool {
        self.modules.names_by_folder.values().any(|n| !n.is_empty()) || !self.modules.alias_targets.is_empty()
    }

    fn target_name(target: &Target) -> &str {
        match target {
            Target::Object(id) => &id.name,
            Target::AliasShort(s) | Target::LinkedFile(s) => s,
        }
    }

    /// Objects of the problem scan (the `OBJECT_FOLDERS` families) in the listing order: by family, then name.
    fn ordered_objects(&self) -> Vec<(&FileKey, &ObjectEntry)> {
        let mut list: Vec<(&FileKey, &ObjectEntry)> = self.objects.iter().filter(|(_, o)| object_folder_rank(o.object_type).is_some()).collect();
        list.sort_by(|a, b| {
            let (ra, rb) = (object_folder_rank(a.1.object_type), object_folder_rank(b.1.object_type));
            ra.cmp(&rb).then_with(|| a.1.name.cmp(&b.1.name))
        });
        list
    }

    fn file_path(&self, key: &FileKey) -> String {
        self.files.get(key).map(|f| f.path.to_string_lossy().into_owned()).unwrap_or_default()
    }

    /// Short alias names that exist: those of the project's aliases and of the installed modules.
    fn known_aliases(&self) -> HashSet<&str> {
        let mut set: HashSet<&str> = self.modules.alias_targets.keys().map(String::as_str).collect();
        set.extend(self.objects.values().filter_map(|o| o.alias_target_name.as_deref()));
        set
    }

    /// All problems: parse + validator problems and references whose target is missing.
    pub fn problems(&self) -> Vec<ProblemDto> {
        let aliases = self.known_aliases();
        let mut out = Vec::new();
        for (key, obj) in self.ordered_objects() {
            if let Some(list) = self.static_problems.get(key) {
                out.extend(list.iter().cloned());
            }
            let node_id = self.file_path(key);
            for r in self.refs.references(key) {
                let Some((exists, what)) = self.check(&r.target, &aliases) else { continue };
                if exists {
                    continue;
                }
                out.push(ProblemDto {
                    node_id: node_id.clone(),
                    object: obj.name.clone(),
                    object_type: obj.object_type.to_string(),
                    source: "reference".to_string(),
                    severity: "Error".to_string(),
                    message: format!("Reference to {what} '{}' not found", Self::target_name(&r.target)),
                    path: Some(r.site.clone()),
                    line: r.line,
                    column: r.column,
                });
            }
        }
        out
    }

    /// Number of references whose target is missing (for the PERF log).
    pub fn unresolved_count(&self) -> u32 {
        let aliases = self.known_aliases();
        self.objects
            .keys()
            .flat_map(|k| self.refs.references(k))
            .filter(|r| self.check(&r.target, &aliases).is_some_and(|(exists, _)| !exists))
            .count() as u32
    }

    /// The target of Find Usages for an object family; `None` for families nothing points to.
    fn usage_target(object_type: &str, name: &str) -> Option<Target> {
        let kind = match object_type {
            "entity" => ObjectKind::Entity,
            "neonView" => ObjectKind::View,
            "entityWebservice" => ObjectKind::Webservice,
            _ => return None,
        };
        Some(Target::Object(ObjectId::new(kind, name)))
    }

    /// Every place in the project's own objects that points to `object_type`/`name`.
    pub fn usages(&self, object_type: &str, name: &str) -> Vec<UsageDto> {
        let Some(target) = Self::usage_target(object_type, name) else { return Vec::new() };
        let mut files: Vec<(&FileKey, &ObjectEntry)> =
            self.refs.referencing_files(&target).iter().filter_map(|k| self.objects.get_key_value(k)).filter(|(_, o)| object_folder_rank(o.object_type).is_some()).collect();
        files.sort_by(|a, b| object_folder_rank(a.1.object_type).cmp(&object_folder_rank(b.1.object_type)).then_with(|| a.1.name.cmp(&b.1.name)));
        let mut out = Vec::new();
        for (key, obj) in files {
            let node_id = self.file_path(key);
            for r in self.refs.references(key).iter().filter(|r| r.target == target) {
                out.push(UsageDto {
                    node_id: node_id.clone(),
                    object: obj.name.clone(),
                    object_type: obj.object_type.to_string(),
                    path: Some(r.site.clone()),
                    line: r.line,
                    column: r.column,
                    kind: format!("{:?}", r.kind),
                });
            }
        }
        out
    }

    /// Files that point to `target`.
    pub fn referenced_by(&self, target: &Target) -> Vec<&FileKey> {
        self.refs.referencing_files(target).iter().collect()
    }

    /// References of one file.
    pub fn references(&self, file: &Path) -> &[RefEntry] {
        self.refs.references(&path_key(file))
    }

    pub fn files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.values()
    }

    pub fn objects_of_type(&self, object_type: &str) -> Vec<&ObjectEntry> {
        let mut list: Vec<&ObjectEntry> = self.objects.values().filter(|o| o.object_type == object_type).collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }
}

/// Used by tests and `OBJECT_FOLDERS` consumers: the families Problems lists.
pub fn problem_families() -> impl Iterator<Item = &'static str> {
    OBJECT_FOLDERS.iter().map(|(_, t)| *t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::testing::*;
    use crate::build::{build_index, BuildOptions};
    use crate::log::NullLog;
    use crate::progress::NullProgress;
    use std::sync::atomic::AtomicBool;

    fn build(root: &Path) -> ProjectIndex {
        build_index(root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(false), &NullLog).unwrap().0
    }

    #[test]
    fn a_missing_target_is_a_reference_problem_and_appears_when_the_target_is_deleted() {
        let root = temp_project();
        write_object(&root, "neonContext", "Lost", &context("Lost", "Missing_entity"));
        let index = build(&root);
        let p = index.problems();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].source, "reference");
        assert!(p[0].message.contains("Missing_entity"));
        assert_eq!(p[0].line, Some(3));

        write_object(&root, "entity", "Missing_entity", &entity("Missing_entity"));
        assert!(build(&root).problems().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_reference_into_a_module_is_not_dangling() {
        let root = temp_project();
        write_object(&root, "neonContext", "Uses", &context("Uses", "FromModule_entity"));
        write_object(&root.join("node_modules").join("@scope").join("mod"), "entity", "FromModule_entity", &entity("FromModule_entity"));
        assert!(build(&root).problems().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn usages_list_the_referencing_contexts_with_their_line() {
        let root = temp_project();
        write_object(&root, "entity", "Used_entity", &entity("Used_entity"));
        write_object(&root, "neonContext", "A", &context("A", "Used_entity"));
        write_object(&root, "neonContext", "B", &context("B", "Other_entity"));
        let index = build(&root);
        let u = index.usages("entity", "Used_entity");
        assert_eq!(u.len(), 1);
        assert_eq!(u[0].object, "A");
        assert_eq!(u[0].line, Some(3));
        assert!(index.usages("language", "x").is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_alias_is_reported_and_a_project_alias_fixes_it() {
        let root = temp_project();
        let ent = "<entity>\n  <name>E_entity</name>\n  <recordContainers>\n    <dbRecordContainer>\n      <name>db</name>\n      <alias>Data_alias</alias>\n    </dbRecordContainer>\n  </recordContainers>\n</entity>\n";
        write_object(&root, "entity", "E_entity", ent);
        assert!(build(&root).problems().iter().all(|p| !p.message.contains("alias")), "without modules nothing is said about aliases");
        write_object(&root.join("node_modules").join("m"), "entity", "Mod_entity", &entity("Mod_entity"));
        let p = build(&root).problems();
        assert!(p.iter().any(|p| p.source == "reference" && p.message.contains("alias 'Data_alias'")), "{p:?}");

        // order of indexing does not matter: the alias object comes later (folder `aliasDefinition`)
        write_object(&root, "aliasDefinition", "Data_alias", "<aliasDefinition><name>Data_alias</name><aliasDefDb><targetAliasName>Data_alias</targetAliasName></aliasDefDb></aliasDefinition>");
        assert!(build(&root).problems().iter().all(|p| !p.message.contains("alias 'Data_alias'")));
        std::fs::remove_dir_all(&root).ok();
    }
}
