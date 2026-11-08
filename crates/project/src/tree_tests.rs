use super::*;

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn demo_project() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/DemoProject")
}

fn temp_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("forge-tree-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn object(root: &Path, folder: &str, name: &str, body: &str) {
    write(&root.join(folder).join(name).join(format!("{name}.aod")), &format!("<?xml version=\"1.0\"?>\n<x>\n  <name>{name}</name>\n{body}\n</x>\n"));
}

fn modification(pkg: &Path, id: &str, change: &str, model_type: &str, model_name: &str, path: &str, value: &str) {
    write(
        &pkg.join("modification").join(id).join(format!("{id}.aod")),
        &format!(
            "<modification>\n  <name>{id}</name>\n  <changeType>{change}</changeType>\n  <modelType>{model_type}</modelType>\n  <modelName>{model_name}</modelName>\n  <path>{path}</path>\n  <value><modelValueWrapper><name>value</name><value>{value}</value></modelValueWrapper></value>\n</modification>\n"
        ),
    );
}

fn view_ref(name: &str, view: &str) -> String {
    format!("<neonViewReference><name>{name}</name><view>{view}</view></neonViewReference>")
}

/// Project + two fake modules: alpha ships the Activity context, beta adds a view to it through a
/// modification and modifies alpha's entity, the project modifies that entity too.
fn fixture() -> PathBuf {
    let root = temp_dir("fixture").join("Demo");
    write(
        &root.join("package.json"),
        r#"{"name":"@acme/demo","version":"1.0.0","adito":{"type":"project"},"dependencies":{"@mods/alpha":"1.0.0","@mods/beta":"2.0.0"}}"#,
    );
    object(&root, "preferences", "_____PREFERENCES_PROJECT", "  <projectName>ADITO xRM</projectName>");
    object(&root, "system", "dev1", "");
    object(&root, "system", "qs_bg", "");
    fs::create_dir_all(root.join("system/broken")).unwrap();
    object(&root, "entity", "Own_entity", "");
    object(&root, "entity", "Shared_entity", "");
    object(&root, "neonContext", "Own", &format!("  <entity>Own_entity</entity>\n  <references>{}</references>", view_ref("r1", "Own_view")));
    object(&root, "neonView", "Own_view", "");
    object(&root, "process", "a_lib", "  <variants>\n    <element>LIBRARY</element>\n  </variants>");
    object(&root, "process", "b_rest", "  <publishAsWebservice v=\"true\" />\n  <variants>\n    <element>EXECUTABLE</element>\n  </variants>");
    object(&root, "process", "c_exec", "  <variants>\n    <element>EXECUTABLE</element>\n  </variants>");
    object(&root, "process", "d_auto", "");
    write(&root.join("others/readme.txt"), "x");
    for f in [".gitignore", "CLAUDE.md", "package-lock.json", "jsconfig.json"] {
        write(&root.join(f), "{}");
    }
    fs::create_dir_all(root.join("dist/x")).unwrap();
    fs::create_dir_all(root.join("docs")).unwrap();
    modification(&root, "p1", "MODIFY", "entity", "Alpha_entity", "Alpha_entity/title", "x");

    let alpha = root.join("node_modules/@mods/alpha");
    write(&alpha.join("package.json"), r#"{"name":"@mods/alpha","version":"1.0.0","adito":{"type":"module"}}"#);
    object(&alpha, "entity", "Alpha_entity", "");
    object(&alpha, "entity", "Shared_entity", "");
    object(&alpha, "neonView", "AlphaEdit_view", "");
    object(
        &alpha,
        "neonContext",
        "Activity",
        &format!("  <entity>Alpha_entity</entity>\n  <references>{}{}</references>", view_ref("a1", "AlphaEdit_view"), view_ref("a2", "BetaList_view")),
    );

    let beta = root.join("node_modules/@mods/beta");
    write(&beta.join("package.json"), r#"{"name":"@mods/beta","version":"2.0.0","adito":{"type":"module"}}"#);
    object(&beta, "neonView", "BetaList_view", "");
    object(&beta, "neonView", "betaLower_view", "");
    modification(&beta, "m1", "INSERT", "neonContext", "Activity", "Activity/references", &view_ref("b1", "betaLower_view"));
    modification(&beta, "m2", "INSERT", "neonContext", "Activity", "Activity/references", &view_ref("b2", "BetaList_view"));
    modification(&beta, "m3", "MODIFY", "entity", "Alpha_entity", "Alpha_entity/title", "y");
    root
}

fn scan(root: &Path) -> TreeNode {
    scan_project_tree_with(root, &[]).unwrap().remove(0)
}

fn child<'a>(node: &'a TreeNode, label: &str) -> &'a TreeNode {
    node.children.iter().find(|c| c.label == label).unwrap_or_else(|| panic!("no child '{label}' under '{}'", node.label))
}

const FOLDER_ORDER: [&str; 16] = [
    "system", "preferences", "application", "context", "notificationtype", "entity", "dashboard", "renderer", "process",
    "test", "service", "report", "language", "role", "alias", "others",
];

#[test]
fn root_shows_name_project_name_and_forward_slash_path() {
    let root = fixture();
    let tree = scan(&root);
    assert_eq!(tree.label, "Demo");
    assert_eq!(tree.kind, NodeKind::Project);
    assert_eq!(tree.type_label.as_deref(), Some("ADITO xRM"));
    assert!(tree.bold);
    assert!(!tree.path.as_deref().unwrap().contains('\\'));
}

#[test]
fn sixteen_folders_in_designer_order_then_root_files_then_libraries() {
    let tree = scan(&fixture());
    let labels: Vec<&str> = tree.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(&labels[..16], &FOLDER_ORDER);
    assert_eq!(&labels[16..], &[".gitignore", "CLAUDE.md", "jsconfig.json", "package.json", "package-lock.json", "External Libraries"]);
    assert!(!labels.contains(&"dist") && !labels.contains(&"docs") && !labels.contains(&"node_modules"));
}

#[test]
fn empty_folders_have_no_expander_and_are_dimmed() {
    let tree = scan(&fixture());
    for label in ["test", "renderer", "notificationtype"] {
        let f = child(&tree, label);
        assert!(f.is_leaf && f.dimmed && f.children.is_empty(), "{label}");
    }
    assert!(!child(&tree, "entity").dimmed);
}

#[test]
fn project_objects_win_and_module_objects_carry_origin() {
    let tree = scan(&fixture());
    let entity = child(&tree, "entity");
    let labels: Vec<&str> = entity.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["Alpha_entity", "Own_entity", "Shared_entity"]);
    let shared = child(entity, "Shared_entity");
    assert_eq!(shared.origin, None, "the project's own object hides the module's");
    assert!(!shared.id.contains("node_modules"));
    let alpha = child(entity, "Alpha_entity");
    assert_eq!(alpha.origin.as_deref(), Some("@mods/alpha:1.0.0"));
    assert!(alpha.read_only);
    assert!(alpha.id.ends_with("Alpha_entity.aod"), "object ids stay the absolute .aod path");
}

#[test]
fn override_chain_shows_only_the_package_that_changed_the_object_last() {
    let tree = scan(&fixture());
    let alpha = child(child(&tree, "entity"), "Alpha_entity");
    assert_eq!(alpha.overrides, ["@acme/demo:1.0.0"]);
    assert!(child(child(&tree, "entity"), "Own_entity").overrides.is_empty());
}

#[test]
fn context_lists_entity_first_then_views_including_modification_inserts() {
    let tree = scan(&fixture());
    let activity = child(child(&tree, "context"), "Activity");
    let labels: Vec<&str> = activity.children.iter().map(|c| c.label.as_str()).collect();
    // Case-insensitive order, and a view inserted again by a module stays listed twice like in
    // the Designer.
    assert_eq!(labels, ["Alpha_entity", "AlphaEdit_view", "BetaList_view", "BetaList_view", "betaLower_view"]);
    assert_eq!(activity.children[0].object_type.as_deref(), Some("entity"));
    let inserted = child(activity, "betaLower_view");
    assert_eq!(inserted.origin.as_deref(), Some("@mods/beta:2.0.0"));
    assert_eq!(activity.origin.as_deref(), Some("@mods/alpha:1.0.0"));
    assert!(child(&tree, "context").children.iter().all(|c| c.label != "neonView"));
}

#[test]
fn process_folder_groups_by_variant() {
    let tree = scan(&fixture());
    let process = child(&tree, "process");
    let groups: Vec<(&str, Vec<&str>)> =
        process.children.iter().map(|g| (g.label.as_str(), g.children.iter().map(|c| c.label.as_str()).collect())).collect();
    assert_eq!(
        groups,
        [("executables", vec!["c_exec"]), ("internal", vec!["d_auto"]), ("libraries", vec!["a_lib"]), ("webservices", vec!["b_rest"])]
    );
}

#[test]
fn system_marks_default_bold_and_incomplete_dimmed() {
    let root = fixture();
    let props = root.parent().unwrap().join("DesignerBase.properties");
    let key = forward(&root).replace(':', "\\:");
    write(&props, &format!("other=1\nfile\\:/{key}/project.systemConfig.name=qs_bg\n"));
    let tree = scan_project_tree_with(&root, &[props]).unwrap().remove(0);
    let system = child(&tree, "system");
    assert!(child(system, "qs_bg").bold);
    assert!(!child(system, "dev1").bold);
    let broken = child(system, "broken");
    assert!(broken.dimmed && broken.id.starts_with("missing:"));
}

#[test]
fn default_system_key_handles_escapes_and_umlauts() {
    let content = "file\\:/C\\:/Repos/FZ_J\\u00fcrlich/project.systemConfig.name=dev1_bg\n";
    assert_eq!(default_system_from_properties(content, Path::new("C:\\Repos\\FZ_Jürlich")).as_deref(), Some("dev1_bg"));
    assert_eq!(default_system_from_properties(content, Path::new("C:/Repos/Other")), None);
}

#[test]
fn external_libraries_list_modules_with_lazy_read_only_file_trees() {
    let tree = scan(&fixture());
    let libs = tree.children.last().unwrap();
    assert_eq!(libs.kind, NodeKind::Libraries);
    let labels: Vec<&str> = libs.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["alpha", "beta"]);
    let alpha = &libs.children[0];
    assert!(alpha.lazy && alpha.read_only && alpha.bold);
    assert!(alpha.path.as_deref().unwrap().ends_with("node_modules/@mods/alpha"));
    let files = list_tree_children(&alpha.id).unwrap();
    let names: Vec<&str> = files.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(names, ["entity", "neonContext", "neonView", "package.json"]);
    assert!(files.iter().all(|f| f.read_only));
}

#[test]
fn others_merges_project_and_module_files() {
    let root = fixture();
    write(&root.join("node_modules/@mods/alpha/others/Alpha_Upgrader.json"), "{}");
    write(&root.join("node_modules/@mods/alpha/others/readme.txt"), "module copy");
    fs::create_dir_all(root.join("node_modules/@mods/beta/others/sub")).unwrap();
    write(&root.join("node_modules/@mods/beta/others/sub/x.txt"), "x");
    let tree = scan(&root);
    let others = child(&tree, "others");
    let labels: Vec<&str> = others.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["sub", "Alpha_Upgrader.json", "readme.txt"]);
    let readme = child(others, "readme.txt");
    assert!(readme.origin.is_none() && !readme.read_only, "the project's own file wins");
    let upgrader = child(others, "Alpha_Upgrader.json");
    assert_eq!(upgrader.origin.as_deref(), Some("@mods/alpha:1.0.0"));
    assert!(upgrader.read_only);
    let sub = child(others, "sub");
    assert!(sub.lazy);
    assert_eq!(list_tree_children(&sub.id).unwrap()[0].label, "x.txt");
}

#[test]
fn node_modules_paths_are_not_writable() {
    assert!(ensure_writable(Path::new("C:/p/node_modules/@a/b/entity/X/X.aod")).unwrap_err().contains("read-only"));
    assert!(ensure_writable(Path::new("C:/p/entity/X/X.aod")).is_ok());
}

#[test]
fn project_without_package_json_still_shows_its_objects() {
    let tree = scan(&demo_project());
    assert_eq!(tree.type_label.as_deref(), Some("hermes xRM2026"), "project name from the preferences, not hard-coded");
    let entity = child(&tree, "entity");
    assert_eq!(entity.children.len(), 5);
    assert!(entity.children.iter().any(|c| c.label == "THHIT_Committee_entity"));
    assert_eq!(child(&tree, "alias").children.len(), 2);
    assert_eq!(child(&tree, "language").children.len(), 2);
    assert_eq!(child(&tree, "system").children.len(), 2);
    assert_eq!(child(&tree, "dashboard").children.len(), 1);
    assert_eq!(child(&tree, "report").children.len(), 3);
    assert_eq!(child(&tree, "service").children.len(), 3, "entityWebservice objects sit under service (unverified)");
    assert_eq!(child(&tree, "context").children.len(), 2);
    assert!(child(&tree, "External Libraries").children.is_empty());
}

#[test]
fn missing_project_root_is_a_clean_error_not_a_panic() {
    let err = scan_project_tree(Path::new("Z:/does/not/exist")).unwrap_err();
    assert!(err.contains("not a directory"));
}

#[test]
fn empty_project_root_is_a_dedicated_no_project_error() {
    let err = scan_project_tree(Path::new("")).unwrap_err();
    assert_eq!(err, "no project folder selected");
}

/// Structure check against the real Pichler checkout (read only). Skips when it is not there.
#[test]
fn real_pichler_tree_structure() {
    let root = Path::new("C:/Users/ClemensBeile/Desktop/GitRepos_ADITO/Pichler");
    if !root.join("package.json").is_file() {
        eprintln!("Pichler not present, skipped");
        return;
    }
    let started = std::time::Instant::now();
    let tree = scan_project_tree(root).unwrap().remove(0);
    eprintln!("Pichler scan took {:?}", started.elapsed());
    let labels: Vec<&str> = tree.children.iter().take(16).map(|c| c.label.as_str()).collect();
    assert_eq!(labels, FOLDER_ORDER);
    assert_eq!(tree.type_label.as_deref(), Some("ADITO xRM"));
    let activity = child(child(&tree, "context"), "Activity");
    assert_eq!(activity.children[0].label, "Activity_entity");
    assert!(
        activity.children.iter().any(|c| c.origin.as_deref().is_some_and(|o| !o.starts_with("@aditosoftware/activity:"))),
        "Activity shows views other modules add"
    );
}

#[test]
fn object_type_for_leaf_path_recognises_every_p4_family() {
    for (path, expected) in [
        ("C:/proj/entity/Foo_entity/Foo_entity.aod", "entity"),
        ("C:/proj/neonView/Foo_view/Foo_view.aod", "neonView"),
        ("C:/proj/neonContext/Foo/Foo.aod", "neonContext"),
        ("C:/proj/neonDashboard/Foo/Foo.aod", "neonDashboard"),
        ("C:/proj/aliasDefinition/Foo_alias/Foo_alias.aod", "aliasDefinition"),
        ("C:/proj/language/_____LANGUAGE_de/_____LANGUAGE_de.aod", "language"),
        ("C:/proj/system/dev1/dev1.aod", "system"),
        ("C:/proj/preferences/_____PREFERENCES_PROJECT/_____PREFERENCES_PROJECT.aod", "preferences"),
        ("C:/proj/application/_____SYSTEM_APPLICATION_NEON/_____SYSTEM_APPLICATION_NEON.aod", "application"),
        ("C:/proj/entityWebservice/Foo_ws/Foo_ws.aod", "entityWebservice"),
    ] {
        assert_eq!(object_type_for_leaf_path(Path::new(path)), Some(expected));
    }
}

#[test]
fn object_type_for_leaf_path_is_none_for_an_unrecognised_folder() {
    assert_eq!(object_type_for_leaf_path(Path::new("C:/proj/role/Foo/Foo.aod")), None);
}


#[test]
fn liquibase_changelogs_are_listed_below_their_alias() {
    let root = temp_dir("liquibase").join("Demo");
    write(&root.join("package.json"), r#"{"name":"@acme/demo","version":"1.0.0","adito":{"type":"project"}}"#);
    object(&root, "aliasDefinition", "Data_alias", "");
    object(&root, "aliasDefinition", "Other_alias", "");
    write(&root.join(".liquibase/Data_alias/changelog.xml"), "<databaseChangeLog/>");
    write(&root.join(".liquibase/Data_alias/xrm/create_x.xml"), "<databaseChangeLog/>");
    let tree = scan_project_tree_with(&root, &[]).unwrap();
    let alias = tree[0].children.iter().find(|n| n.label == "alias").unwrap();
    let data = alias.children.iter().find(|n| n.label == "Data_alias").unwrap();
    assert!(!data.is_leaf);
    let labels: Vec<&str> = data.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, vec!["xrm", "changelog.xml"]);
    assert!(data.children[0].lazy, "sub folders load on expand");
    assert!(alias.children.iter().find(|n| n.label == "Other_alias").unwrap().is_leaf);
}

#[test]
fn context_shows_its_icon_the_entity_icon_and_its_webservices() {
    let root = temp_dir("ctx-icon");
    object(&root, "neonContext", "Imp", "  <icon>NEON:IMPORT</icon>\n  <entity>Imp_entity</entity>\n  <references>\n    <webserviceReference>\n      <name>r1</name>\n      <webservice>Imp_ws</webservice>\n    </webserviceReference>\n  </references>");
    object(&root, "entity", "Imp_entity", "  <icon>VAADIN:PRINT</icon>");
    object(&root, "entityWebservice", "Imp_ws", "");
    object(&root, "entityWebservice", "Other_ws", "");
    modification(
        &root,
        "m1",
        "INSERT",
        "neonContext",
        "Imp",
        "Imp/references",
        "<webserviceReference><name>r2</name><webservice>Other_ws</webservice></webserviceReference>",
    );
    let tree = scan(&root);
    let imp = child(child(&tree, "context"), "Imp");
    assert_eq!(imp.icon.as_deref(), Some("NEON:IMPORT"));
    let labels: Vec<&str> = imp.children.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["Imp_entity", "Imp_ws", "Other_ws"]);
    assert_eq!(imp.children[0].icon.as_deref(), Some("VAADIN:PRINT"));
    assert_eq!(imp.children[1].object_type.as_deref(), Some("entityWebservice"));
}
