use super::sheet::*;
use super::*;
use crate::wire::{WireField, WireValue};
use aod::tree::path::NodePath;
use std::sync::OnceLock;

const REAL_INSTALL: &str = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4";

/// The real catalog of the locally installed Designer (read only, never cached to disk here);
/// `None` skips the test on machines without that installation.
fn real() -> Option<&'static Catalog> {
    static CATALOG: OnceLock<Option<Catalog>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            let dir = Path::new(REAL_INSTALL);
            if !dir.exists() {
                eprintln!("skipped: Designer installation not found at {REAL_INSTALL}");
                return None;
            }
            Some(load_catalog(dir, None).expect("catalog must load from the real installation"))
        })
        .as_ref()
}

fn names(c: &Catalog, model: &str, tags: &[&str]) -> Vec<(String, String)> {
    let tags: Vec<String> = tags.iter().map(|s| s.to_string()).collect();
    c.type_at(model, &tags)
        .unwrap_or_else(|| panic!("no type for {model} {tags:?}"))
        .props
        .iter()
        .map(|p| (c.group_label(&p.group), p.name.clone()))
        .collect()
}

fn assert_starts(c: &Catalog, model: &str, tags: &[&str], expected: &[(&str, &str)]) {
    let got = names(c, model, tags);
    let got: Vec<(&str, &str)> = got.iter().map(|(g, n)| (g.as_str(), n.as_str())).collect();
    assert!(got.len() >= expected.len(), "{model} {tags:?}: {got:?}");
    assert_eq!(&got[..expected.len()], expected, "{model} {tags:?}");
}

/// Screenshot 30/36: Context groups and order.
#[test]
fn real_context_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "neonContext", &[], &[
        ("", "title"), ("", "devices"), ("", "description"), ("", "documentation"), ("", "comment"), ("", "icon"),
        ("", "iconProcess"), ("Entity", "entity"), ("Views", "viewmodeProvider"), ("Views", "mainView"),
        ("Views", "filterView"), ("Views", "editView"), ("Views", "previewView"), ("Views", "previewMultipleView"),
        ("Views", "lookupView"), ("Modularization", "applyAllModifications"),
    ]);
    let props = &c.type_at("neonContext", &[]).unwrap().props;
    assert_eq!(props.iter().find(|p| p.name == "mainView").unwrap().reference.as_deref(), Some("neonView"));
}

/// Screenshot 40: Entity - untitled group, Source, Processes.
#[test]
fn real_entity_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "entity", &[], &[
        ("", "title"), ("", "titlePlural"), ("", "description"), ("", "documentation"), ("", "comment"), ("", "icon"),
        ("", "iconProcess"), ("", "metadata"), ("", "siblings"), ("", "useFavorites"), ("", "recordsRecipeSupported"),
        ("Source", "recordContainer"), ("Processes", "onInit"), ("Processes", "afterUiInit"),
        ("Processes", "beforeOperatingState"), ("Processes", "afterOperatingState"), ("Processes", "onValidation"),
        ("Processes", "afterSave"), ("Processes", "initFilterProcess"), ("Processes", "contentTitleProcess"),
        ("Processes", "contentDescriptionProcess"),
    ]);
    let props = &c.type_at("entity", &[]).unwrap().props;
    assert_eq!(props.iter().find(|p| p.name == "useFavorites").unwrap().kind, PropKind::Bool);
    assert_eq!(props.iter().find(|p| p.name == "onInit").unwrap().kind, PropKind::Linked);
    assert_eq!(props.iter().find(|p| p.name == "siblings").unwrap().kind, PropKind::List);
}

/// Screenshot 44: entity field ACTIVITY_ID.
#[test]
fn real_entity_field_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "entity", &["entityFields", "entityField"], &[
        ("", "title"), ("", "titleProcess"), ("", "description"), ("", "documentation"),
        ("Database", "linkedContext"), ("Database", "linkedContextProcess"), ("Database", "consumer"),
        ("Tool tip", "tooltip"), ("Tool tip", "tooltipProcess"), ("Placeholder", "placeholder"),
        ("Placeholder", "placeholderProcess"), ("Processes", "valueProcess"),
    ]);
}

/// Screenshot 38/52: Process.
#[test]
fn real_process_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "process", &[], &[
        ("", "title"), ("", "description"), ("", "documentation"), ("", "comment"), ("", "icon"), ("", "iconProcess"),
        ("", "iconInactive"), ("", "variants"), ("", "process"), ("Database", "alias"),
        ("JDito Webservices - Server", "publishAsWebservice"), ("JDito Webservices - Server", "style"),
    ]);
    let groups: Vec<String> = names(c, "process", &[]).into_iter().map(|(g, _)| g).collect();
    let pos = |g: &str| groups.iter().position(|x| x == g).unwrap_or_else(|| panic!("group {g} missing"));
    assert!(pos("JDito Webservices - Server") < pos("JDito Webservices"));
    assert!(pos("JDito Webservices") < pos("Legacy Webservices"));
}

/// Screenshot 37: System.
#[test]
fn real_system_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "system", &[], &[
        ("", "title"), ("", "description"), ("", "documentation"), ("", "comment"), ("", "icon"), ("", "iconProcess"),
        ("", "serverConfigPath"), ("", "tunnelConfigPath"), ("", "productiveSystem"), ("", "cloudSystemId"),
        ("", "signerLicense"), ("Run", "aditoHomePath"), ("Run", "aditoDataPath"), ("Run", "javaHomePath"),
        ("Run", "loginUser"), ("Run", "loginPassword"), ("Run", "autoLogin"), ("Run Server", "javaVMParametersServer"),
        ("Run Server", "aditoDebug"), ("Run Server", "enableJDitoDebug"), ("Run Client", "javaVMParametersClient"),
    ]);
}

/// Screenshot 43/46: View.
#[test]
fn real_view_matches_designer() {
    let Some(c) = real() else { return };
    assert_starts(c, "neonView", &[], &[
        ("", "title"), ("", "description"), ("", "documentation"), ("", "comment"), ("", "icon"), ("", "iconProcess"),
        ("", "quickEntry"), ("", "filterable"), ("", "size"), ("", "isOverlay"),
    ]);
    let groups: Vec<String> = names(c, "neonView", &[]).into_iter().map(|(g, _)| g).collect();
    assert!(groups.contains(&"Others".to_string()) && groups.contains(&"Modularization".to_string()));
}

/// Screenshot 25: the description below the grid comes from the annotation.
#[test]
fn real_description_of_linked_columns() {
    let Some(c) = real() else { return };
    let found = c.types.values().flat_map(|t| t.props.iter()).find(|p| p.name == "linkedColumns");
    assert_eq!(
        found.and_then(|p| p.description.as_deref()),
        Some("Defines the columns which shall be displayed as a native link.")
    );
}

#[test]
fn catalog_is_cached_per_installation() {
    if !Path::new(REAL_INSTALL).exists() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("forge-catalog-cache-{}", std::process::id()));
    let first = load_catalog(Path::new(REAL_INSTALL), Some(&dir)).unwrap();
    let files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().collect();
    assert_eq!(files.len(), 1);
    let second = load_catalog(Path::new(REAL_INSTALL), Some(&dir)).unwrap();
    assert_eq!(first.stamp, second.stamp);
    assert_eq!(first.types.len(), second.types.len());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn missing_installation_is_an_error_not_a_panic() {
    assert!(load_catalog(Path::new(r"C:\does\not\exist\designer"), None).is_err());
}

#[test]
fn properties_parser_handles_escapes_and_continuations() {
    let p = parse_properties("# c\nlegacy.a=Renderer Mapping\nb = x\\u00e4y\nc=one \\\n  two\n");
    assert_eq!(p["legacy.a"], "Renderer Mapping");
    assert_eq!(p["b"], "x\u{e4}y");
    assert_eq!(p["c"], "one two");
}

// --- sheet + navigator against a hand-built catalog -------------------------------------------

fn def(name: &str, group: &str, position: i32, kind: PropKind) -> PropDef {
    PropDef { name: name.into(), group: group.into(), position, kind, enum_values: vec![], reference: None, description: None, persisted: true }
}

fn fixture_catalog() -> Catalog {
    let mut c = Catalog::default();
    c.roots.insert("entity".into(), "entityType".into());
    c.groups = vec![
        GroupDef { key: "GENERAL".into(), label: String::new() },
        GroupDef { key: "DATABASE".into(), label: "Database".into() },
        GroupDef { key: "PROCESSES".into(), label: "Processes".into() },
    ];
    let mut title = def("title", "GENERAL", 10, PropKind::Text);
    title.description = Some("Singular title".into());
    let mut state = def("state", "DATABASE", 5, PropKind::Enum);
    state.enum_values = vec!["AUTO".into(), "READONLY".into()];
    c.types.insert("entityType".into(), TypeEntry {
        elements: vec![("title".into(), "stringType".into()), ("entityFields".into(), "FieldsListType".into())],
        is_list: false,
        props: vec![title.clone(), def("useFavorites", "GENERAL", 30, PropKind::Bool)],
        has_metadata: true,
    });
    c.types.insert("FieldsListType".into(), TypeEntry {
        elements: vec![("entityField".into(), "entityFieldType".into())],
        is_list: true,
        ..TypeEntry::default()
    });
    c.types.insert("entityFieldType".into(), TypeEntry {
        elements: vec![],
        is_list: false,
        props: vec![title, state, def("valueProcess", "PROCESSES", 100, PropKind::Linked), def("mandatory", "DATABASE", 10, PropKind::Bool)],
        has_metadata: true,
    });
    c
}

fn text(v: &str) -> WireValue {
    WireValue::Text { value: v.into() }
}

fn obj(fields: Vec<(&str, WireValue)>) -> WireValue {
    WireValue::Object { fields: fields.into_iter().map(|(k, v)| WireField { key: k.into(), value: v }).collect() }
}

fn entity_value() -> WireValue {
    obj(vec![
        ("name", text("Car_entity")),
        ("title", text("Car")),
        ("entityFields", obj(vec![
            ("entityProvider", obj(vec![("name", text("#PROVIDER"))])),
            ("entityField", WireValue::Array { items: vec![
                obj(vec![
                    ("name", text("OBJECT_TYPE")),
                    ("valueProcess", text("%aditoprj%/entity/Car_entity/entityfields/object_type/valueProcess.js")),
                    ("mandatory", WireValue::Bool { value: false }),
                ]),
                obj(vec![("name", text("ACTIVITY_ID"))]),
            ] }),
            ("entityConsumer", obj(vec![("name", text("Objects"))])),
        ])),
        ("recordContainers", obj(vec![("dbRecordContainer", obj(vec![
            ("name", text("db")),
            ("recordFieldMappings", obj(vec![("dbRecordFieldMapping", obj(vec![("name", text("ACTIVITY_ID.value"))]))])),
        ]))])),
        ("customThing", text("x")),
    ])
}

#[test]
fn sheet_groups_rows_and_unset_properties() {
    let c = fixture_catalog();
    let path = crate::wire::parse_node_path("entityFields.entityField[0]").unwrap();
    let sheet = resolve_sheet(Some(&c), "entity", &entity_value(), &path, None, &|r| {
        assert!(r.ends_with("valueProcess.js"));
        Some("import { result } from \"@aditosoftware/jditocore\";".into())
    })
    .unwrap();
    assert_eq!(sheet.name, "OBJECT_TYPE");
    assert_eq!(sheet.type_label, "entityField");
    let labels: Vec<&str> = sheet.groups.iter().map(|g| g.label.as_str()).collect();
    assert_eq!(labels, vec!["", "Database", "Processes"]);
    let first: Vec<&str> = sheet.groups[0].rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(first, vec!["name", "title", "type"]);
    let title = &sheet.groups[0].rows[1];
    assert!(!title.set && title.editable && title.description.as_deref() == Some("Singular title"));
    let db: Vec<&str> = sheet.groups[1].rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(db, vec!["state", "mandatory"]);
    let mandatory = &sheet.groups[1].rows[1];
    assert!(mandatory.set && mandatory.typed && mandatory.editable);
    assert_eq!(sheet.groups[1].rows[0].enum_values, vec!["AUTO", "READONLY"]);
    let process = &sheet.groups[2].rows[0];
    assert_eq!(process.kind, PropKind::Linked);
    assert!(process.display.starts_with("import { result }"));
}

#[test]
fn sheet_keeps_uncatalogued_values_and_honours_read_only() {
    let c = fixture_catalog();
    let sheet = resolve_sheet(Some(&c), "entity", &entity_value(), &NodePath::root(), Some(READ_ONLY_MODULE), &|_| None).unwrap();
    let general: Vec<&str> = sheet.groups[0].rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(general, vec!["title", "type", "useFavorites", "customThing"]);
    assert!(sheet.groups.iter().flat_map(|g| &g.rows).all(|r| !r.editable && r.reason.as_deref() == Some(READ_ONLY_MODULE)));
}

#[test]
fn sheet_without_catalog_lists_present_values_only() {
    let sheet = resolve_sheet(None, "entity", &entity_value(), &NodePath::root(), None, &|_| None).unwrap();
    assert!(sheet.catalog_missing);
    assert_eq!(sheet.groups.len(), 1);
    let names: Vec<&str> = sheet.groups[0].rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, vec!["title", "entityFields", "recordContainers", "customThing"]);
}

#[test]
fn entity_navigator_outline() {
    let nav = navigator("entity", &entity_value(), "Car_entity", None);
    assert_eq!(nav.len(), 1);
    let root = &nav[0];
    let folders: Vec<&str> = root.children.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(folders, vec!["RecordContainers", "Fields", "Parameters", "Providers", "Consumers", "Services"]);
    let fields: Vec<&str> = root.children[1].children.iter().map(|n| n.label.as_str()).collect();
    assert_eq!(fields, vec!["ACTIVITY_ID", "OBJECT_TYPE"]);
    assert_eq!(root.children[1].children[1].path.as_deref(), Some("entityFields.entityField[0]"));
    let db = &root.children[0].children[0];
    let bindings: Vec<(&str, bool)> = db.children.iter().map(|n| (n.label.as_str(), n.dimmed)).collect();
    assert_eq!(bindings, vec![
        ("ACTIVITY_ID.displayValue", true), ("ACTIVITY_ID.value", false), ("OBJECT_TYPE.displayValue", true),
        ("OBJECT_TYPE.value", true), ("Objects", true),
    ]);
    assert_eq!(db.children[1].path.as_deref(), Some("recordContainers.dbRecordContainer.recordFieldMappings.dbRecordFieldMapping"));
    assert_eq!(root.children[3].children[0].label, "#PROVIDER");
}

#[test]
fn designer_sort_puts_underscore_before_letters() {
    let mut v = vec!["Objects", "OBJECT_TYPE", "ACTIVITYLINKID", "ACTIVITY_ID", "Context"];
    v.sort_by_key(|s| nav_sort_key(s));
    assert_eq!(v, vec!["ACTIVITY_ID", "ACTIVITYLINKID", "Context", "OBJECT_TYPE", "Objects"]);
}

#[test]
fn js_functions_of_a_process() {
    let src = "import { a } from \"x\";\nfunction restpost(pRequest) {\n}\nvar helper = function (x) {};\n// function commented()\nexport function restget() {}\n";
    assert_eq!(js_functions(src), vec!["restpost", "helper", "restget"]);
}

#[test]
fn view_navigator_follows_template_children() {
    let view = obj(vec![
        ("name", text("CarFilter_view")),
        ("children", obj(vec![("tableViewTemplate", obj(vec![
            ("name", text("Table")),
            ("columns", obj(vec![("neonTableColumn", obj(vec![("name", text("c1"))]))])),
        ]))])),
    ]);
    let nav = navigator("neonView", &view, "CarFilter_view", None);
    assert_eq!(nav[0].children.len(), 1);
    assert_eq!(nav[0].children[0].label, "Table");
    assert!(nav[0].children[0].children.is_empty());
    assert_eq!(nav[0].children[0].path.as_deref(), Some("children.tableViewTemplate"));
}
