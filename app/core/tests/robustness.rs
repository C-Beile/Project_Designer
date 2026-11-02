// Hardening (rc2): damaged and unusual files, read-only files and external changes, end to end
// through the project actor. Where the corpus copy exists, real objects are damaged on purpose.

use forge_app_core::project_actor::ProjectActorHandle;
use forge_app_core::wire::WireValue;
use std::path::{Path, PathBuf};

const GOOD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity xmlns=\"http://www.adito.de/2018/ao/Model\" VERSION=\"1.2.0\">\r\n  <name>Foo_entity</name>\r\n  <title>Old</title>\r\n</entity>";

fn project(label: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("forge-robust-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("entity/Foo_entity")).unwrap();
    d
}

fn aod(root: &Path) -> PathBuf {
    root.join("entity/Foo_entity/Foo_entity.aod")
}

fn id(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn set_title(a: &ProjectActorHandle, node: &str, v: &str) -> Result<WireValue, String> {
    a.set_property(node.to_string(), "title".into(), WireValue::Text { value: v.into() })
}

#[test]
fn damaged_files_give_errors_not_panics_and_the_actor_keeps_working() {
    let root = project("damaged");
    let a = ProjectActorHandle::spawn();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", vec![]),
        ("garbage", vec![0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]),
        ("text", b"this is not xml at all".to_vec()),
        ("truncated", GOOD.as_bytes()[..GOOD.len() / 2].to_vec()),
        ("unclosed", b"<entity><name>X</name>".to_vec()),
        ("only-bom", vec![0xef, 0xbb, 0xbf]),
        ("nul-bytes", b"<entity>\0\0\0</entity>".to_vec()),
    ];
    for (name, bytes) in cases {
        std::fs::write(aod(&root), &bytes).unwrap();
        let node = id(&aod(&root));
        a.reload(node.clone()).unwrap();
        let r = a.get_property_tree(node.clone());
        eprintln!("{name}: {}", match &r {
            Ok(_) => "opened".to_string(),
            Err(e) => format!("error: {}", e.chars().take(100).collect::<String>()),
        });
        let _ = a.navigator(node.clone());
        let _ = a.property_sheet(node.clone(), "$".into(), None);
        let _ = a.list_diagnostics(node.clone());
    }
    // The actor still answers after all of that.
    std::fs::write(aod(&root), GOOD).unwrap();
    let node = id(&aod(&root));
    a.reload(node.clone()).unwrap();
    assert!(a.get_property_tree(node).is_ok(), "the actor must survive damaged files");
}

#[test]
fn bom_and_crlf_files_open_and_save_without_changing_unrelated_bytes() {
    let root = project("bom");
    let a = ProjectActorHandle::spawn();
    for (label, text) in [("bom-crlf", format!("\u{feff}{GOOD}")), ("lf", GOOD.replace("\r\n", "\n")), ("crlf-trailing", format!("{GOOD}\r\n"))] {
        std::fs::write(aod(&root), text.as_bytes()).unwrap();
        let node = id(&aod(&root));
        a.reload(node.clone()).unwrap();
        let opened = a.get_property_tree(node.clone());
        assert!(opened.is_ok(), "{label}: {opened:?}");
        set_title(&a, &node, "New").unwrap();
        a.save(node.clone()).unwrap();
        let after = std::fs::read_to_string(aod(&root)).unwrap();
        assert_eq!(after, text.replace("<title>Old</title>", "<title>New</title>"), "{label}: only the title may change");
    }
}

#[test]
fn a_read_only_file_is_refused_with_an_actionable_message_and_stays_untouched() {
    let root = project("readonly");
    std::fs::write(aod(&root), GOOD).unwrap();
    let a = ProjectActorHandle::spawn();
    let node = id(&aod(&root));
    set_title(&a, &node, "New").unwrap();
    let mut perms = std::fs::metadata(aod(&root)).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(aod(&root), perms).unwrap();

    let err = a.save(node.clone()).unwrap_err();
    assert!(err.contains("read-only") || err.contains("locked"), "{err}");
    assert_eq!(std::fs::read_to_string(aod(&root)).unwrap(), GOOD);

    let mut perms = std::fs::metadata(aod(&root)).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    std::fs::set_permissions(aod(&root), perms).unwrap();
    a.save(node).unwrap();
}

#[test]
fn a_file_changed_by_git_meanwhile_is_reported_and_never_overwritten_silently() {
    let root = project("conflict");
    std::fs::write(aod(&root), GOOD).unwrap();
    let a = ProjectActorHandle::spawn();
    let node = id(&aod(&root));
    set_title(&a, &node, "Mine").unwrap();
    assert!(a.external_changes(vec![node.clone()]).unwrap().is_empty());

    let external = GOOD.replace("<title>Old</title>", "<title>From Git, longer</title>");
    std::fs::write(aod(&root), &external).unwrap();
    assert_eq!(a.external_changes(vec![node.clone()]).unwrap(), vec![node.clone()]);

    let err = a.save(node.clone()).unwrap_err();
    assert!(err.starts_with("CONFLICT:"), "{err}");
    assert_eq!(std::fs::read_to_string(aod(&root)).unwrap(), external, "nothing may be written on a conflict");

    a.save_overwrite(node.clone()).unwrap();
    assert!(std::fs::read_to_string(aod(&root)).unwrap().contains("<title>Mine</title>"));
    assert!(a.external_changes(vec![node.clone()]).unwrap().is_empty(), "after the save the file is in sync again");

    a.reload(node.clone()).unwrap();
    let reread = a.get_property_tree(node).unwrap();
    assert!(format!("{reread:?}").contains("Mine"));
}

#[test]
fn a_deleted_file_counts_as_an_external_change() {
    let root = project("deleted");
    std::fs::write(aod(&root), GOOD).unwrap();
    let a = ProjectActorHandle::spawn();
    let node = id(&aod(&root));
    a.get_property_tree(node.clone()).unwrap();
    std::fs::remove_file(aod(&root)).unwrap();
    assert_eq!(a.external_changes(vec![node]).unwrap().len(), 1);
}

#[test]
fn real_objects_cut_in_half_do_not_crash_the_reader() {
    let corpus = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../_scratch/hardening/Car_Training/clemens-onboarding-main");
    if !corpus.is_dir() {
        return;
    }
    let mut files = Vec::new();
    let mut stack = vec![corpus.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            let n = e.file_name().to_string_lossy().into_owned();
            if p.is_dir() {
                if n != "dist" && n != "node_modules" && n != ".git" {
                    stack.push(p);
                }
            } else if n.ends_with(".aod") {
                files.push(p);
            }
        }
    }
    let root = project("real-cut");
    let a = ProjectActorHandle::spawn();
    let (mut tested, mut opened) = (0, 0);
    for f in &files {
        let Ok(bytes) = std::fs::read(f) else { continue };
        for cut in [0, 1, bytes.len() / 3, bytes.len() / 2, bytes.len() - 1] {
            std::fs::write(aod(&root), &bytes[..cut]).unwrap();
            let node = id(&aod(&root));
            a.reload(node.clone()).unwrap();
            tested += 1;
            if a.get_property_tree(node.clone()).is_ok() {
                opened += 1;
                let _ = a.navigator(node.clone());
                let _ = a.property_sheet(node, "$".into(), None);
            }
        }
    }
    eprintln!("cut-in-half: {tested} damaged variants, {opened} still opened, rest rejected with an error");
    assert!(tested > 50);
}
