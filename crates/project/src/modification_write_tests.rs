use super::*;
use differential_harness::own_engine::merge_modifications_into_bytes;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

const BASE: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity xmlns=\"http://www.adito.de/2018/ao/Model\" VERSION=\"1.2.0\">\r\n  <name>Foo_entity</name>\r\n  <title>Old</title>\r\n  <entityFields>\r\n    <entityField>\r\n      <name>A</name>\r\n      <mandatory v=\"false\" />\r\n    </entityField>\r\n  </entityFields>\r\n</entity>";

struct Fixture {
    root: PathBuf,
    module_file: PathBuf,
    obj: ObjectRef,
}

fn fixture() -> Fixture {
    let root = std::env::temp_dir().join(format!("forge-modwrite-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
    let module_file = root.join("node_modules/@x/mod/entity/Foo_entity/Foo_entity.aod");
    fs::create_dir_all(module_file.parent().unwrap()).unwrap();
    fs::write(&module_file, BASE).unwrap();
    let obj = ObjectRef { project_root: root.clone(), model_type: "entity".into(), model_name: "Foo_entity".into() };
    Fixture { root, module_file, obj }
}

fn merged(f: &Fixture) -> String {
    let dir = f.root.join("modification");
    let mut files = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            files.push((dir.join(&name).join(format!("{name}.aod")), true));
        }
    }
    String::from_utf8(merge_modifications_into_bytes(&fs::read(&f.module_file).unwrap(), &files).unwrap()).unwrap()
}

fn p(s: &[&str]) -> Vec<String> {
    s.iter().map(|x| x.to_string()).collect()
}

#[test]
fn modify_text_roundtrips_to_the_expected_object_and_leaves_the_module_untouched() {
    let f = fixture();
    let out = modify(&f.obj, &p(&["title"]), ModValue::Text("New & <x>".into()), Some("Old")).unwrap();
    assert_eq!(out.action, Action::Created);
    assert_eq!(merged(&f), BASE.replace("<title>Old</title>", "<title>New &amp; &lt;x&gt;</title>"));
    assert_eq!(fs::read_to_string(&f.module_file).unwrap(), BASE);
    assert_eq!(fs::read_dir(f.root.join("modification")).unwrap().count(), 1, "one modification, never a copy of the object");
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn modify_typed_boolean_replaces_only_the_v_attribute() {
    let f = fixture();
    modify(&f.obj, &p(&["entityFields", "A", "mandatory"]), ModValue::Bool(true), Some("false")).unwrap();
    assert_eq!(merged(&f), BASE.replace("<mandatory v=\"false\" />", "<mandatory v=\"true\" />"));
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn modify_of_an_unset_property_appends_it() {
    let f = fixture();
    modify(&f.obj, &p(&["entityFields", "A", "state"]), ModValue::Text("READONLY".into()), None).unwrap();
    let m = merged(&f);
    assert!(m.contains("<state>READONLY</state>"), "{m}");
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn second_edit_patches_value_bytes_only_and_keeps_position() {
    let f = fixture();
    let first = modify(&f.obj, &p(&["title"]), ModValue::Text("One".into()), Some("Old")).unwrap();
    let dir = first.dir.clone().unwrap();
    let file = mod_file(&f.root, &dir);
    let before = fs::read_to_string(&file).unwrap();
    let second = modify(&f.obj, &p(&["title"]), ModValue::Text("Two".into()), Some("Old")).unwrap();
    assert_eq!(second.action, Action::Updated);
    assert_eq!(second.dir, first.dir);
    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, before.replace("<value>One</value>", "<value>Two</value>"));
    assert!(!after.replace("\r\n", "").contains('\n'), "line endings stay CRLF");
    assert_eq!(fs::read_dir(f.root.join("modification")).unwrap().count(), 1);
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn same_value_twice_does_not_rewrite_the_file() {
    let f = fixture();
    let first = modify(&f.obj, &p(&["title"]), ModValue::Text("One".into()), Some("Old")).unwrap();
    let again = modify(&f.obj, &p(&["title"]), ModValue::Text("One".into()), Some("Old")).unwrap();
    assert_eq!(first.dir, again.dir);
    assert_eq!(again.action, Action::Unchanged);
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn change_back_to_original_suggests_removal_and_deletes_nothing() {
    let f = fixture();
    let first = modify(&f.obj, &p(&["title"]), ModValue::Text("One".into()), Some("Old")).unwrap();
    let back = modify(&f.obj, &p(&["title"]), ModValue::Text("Old".into()), Some("Old")).unwrap();
    assert_eq!(back.action, Action::RemovalSuggested);
    assert!(mod_file(&f.root, first.dir.as_deref().unwrap()).is_file(), "nothing is deleted without confirmation");
    discard(&f.root, back.dir.as_deref().unwrap()).unwrap();
    assert!(!f.root.join("modification").join(first.dir.unwrap()).exists());
    let none = modify(&f.obj, &p(&["title"]), ModValue::Text("Old".into()), Some("Old")).unwrap();
    assert_eq!(none.action, Action::Unchanged);
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn insert_then_delete_of_the_inserted_element_cancel_out() {
    let f = fixture();
    let xml = "<entityField>\n  <name>B</name>\n  <mandatory v=\"true\" />\n</entityField>";
    let out = insert(&f.obj, &p(&["entityFields"]), "B", xml).unwrap();
    assert_eq!(out.action, Action::Created);
    let m = merged(&f);
    assert!(m.contains("    <entityField>\r\n      <name>B</name>\r\n      <mandatory v=\"true\" />\r\n    </entityField>\r\n  </entityFields>"), "{m}");
    let again = insert(&f.obj, &p(&["entityFields"]), "B", xml).unwrap();
    assert_eq!(again.action, Action::Unchanged);
    let del = delete(&f.obj, &p(&["entityFields", "B"])).unwrap();
    assert_eq!(del.action, Action::RemovalSuggested);
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn delete_of_a_module_element_writes_a_delete_modification() {
    let f = fixture();
    let out = delete(&f.obj, &p(&["entityFields", "A"])).unwrap();
    assert_eq!(out.action, Action::Created);
    let m = merged(&f);
    assert!(!m.contains("<name>A</name>"), "{m}");
    assert_eq!(delete(&f.obj, &p(&["entityFields", "A"])).unwrap().action, Action::Unchanged);
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn script_modification_writes_the_js_next_to_the_envelope_and_updates_only_the_js() {
    let f = fixture();
    let v = |c: &str| ModValue::Script { file_name: "onValidation.js".into(), content: c.into() };
    let out = modify(&f.obj, &p(&["entityFields", "A", "onValidation"]), v("a();"), Some("orig();")).unwrap();
    let dir = out.dir.unwrap();
    let env = fs::read_to_string(mod_file(&f.root, &dir)).unwrap();
    assert!(env.contains(&format!("<value>%aditoprj%/modification/{dir}/onValidation.js</value>")));
    let js = f.root.join("modification").join(&dir).join("onValidation.js");
    assert_eq!(fs::read_to_string(&js).unwrap(), "a();");
    modify(&f.obj, &p(&["entityFields", "A", "onValidation"]), v("b();"), Some("orig();")).unwrap();
    assert_eq!(fs::read_to_string(mod_file(&f.root, &dir)).unwrap(), env);
    assert_eq!(fs::read_to_string(&js).unwrap(), "b();");
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn diff_is_minimal_for_a_project_that_already_has_other_modifications() {
    let f = fixture();
    modify(&f.obj, &p(&["title"]), ModValue::Text("One".into()), Some("Old")).unwrap();
    let snapshot = |root: &Path| {
        let mut v = Vec::new();
        for e in fs::read_dir(root.join("modification")).unwrap().flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            v.push((n.clone(), fs::read(mod_file(root, &n)).unwrap()));
        }
        v.sort();
        v
    };
    let before = snapshot(&f.root);
    modify(&f.obj, &p(&["entityFields", "A", "mandatory"]), ModValue::Bool(true), Some("false")).unwrap();
    let after = snapshot(&f.root);
    assert_eq!(after.len(), before.len() + 1);
    for b in &before {
        assert!(after.contains(b), "an unrelated modification file changed");
    }
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn module_objects_are_refused_as_modification_target() {
    let f = fixture();
    let bad = ObjectRef { project_root: f.root.join("node_modules/@x/mod"), ..f.obj.clone() };
    assert!(modify(&bad, &p(&["title"]), ModValue::Text("x".into()), Some("Old")).is_err());
    fs::remove_dir_all(&f.root).ok();
}

#[test]
fn modification_path_addresses_list_items_by_name() {
    let item = CoreValue::Object(vec![("name".to_string(), CoreValue::Scalar(ScalarValue::Text("A".into())))].into_iter().collect());
    let container = CoreValue::Object(vec![("entityField".to_string(), CoreValue::Array(vec![item]))].into_iter().collect());
    let root = CoreValue::Object(vec![("entityFields".to_string(), container)].into_iter().collect());
    let path = NodePath::root().field("entityFields").field("entityField").index(0);
    assert_eq!(modification_path(&root, &path, "mandatory").unwrap(), vec!["entityFields", "A", "mandatory"]);
}

/// Real Designer output of the Car_Training corpus must be reproduced byte for byte (skipped when the corpus is absent).
#[test]
fn envelope_matches_real_designer_files_byte_for_byte() {
    let base = Path::new("C:/Users/ClemensBeile/Desktop/GitRepos_ADITO/Car_Training/clemens-onboarding-main/modification");
    let modify_dir = "Person_enti-onValidatio-7c39dc70-51";
    let insert_dir = "autostartNe-implementat-c45a6051-54";
    let (Ok(real_modify), Ok(real_insert)) = (fs::read(base.join(modify_dir).join(format!("{modify_dir}.aod"))), fs::read(base.join(insert_dir).join(format!("{insert_dir}.aod")))) else { return };
    let obj = ObjectRef { project_root: PathBuf::new(), model_type: "entity".into(), model_name: "Person_entity".into() };
    let value = value_xml(&ModValue::Script { file_name: "onValidation.js".into(), content: String::new() }, &format!("%aditoprj%/modification/{modify_dir}/onValidation.js"));
    let mine = with_eol(&envelope(Change::Modify, modify_dir, 1786083427, &obj, "Person_entity/entityFields/Attributes/onValidation", Some(&value)), "\r\n");
    assert_eq!(String::from_utf8_lossy(&mine), String::from_utf8_lossy(&real_modify));

    let obj = ObjectRef { project_root: PathBuf::new(), model_type: "serviceDefinition".into(), model_name: "autostartNeon_service".into() };
    let xml = format!("<serviceImplementation>\n  <name>carpool_impl</name>\n  <process>%aditoprj%/modification/{insert_dir}/process.js</process>\n</serviceImplementation>");
    let mine = with_eol(&envelope(Change::Insert, insert_dir, 1786973153, &obj, "autostartNeon_service/implementations", Some(&insert_value_xml(&xml))), "\r\n");
    assert_eq!(String::from_utf8_lossy(&mine), String::from_utf8_lossy(&real_insert));
}
