//! Round-trip tests of the property sheet write paths (P8 step 3): every edit must change the
//! file in exactly the edited place and undo must restore the original bytes.

use crate::project_actor::ProjectActorHandle;
use crate::wire::WireValue;
use std::path::{Path, PathBuf};

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn fixture_copy(folder: &str, name: &str, under_node_modules: bool) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/DemoProject")
        .join(folder)
        .join(name)
        .join(format!("{name}.aod"));
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut dir = std::env::temp_dir().join(format!("forge-sheet-test-{}-{unique}", std::process::id()));
    if under_node_modules {
        dir = dir.join("node_modules").join("@scope").join("module");
    }
    let dir = dir.join(folder).join(name);
    std::fs::create_dir_all(&dir).unwrap();
    let dest = dir.join(format!("{name}.aod"));
    std::fs::copy(&src, &dest).unwrap();
    dest
}

fn entity() -> (PathBuf, String, Vec<u8>) {
    let path = fixture_copy("entity", "THHIT_BusinessStrategyMetrics_entity", false);
    let original = std::fs::read(&path).unwrap();
    let id = path.to_string_lossy().into_owned();
    (path, id, original)
}

#[test]
fn changing_a_typed_attribute_changes_only_its_value() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    actor
        .set_sheet_property(id.clone(), "entityFields.entityField[2]".into(), "maxIntegerDigits".into(), WireValue::Int { value: 12 }, true)
        .unwrap();
    actor.save(id).unwrap();
    let text = String::from_utf8(original).unwrap();
    let field = text.find("<name>TARGET_LEVEL_VALUE</name>").unwrap();
    let at = field + text[field..].find("<maxIntegerDigits v=\"10\" />").unwrap();
    let expected = format!("{}<maxIntegerDigits v=\"12\" />{}", &text[..at], &text[at + "<maxIntegerDigits v=\"10\" />".len()..]).into_bytes();
    assert_eq!(std::fs::read(&path).unwrap(), expected);
}

#[test]
fn setting_a_missing_property_inserts_one_element_with_sibling_indentation() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let outcome = actor
        .set_sheet_property(id.clone(), "entityFields.entityField[1]".into(), "title".into(), WireValue::Text { value: "Org & Co".into() }, false)
        .unwrap();
    assert!(outcome.can_undo);
    actor.save(id.clone()).unwrap();

    let text = String::from_utf8(original.clone()).unwrap();
    let anchor = "<name>ORG_ID</name>";
    let at = text.find(anchor).unwrap();
    let indent = &text[text[..at].rfind('>').unwrap() + 1..at];
    let expected = format!("{}{indent}<title>Org &amp; Co</title>{}", &text[..at + anchor.len()], &text[at + anchor.len()..]);
    assert_eq!(String::from_utf8(std::fs::read(&path).unwrap()).unwrap(), expected);

    let sheet = actor.property_sheet(id, "entityFields.entityField[1]".into(), None).unwrap();
    let title = sheet.groups.iter().flat_map(|g| &g.rows).find(|r| r.name == "title").unwrap();
    assert!(title.set);
    assert_eq!(title.display, "Org & Co");
}

#[test]
fn undo_and_redo_of_an_insert_restore_exact_bytes() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    actor
        .set_sheet_property(id.clone(), "$".into(), "useFavorites".into(), WireValue::Bool { value: true }, true)
        .unwrap();
    actor.save(id.clone()).unwrap();
    let edited = std::fs::read(&path).unwrap();
    let edited_text = String::from_utf8(edited.clone()).unwrap();
    assert_eq!(edited_text.matches("<useFavorites v=\"true\" />").count(), 1);
    // Only one line was added, directly before the closing root tag's line.
    assert!(edited_text.trim_end().ends_with("<useFavorites v=\"true\" />\r\n</entity>") || edited_text.trim_end().ends_with("<useFavorites v=\"true\" />\n</entity>"));

    let undone = actor.undo(id.clone()).unwrap();
    assert!(!undone.can_undo && undone.can_redo);
    actor.save(id.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);

    actor.redo(id.clone()).unwrap();
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), edited);
}

#[test]
fn mixed_scalar_and_structural_edits_undo_in_order() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    actor
        .set_sheet_property(id.clone(), "entityFields.entityField[0]".into(), "title".into(), WireValue::Text { value: "Changed".into() }, false)
        .unwrap();
    actor
        .set_sheet_property(id.clone(), "entityFields.entityField[0]".into(), "mandatory".into(), WireValue::Bool { value: true }, true)
        .unwrap();
    actor.undo(id.clone()).unwrap();
    actor.undo(id.clone()).unwrap();
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn module_objects_are_read_only_in_the_sheet_and_refuse_writes() {
    let path = fixture_copy("entity", "THHIT_BusinessStrategyMetrics_entity", true);
    let original = std::fs::read(&path).unwrap();
    let id = path.to_string_lossy().into_owned();
    let actor = ProjectActorHandle::spawn();
    let sheet = actor.property_sheet(id.clone(), "$".into(), None).unwrap();
    assert!(sheet.read_only.is_some());
    assert!(sheet.groups.iter().flat_map(|g| &g.rows).all(|r| !r.editable));
    let err = actor
        .set_sheet_property(id, "$".into(), "title".into(), WireValue::Text { value: "x".into() }, false)
        .unwrap_err();
    assert!(err.contains("read-only"));
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn navigator_of_a_real_entity_fixture() {
    let (_, id, _) = entity();
    let actor = ProjectActorHandle::spawn();
    let nav = actor.navigator(id).unwrap();
    assert_eq!(nav[0].label, "THHIT_BusinessStrategyMetrics_entity");
    let fields = &nav[0].children[1];
    assert_eq!(fields.label, "Fields");
    let names: Vec<&str> = fields.children.iter().map(|n| n.label.as_str()).collect();
    let mut sorted = names.clone();
    sorted.sort_by_key(|n| crate::catalog::sheet::nav_sort_key(n));
    assert_eq!(names, sorted);
    assert!(names.contains(&"ORG_ID"));
    let providers: Vec<&str> = nav[0].children[3].children.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(providers, vec!["#PROVIDER", "#PROVIDER_AGGREGATES", "BusinessStrategyProvider"]);
}

#[test]
fn source_shows_the_raw_file_and_unsaved_edits() {
    let (_, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let source = actor.get_source(id.clone()).unwrap();
    assert_eq!(source.text.as_bytes(), original.as_slice());
    assert!(!source.read_only);

    actor.set_property(id.clone(), "name".into(), WireValue::Text { value: "Shown_entity".into() }).unwrap();
    assert!(actor.get_source(id).unwrap().text.contains("<name>Shown_entity</name>"));
}

#[test]
fn source_edit_is_saved_byte_for_byte_and_undone_to_the_original() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let text = String::from_utf8(original.clone()).unwrap();
    let edited = text.replacen("</entity>", "  <description>Added in Source</description>\n</entity>", 1);
    assert_ne!(edited, text);

    let outcome = actor.set_source(id.clone(), edited.clone()).unwrap();
    assert!(outcome.can_undo);
    actor.save(id.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), edited.as_bytes());

    let undone = actor.undo(id.clone()).unwrap();
    assert!(undone.can_redo);
    actor.save(id.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn source_that_is_not_well_formed_is_rejected_and_changes_nothing() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let err = actor.set_source(id.clone(), "<entity><name>broken</entity>".into()).unwrap_err();
    assert!(err.contains("source rejected"), "{err}");
    assert_eq!(actor.get_source(id.clone()).unwrap().text.as_bytes(), original.as_slice());
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn unchanged_source_records_no_undo_step() {
    let (_, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let outcome = actor.set_source(id, String::from_utf8(original).unwrap()).unwrap();
    assert!(!outcome.can_undo);
}

#[test]
fn source_of_a_module_object_is_readable_but_never_writable() {
    let path = fixture_copy("entity", "THHIT_BusinessStrategyMetrics_entity", true);
    let original = std::fs::read(&path).unwrap();
    let id = path.to_string_lossy().into_owned();
    let actor = ProjectActorHandle::spawn();
    let source = actor.get_source(id.clone()).unwrap();
    assert!(source.read_only);
    let err = actor.set_source(id, source.text.replace("</entity>", " </entity>")).unwrap_err();
    assert!(err.contains("read-only"), "{err}");
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

fn project_root_of(module_object: &Path) -> PathBuf {
    module_object.ancestors().find(|a| a.join("node_modules").is_dir()).unwrap().to_path_buf()
}

#[test]
fn module_object_edit_becomes_a_minimal_modification_and_merges_to_the_expected_object() {
    use crate::modification_write::Action;
    let path = fixture_copy("entity", "THHIT_BusinessStrategyMetrics_entity", true);
    let original = std::fs::read(&path).unwrap();
    let id = path.to_string_lossy().into_owned();
    let root = project_root_of(&path);
    let actor = ProjectActorHandle::spawn();

    assert!(actor.set_modification_property(id.clone(), "entityFields.entityField[2]".into(), "maxIntegerDigits".into(), WireValue::Int { value: 12 }, true, "int".into()).is_err(), "needs Create Modification first");
    actor.enable_modification(id.clone(), root.clone()).unwrap();
    let out = actor
        .set_modification_property(id.clone(), "entityFields.entityField[2]".into(), "maxIntegerDigits".into(), WireValue::Int { value: 12 }, true, "int".into())
        .unwrap();
    assert_eq!(out.action, Action::Created);
    assert_eq!(std::fs::read(&path).unwrap(), original, "module object stays untouched");
    assert!(actor.save(id.clone()).is_err(), "module objects are never saved");

    let dir = out.dir.clone().unwrap();
    let mod_file = root.join("modification").join(&dir).join(format!("{dir}.aod"));
    let text = std::fs::read_to_string(&mod_file).unwrap();
    assert!(text.contains("<path>THHIT_BusinessStrategyMetrics_entity/entityFields/TARGET_LEVEL_VALUE/maxIntegerDigits</path>"), "{text}");
    assert!(text.contains("<intValueWrapper>") && text.contains("<value v=\"12\" />"));
    assert_eq!(std::fs::read_dir(root.join("modification")).unwrap().count(), 1);

    let merged = native_transpiler::own_engine::merge_modifications_into_bytes(&original, &[(mod_file, true)]).unwrap();
    let base = String::from_utf8(original.clone()).unwrap();
    let field = base.find("<name>TARGET_LEVEL_VALUE</name>").unwrap();
    let at = field + base[field..].find("<maxIntegerDigits v=\"10\" />").unwrap();
    let expected = format!("{}<maxIntegerDigits v=\"12\" />{}", &base[..at], &base[at + "<maxIntegerDigits v=\"10\" />".len()..]);
    assert_eq!(String::from_utf8(merged).unwrap(), expected);

    let back = actor
        .set_modification_property(id.clone(), "entityFields.entityField[2]".into(), "maxIntegerDigits".into(), WireValue::Int { value: 10 }, true, "int".into())
        .unwrap();
    assert_eq!(back.action, Action::RemovalSuggested);
    actor.discard_modification(root.clone(), back.dir.unwrap()).unwrap();
    assert_eq!(std::fs::read_dir(root.join("modification")).unwrap().count(), 0);

    assert!(actor.set_modification_property(id.clone(), "entityFields.entityField[2]".into(), "state".into(), WireValue::Text { value: "READONLY".into() }, false, "enum".into()).is_err());
}

#[test]
fn clearing_a_set_property_removes_exactly_its_line_and_undo_restores_the_bytes() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    actor
        .set_sheet_property(id.clone(), "entityFields.entityField[1]".into(), "title".into(), WireValue::Text { value: "Temp".into() }, false)
        .unwrap();
    actor.remove_sheet_property(id.clone(), "entityFields.entityField[1]".into(), "title".into()).unwrap();
    actor.save(id.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original, "set + remove must leave the file untouched");

    actor.remove_sheet_property(id.clone(), "entityFields.entityField[1]".into(), "name".into()).unwrap();
    actor.undo(id.clone()).unwrap();
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn removing_an_unset_property_is_refused() {
    let (_, id, _) = entity();
    let actor = ProjectActorHandle::spawn();
    assert!(actor.remove_sheet_property(id, "entityFields.entityField[1]".into(), "doesNotExist".into()).is_err());
}

#[test]
fn new_linked_file_reference_follows_the_designer_layout() {
    let path = fixture_copy("entity", "THHIT_Committee_entity", false);
    let id = path.to_string_lossy().into_owned();
    let actor = ProjectActorHandle::spawn();
    let root = actor.get_property_tree(id).unwrap();
    let parse = |p: &str| crate::wire::parse_node_path(p).unwrap();
    assert_eq!(
        crate::project_actor::linked_new_reference(&path, &root, &parse("entityFields.entityConsumer[0]"), "stateProcess").unwrap(),
        "%aditoprj%/entity/THHIT_Committee_entity/entityfields/committeemembers/stateProcess.js"
    );
    assert_eq!(
        crate::project_actor::linked_new_reference(&path, &root, &parse("entityFields.entityConsumer[0].children.entityParameter[0]"), "valueProcess").unwrap(),
        "%aditoprj%/entity/THHIT_Committee_entity/entityfields/committeemembers/children/committeeid_param/valueProcess.js"
    );
    assert_eq!(
        crate::project_actor::linked_new_reference(&path, &root, &parse("$"), "onInit").unwrap(),
        "%aditoprj%/entity/THHIT_Committee_entity/onInit.js"
    );
}

fn first_unmapped(nodes: &[crate::catalog::sheet::NavNode]) -> Option<(String, String)> {
    for n in nodes {
        if n.dimmed {
            if let Some(p) = &n.path {
                return Some((p.clone(), n.label.clone()));
            }
        }
        if let Some(found) = first_unmapped(&n.children) {
            return Some(found);
        }
    }
    None
}

#[test]
fn grey_navigator_entries_are_selectable_and_show_default_properties() {
    let (_, id, _) = entity();
    let actor = ProjectActorHandle::spawn();
    let nav = actor.navigator(id.clone()).unwrap();
    let (path, label) = first_unmapped(&nav).expect("the fixture has bindings without a mapping");
    assert!(path.contains("#new:"), "{path}");
    let sheet = actor.property_sheet(id, path.clone(), None).unwrap();
    assert_eq!(sheet.path, path);
    assert_eq!(sheet.name, label);
}

#[test]
fn first_edit_of_a_grey_entry_creates_the_mapping_and_undo_restores_the_bytes() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let nav = actor.navigator(id.clone()).unwrap();
    let (vpath, label) = first_unmapped(&nav).unwrap();
    let outcome = actor.set_sheet_property(id.clone(), vpath, "isnull".into(), WireValue::Bool { value: true }, true).unwrap();
    assert!(outcome.can_undo);
    actor.save(id.clone()).unwrap();
    let text = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
    assert!(text.contains(&format!("<name>{label}</name>")));
    assert_eq!(text.matches("<isnull v=\"true\" />").count(), 1);
    assert!(first_unmapped(&actor.navigator(id.clone()).unwrap()).map(|(_, l)| l != label).unwrap_or(true));

    let undone = actor.undo(id.clone()).unwrap();
    assert!(!undone.can_undo, "creating the mapping and setting the property is one undo step");
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn set_to_default_removes_a_property_and_an_element_with_undo() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    actor.set_sheet_property(id.clone(), "entityFields.entityField[1]".into(), "title".into(), WireValue::Text { value: "T".into() }, false).unwrap();
    let after_set = actor.reset_property(id.clone(), "entityFields.entityField[1]".into(), "title".into()).unwrap();
    assert!(after_set.modification.is_none());
    actor.save(id.clone()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);

    let nav = actor.navigator(id.clone()).unwrap();
    let mapped = nav[0].children[0].children[0].children.iter().find(|n| !n.dimmed).expect("a mapped binding");
    let element = mapped.path.clone().unwrap();
    let label = mapped.label.clone();
    actor.reset_element(id.clone(), element).unwrap();
    actor.save(id.clone()).unwrap();
    let text = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
    assert!(text.len() < original.len());
    assert!(!text.contains(&format!("<name>{label}</name>")) || String::from_utf8(original.clone()).unwrap().matches(&format!("<name>{label}</name>")).count() > text.matches(&format!("<name>{label}</name>")).count());
    actor.undo(id.clone()).unwrap();
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn set_to_default_of_a_module_property_deletes_only_the_projects_modification() {
    let module = fixture_copy("entity", "THHIT_BusinessStrategyMetrics_entity", true);
    let module_bytes = std::fs::read(&module).unwrap();
    let id = module.to_string_lossy().into_owned();
    let project = std::env::temp_dir().join(format!("forge-reset-project-{}", std::process::id()));
    std::fs::create_dir_all(&project).unwrap();
    let actor = ProjectActorHandle::spawn();
    actor.enable_modification(id.clone(), project.clone()).unwrap();
    let out = actor
        .set_modification_property(id.clone(), "entityFields.entityField[1]".into(), "title".into(), WireValue::Text { value: "Changed".into() }, false, "text".into())
        .unwrap();
    let dir = out.dir.clone().unwrap();
    assert!(project.join("modification").join(&dir).is_dir());
    let reset = actor.reset_property(id.clone(), "entityFields.entityField[1]".into(), "title".into()).unwrap();
    assert_eq!(reset.modification.unwrap().dir.as_deref(), Some(dir.as_str()));
    assert!(!project.join("modification").join(&dir).exists());
    assert_eq!(std::fs::read(&module).unwrap(), module_bytes);
    let err = actor.reset_property(id, "entityFields.entityField[1]".into(), "title".into()).unwrap_err();
    assert!(err.contains("comes from the module"), "{err}");
    std::fs::remove_dir_all(&project).ok();
}

#[test]
fn activating_a_grey_entry_creates_the_bare_mapping_and_undo_restores_the_bytes() {
    let (path, id, original) = entity();
    let actor = ProjectActorHandle::spawn();
    let nav = actor.navigator(id.clone()).unwrap();
    let (vpath, label) = first_unmapped(&nav).unwrap();
    let result = actor.activate_mapping(id.clone(), vpath).unwrap();
    assert!(result.tree.can_undo);
    assert!(!result.path.contains("#new:"), "{}", result.path);
    let sheet = actor.property_sheet(id.clone(), result.path.clone(), None).unwrap();
    assert_eq!(sheet.name, label);
    actor.save(id.clone()).unwrap();
    let text = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
    assert!(text.contains(&format!("<name>{label}</name>")));
    assert!(first_unmapped(&actor.navigator(id.clone()).unwrap()).map(|(_, l)| l != label).unwrap_or(true));
    let undone = actor.undo(id.clone()).unwrap();
    assert!(!undone.can_undo);
    actor.save(id).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn a_consumer_binding_is_activated_as_consumer_mapping() {
    use crate::catalog::sheet::NavNode;
    fn consumer(nodes: &[NavNode]) -> Option<String> {
        for n in nodes {
            if n.dimmed && n.icon == "consumer" {
                return n.path.clone();
            }
            if let Some(p) = consumer(&n.children) {
                return Some(p);
            }
        }
        None
    }
    let (_, id, _) = entity();
    let actor = ProjectActorHandle::spawn();
    let nav = actor.navigator(id.clone()).unwrap();
    let Some(vpath) = consumer(&nav) else { return };
    let result = actor.activate_mapping(id.clone(), vpath).unwrap();
    assert!(result.path.contains("consumerMapping"), "{}", result.path);
}

#[test]
fn a_view_reference_is_named_by_its_view() {
    use crate::catalog::sheet::reference_label;
    let element = WireValue::Object {
        fields: vec![
            crate::wire::WireField { key: "name".into(), value: WireValue::Text { value: "fe0ed7a3-24eb".into() } },
            crate::wire::WireField { key: "view".into(), value: WireValue::Text { value: "ActivityDetail_view".into() } },
        ],
    };
    assert_eq!(reference_label("neonViewReference", &element).as_deref(), Some("ActivityDetail_view"));
    assert_eq!(reference_label("neonTemplate", &element), None);
}
