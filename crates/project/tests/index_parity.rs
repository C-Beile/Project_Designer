//! Vergleich: der Index muss dieselben Ergebnisse liefern wie der alte Voll-Scan (`problems.rs`),
//! auf allen Fixtures. Gewollte Abweichungen (Alias-Auflösung) kommen erst in P6.4.

use project::problems::{scan_project, scan_usages, ProblemDto};
use project_index::{build_index, BuildOptions, NullLog, NullProgress, ProjectIndex};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

fn fixtures() -> Vec<PathBuf> {
    let here = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut out = vec![here.join("tests/fixtures/DemoProject")];
    for name in ["Hermes", "Pichler", "SVB", "FFG"] {
        out.push(here.join("../aod/tests/fixtures").join(name));
    }
    out.into_iter().filter(|p| p.is_dir()).collect()
}

/// The one wanted difference (P6.4): the index also reports references to aliases that do not exist.
fn without_alias_problems(list: Vec<ProblemDto>) -> Vec<ProblemDto> {
    list.into_iter().filter(|p| !(p.source == "reference" && p.message.starts_with("Reference to alias "))).collect()
}

fn index_of(root: &Path) -> ProjectIndex {
    build_index(root, 1, &BuildOptions::default(), &NullProgress, &AtomicBool::new(false), &NullLog).unwrap().0
}

fn key(p: &ProblemDto) -> String {
    format!("{}|{}|{}|{}|{:?}|{:?}|{:?}|{}", p.node_id, p.source, p.severity, p.message, p.path, p.line, p.column, p.object)
}

#[test]
fn problems_are_the_same_as_the_full_scan() {
    for root in fixtures() {
        let mut old: Vec<String> = scan_project(&root).iter().map(key).collect();
        let mut new: Vec<String> = without_alias_problems(index_of(&root).problems()).iter().map(key).collect();
        old.sort();
        new.sort();
        assert_eq!(old, new, "problems differ for {}", root.display());
    }
}

#[test]
fn problems_come_in_the_same_order() {
    for root in fixtures() {
        let old: Vec<String> = scan_project(&root).iter().map(key).collect();
        let new: Vec<String> = without_alias_problems(index_of(&root).problems()).iter().map(key).collect();
        assert_eq!(old, new, "order differs for {}", root.display());
    }
}

#[test]
fn usages_are_the_same_as_the_full_scan_for_every_entity_view_and_webservice() {
    for root in fixtures() {
        let index = index_of(&root);
        for object_type in ["entity", "neonView", "entityWebservice"] {
            for obj in index.objects_of_type(object_type) {
                let old: Vec<_> = scan_usages(&root, object_type, &obj.name).into_iter().map(|(u, _)| u).collect();
                let new = index.usages(object_type, &obj.name);
                assert_eq!(old, new, "usages of {object_type}/{} differ in {}", obj.name, root.display());
            }
        }
    }
}

#[test]
fn the_fixtures_are_really_there() {
    assert!(!fixtures().is_empty());
    let total: usize = fixtures().iter().map(|r| index_of(r).objects.len()).sum();
    assert!(total > 10, "{total}");
}

#[test]
fn rename_plan_with_the_index_is_the_same_as_without() {
    use project::rename::{plan, plan_with, IndexHints};
    for root in fixtures() {
        let index = index_of(&root);
        for object_type in ["entity", "neonView", "entityWebservice"] {
            for obj in index.objects_of_type(object_type) {
                let aod = root.join(object_type).join(&obj.name).join(format!("{}.aod", obj.name));
                let new_name = format!("{}_Renamed", obj.name);
                let mut seen = std::collections::HashSet::new();
                let candidates = index
                    .usages(object_type, &obj.name)
                    .into_iter()
                    .filter(|u| seen.insert(u.node_id.clone()))
                    .map(|u| (u.object_type, u.object, PathBuf::from(u.node_id)))
                    .collect();
                let hints = IndexHints { candidates, files: index.files().map(|f| f.path.clone()).collect() };
                let old = plan(&root, &aod, &new_name).map(|p| (p.changes, p.hits));
                let new = plan_with(&root, &aod, &new_name, Some(&hints)).map(|p| (p.changes, p.hits));
                assert_eq!(old.is_ok(), new.is_ok(), "{object_type}/{}", obj.name);
                if let (Ok(a), Ok(b)) = (old, new) {
                    assert_eq!(a.0, b.0, "changes of {object_type}/{} in {}", obj.name, root.display());
                    let mut ha: Vec<String> = a.1.iter().map(|h| format!("{}:{}", h.file, h.line)).collect();
                    let mut hb: Vec<String> = b.1.iter().map(|h| format!("{}:{}", h.file, h.line)).collect();
                    ha.sort();
                    hb.sort();
                    assert_eq!(ha, hb, "hits of {object_type}/{}", obj.name);
                }
            }
        }
    }
}

#[test]
fn a_stale_index_cannot_corrupt_a_rename() {
    use project::rename::{apply_with, IndexHints};
    let root = std::env::temp_dir().join(format!("forge-parity-stale-{}", std::process::id()));
    std::fs::create_dir_all(root.join("entity/Old_entity")).unwrap();
    std::fs::create_dir_all(root.join("neonContext/Ctx")).unwrap();
    std::fs::write(root.join("entity/Old_entity/Old_entity.aod"), "<entity>\n  <name>Old_entity</name>\n</entity>\n").unwrap();
    let ctx = root.join("neonContext/Ctx/Ctx.aod");
    std::fs::write(&ctx, "<neonContext>\n  <name>Ctx</name>\n  <entity>Old_entity</entity>\n</neonContext>\n").unwrap();
    let index = index_of(&root);
    // The file changes after the index looked at it (longer text before the reference): offsets move.
    std::fs::write(&ctx, "<neonContext>\n  <name>Ctx</name>\n  <title>a much longer title than before</title>\n  <entity>Old_entity</entity>\n</neonContext>\n").unwrap();
    let candidates = index.usages("entity", "Old_entity").into_iter().map(|u| (u.object_type, u.object, PathBuf::from(u.node_id))).collect();
    let hints = IndexHints { candidates, files: index.files().map(|f| f.path.clone()).collect() };
    apply_with(&root, &root.join("entity/Old_entity/Old_entity.aod"), "New_entity", Some(&hints)).unwrap();
    let text = std::fs::read_to_string(&ctx).unwrap();
    assert!(text.contains("<entity>New_entity</entity>"), "{text}");
    assert!(text.contains("a much longer title"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn a_file_with_a_bom_is_renamed_without_damage() {
    use project::rename::apply;
    let root = std::env::temp_dir().join(format!("forge-parity-bom-{}", std::process::id()));
    std::fs::create_dir_all(root.join("entity/Old_entity")).unwrap();
    std::fs::create_dir_all(root.join("neonContext/Ctx")).unwrap();
    std::fs::write(root.join("entity/Old_entity/Old_entity.aod"), "<entity>\n  <name>Old_entity</name>\n</entity>\n").unwrap();
    let ctx = root.join("neonContext/Ctx/Ctx.aod");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"<neonContext>\n  <name>Ctx</name>\n  <entity>Old_entity</entity>\n</neonContext>\n");
    std::fs::write(&ctx, bytes).unwrap();
    apply(&root, &root.join("entity/Old_entity/Old_entity.aod"), "New_entity").unwrap();
    let out = std::fs::read(&ctx).unwrap();
    assert!(out.starts_with(&[0xEF, 0xBB, 0xBF]));
    assert!(String::from_utf8_lossy(&out).contains("<entity>New_entity</entity>"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn alias_problems_on_the_fixtures_are_few_and_named() {
    for root in fixtures() {
        let list = index_of(&root).problems();
        let aliases: Vec<&ProblemDto> = list.iter().filter(|p| p.message.starts_with("Reference to alias ")).collect();
        eprintln!("{}: {} alias problems of {} total", root.display(), aliases.len(), list.len());
        for a in aliases.iter().take(3) {
            eprintln!("   {}", a.message);
        }
    }
}
