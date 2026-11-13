//! Problem-Scan hinter dem Problems-Tab (LEGACY-Weg). Der Index (`project-index`) liefert dieselben Daten
//! aus dem Speicher; dieser Scan bleibt als Fallback (Index noch nicht bereit) und als Vergleich
//! (`tests/index_parity.rs`). Strikt lesend, jedes Objekt wird kurz geöffnet.

use crate::tree::OBJECT_FOLDERS;
use aod::references::read_references;
use aod::references::{ObjectId, ObjectKind};
use aod::tree::path::NodePath;
use aod::tree::value::PropertyValue as CoreValue;
use project_index::analyze::{analyze_file, problem};
use project_index::modules::module_package_dirs;
use project_index::text_pos::span_line_col;
use project_index::{parse_node_path, Target};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use validators::validator_table::root_tag;

pub use project_index::{validate_aod_bytes, ProblemDto, UsageDto};

fn names_in(dir: &Path, into: &mut HashSet<String>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                into.insert(e.file_name().to_string_lossy().into_owned());
            }
        }
    }
}

/// Names of all existing objects of a type folder in the project and its installed modules.
fn existing_names(root: &Path, folder: &str) -> HashSet<String> {
    let mut names = HashSet::new();
    names_in(&root.join(folder), &mut names);
    for pkg in module_package_dirs(root) {
        names_in(&pkg.join(folder), &mut names);
    }
    names
}

pub fn scan_project(project_root: &Path) -> Vec<ProblemDto> {
    let entities = existing_names(project_root, "entity");
    let views = existing_names(project_root, "neonView");
    let webservices = existing_names(project_root, "entityWebservice");
    let mut jobs: Vec<(&str, String, PathBuf)> = Vec::new();
    for (folder, object_type) in OBJECT_FOLDERS {
        let Ok(entries) = std::fs::read_dir(project_root.join(folder)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            let name = entry.file_name().to_string_lossy().into_owned();
            let file = entry.path().join(format!("{name}.aod"));
            jobs.push((object_type, name, file));
        }
    }
    // Every object is read and checked on its own, so many objects are worked on at the same time (a project has
    // thousands of small files; waiting for the disk dominates). The order of the findings stays that of the objects.
    let per_object = crate::parallel::parallel_map(&jobs, crate::parallel::io_threads(), |(object_type, name, file)| {
        let Ok(bytes) = std::fs::read(file) else { return Vec::new() };
        let analysis = analyze_file(file, &bytes, object_type, name);
        let mut out = analysis.problems;
        for r in analysis.refs {
            let (exists, what, shown) = match &r.target {
                Target::Object(id) => match id.kind {
                    ObjectKind::Entity => (entities.contains(&id.name), "entity", id.name.clone()),
                    ObjectKind::View => (views.contains(&id.name), "view", id.name.clone()),
                    ObjectKind::Webservice => (webservices.contains(&id.name), "webservice", id.name.clone()),
                    _ => continue,
                },
                Target::LinkedFile(text) => {
                    let rel = text.strip_prefix("%aditoprj%/").unwrap_or(text);
                    (project_root.join(rel).is_file(), "linked file", text.clone())
                }
                // The scan never resolved aliases.
                Target::AliasShort(_) => continue,
            };
            if exists {
                continue;
            }
            let mut p = problem(file, name, object_type, "reference", "Error", format!("Reference to {what} '{shown}' not found"));
            p.path = Some(r.site);
            p.line = r.line;
            p.column = r.column;
            out.push(p);
        }
        out
    });
    per_object.into_iter().flatten().collect()
}

/// Every place in the project's own objects that points to `object_type`/`name` (Find Usages and
/// the check behind Safely Delete). Read-only; references from installed modules are not listed.
pub fn find_usages(project_root: &Path, object_type: &str, name: &str) -> Vec<UsageDto> {
    scan_usages(project_root, object_type, name).into_iter().map(|(u, _)| u).collect()
}

/// Byte range of the referencing element inside a file.
pub type UsageSpan = (PathBuf, usize, usize);

/// An object file to look into: `(object_type, object name, file)`.
pub type UsageJob = (String, String, PathBuf);

/// All object files of the project in the listing order (by family, then name).
pub fn list_object_files(project_root: &Path) -> Vec<UsageJob> {
    let mut jobs = Vec::new();
    for (folder, own_type) in OBJECT_FOLDERS {
        let Ok(entries) = std::fs::read_dir(project_root.join(folder)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for entry in dirs {
            let obj = entry.file_name().to_string_lossy().into_owned();
            let file = entry.path().join(format!("{obj}.aod"));
            jobs.push((own_type.to_string(), obj, file));
        }
    }
    jobs
}

/// Like `find_usages`, plus the byte range of each referencing element (used by Rename).
pub fn scan_usages(project_root: &Path, object_type: &str, name: &str) -> Vec<(UsageDto, Option<UsageSpan>)> {
    scan_usages_in(&list_object_files(project_root), object_type, name)
}

/// Like `scan_usages`, but only looks into `jobs` (the index names the candidates; the files are parsed fresh here,
/// so the byte ranges are always exact).
pub fn scan_usages_in(jobs: &[UsageJob], object_type: &str, name: &str) -> Vec<(UsageDto, Option<UsageSpan>)> {
    let target = match object_type {
        "entity" => ObjectId::new(ObjectKind::Entity, name),
        "neonView" => ObjectId::new(ObjectKind::View, name),
        "entityWebservice" => ObjectId::new(ObjectKind::Webservice, name),
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for (own_type, obj, file) in jobs {
        let Ok(bytes) = std::fs::read(file) else { continue };
        let Ok(handle) = designer_core::open_project_bytes(file.clone(), &bytes) else { continue };
        let Some(root) = handle.value_at(&NodePath::root()).cloned() else { continue };
        let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&bytes);
        let bom = bytes.len() - body.len();
        let tag = root_tag(body);
        let wrapped = CoreValue::Object(vec![(tag.clone(), root)]);
        let from = ObjectId::new(ObjectKind::Entity, obj.clone());
        for edge in read_references(&from, &wrapped, &|_| None) {
            if edge.to != target {
                continue;
            }
            let site = edge.site.to_string();
            let site_path = site.strip_prefix(&format!("{tag}.")).unwrap_or(&site).to_string();
            let mut span_out = None;
            let mut u = UsageDto {
                node_id: file.to_string_lossy().into_owned(),
                object: obj.clone(),
                object_type: own_type.clone(),
                path: None,
                line: None,
                column: None,
                kind: format!("{:?}", edge.kind),
            };
            if let Ok(np) = parse_node_path(&site_path) {
                if let Some(span) = handle.element_span(&np) {
                    let (l, c) = span_line_col(body, span);
                    u.line = Some(l);
                    u.column = Some(c);
                    // The span counts from after the BOM; the caller works on the whole file.
                    span_out = Some((file.clone(), span.start + bom, span.end.min(body.len()) + bom));
                }
                u.path = Some(site_path);
            }
            out.push((u, span_out));
        }
    }
    out
}

fn object_type_tag(wrapped: &CoreValue) -> String {
    match wrapped {
        CoreValue::Object(fields) => fields.first().map(|(k, _)| k.clone()).unwrap_or_default(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn temp_project() -> PathBuf {
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("forge-problems-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, folder: &str, name: &str, text: &str) {
        let dir = root.join(folder).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{name}.aod")), text).unwrap();
    }

    #[test]
    fn a_broken_file_is_reported_with_its_line() {
        let root = temp_project();
        write(&root, "entity", "Broken_entity", "<?xml version=\"1.0\"?>\n<entity>\n  <name>Broken_entity</name>\n  <title>x</wrong>\n</entity>\n");
        let problems = scan_project(&root);
        let p = problems.iter().find(|p| p.source == "parse").expect("parse problem");
        assert_eq!(p.object, "Broken_entity");
        assert_eq!(p.severity, "Error");
        assert_eq!(p.line, Some(4), "{p:?}");
    }

    #[test]
    fn a_context_pointing_to_a_missing_entity_is_a_reference_error() {
        let root = temp_project();
        write(&root, "neonContext", "Lost", "<neonContext>\n  <name>Lost</name>\n  <entity>Missing_entity</entity>\n</neonContext>\n");
        let problems = scan_project(&root);
        let p = problems.iter().find(|p| p.source == "reference").expect("reference problem");
        assert!(p.message.contains("Missing_entity"));
        assert_eq!(p.line, Some(3), "{p:?}");

        write(&root, "entity", "Missing_entity", "<entity>\n  <name>Missing_entity</name>\n</entity>\n");
        assert!(scan_project(&root).iter().all(|p| p.source != "reference"));
    }

    #[test]
    fn a_reference_into_an_installed_module_is_not_dangling() {
        let root = temp_project();
        write(&root, "neonContext", "Uses", "<neonContext>\n  <name>Uses</name>\n  <entity>FromModule_entity</entity>\n</neonContext>\n");
        write(&root.join("node_modules").join("@scope").join("mod"), "entity", "FromModule_entity", "<entity><name>FromModule_entity</name></entity>");
        assert!(scan_project(&root).iter().all(|p| p.source != "reference"));
    }

    #[test]
    fn usages_of_an_entity_list_the_referencing_contexts_with_their_line() {
        let root = temp_project();
        write(&root, "entity", "Used_entity", "<entity>
  <name>Used_entity</name>
</entity>
");
        write(&root, "neonContext", "A", "<neonContext>
  <name>A</name>
  <entity>Used_entity</entity>
</neonContext>
");
        write(&root, "neonContext", "B", "<neonContext>
  <name>B</name>
  <entity>Other_entity</entity>
</neonContext>
");
        let usages = find_usages(&root, "entity", "Used_entity");
        assert_eq!(usages.len(), 1, "{usages:?}");
        assert_eq!(usages[0].object, "A");
        assert_eq!(usages[0].line, Some(3));
        assert!(find_usages(&root, "language", "x").is_empty());
    }

    #[test]
    fn the_demo_project_scans_without_parse_errors() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/DemoProject");
        let problems = scan_project(&root);
        assert!(problems.iter().all(|p| p.source != "parse"), "{problems:?}");
    }
}
