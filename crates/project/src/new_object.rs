//! File > New and the "New" entry of the tree's context menu: creates one new object of the
//! project (`<root>/<type>/<Name>/<Name>.aod`, plus the files that belong to the type).
//!
//! The file shapes are taken from real objects of the test corpus (smallest hand-created
//! instance per type): same XML header, root attributes, element order, two-space indentation and
//! the line ending of the project (CRLF in every corpus project), closed by one line break. Only
//! types whose minimal shape is evidenced can be created; all others are listed but disabled.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub use crate::object_names::{check_reserved, validate_name, MSG_EMPTY, MSG_EXISTS, MSG_SYSTEM_NAME, ROLE_PREFIX, SYSTEM_PREFIX};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NewObjectKind {
    /// Folder below the project root, e.g. `neonView`.
    pub folder: String,
    /// Name in the Designer's wording.
    pub label: String,
    pub enabled: bool,
    /// Why the type cannot be created yet.
    pub hint: Option<String>,
    /// The type needs a title (shown in the client).
    pub needs_title: bool,
    /// Label of an optional reference field (e.g. the entity of a context), if the type has one.
    pub reference_label: Option<String>,
}

struct KindDef {
    folder: &'static str,
    label: &'static str,
    root: &'static str,
    version: &'static str,
    needs_title: bool,
    reference_label: Option<&'static str>,
    disabled: Option<&'static str>,
}

const NO_SHAPE: &str = "The minimal file of a new object of this type is not evidenced yet";

const KINDS: &[KindDef] = &[
    KindDef { folder: "entity", label: "Entity", root: "entity", version: "1.4.0", needs_title: false, reference_label: None, disabled: None },
    KindDef { folder: "neonView", label: "View", root: "neonView", version: "1.2.3", needs_title: false, reference_label: None, disabled: None },
    KindDef { folder: "neonContext", label: "Context", root: "neonContext", version: "1.2.0", needs_title: false, reference_label: Some("Entity (optional)"), disabled: None },
    KindDef { folder: "process", label: "Process", root: "process", version: "1.3.0", needs_title: false, reference_label: None, disabled: None },
    KindDef { folder: "role", label: "Role", root: "role", version: "1.3.0", needs_title: true, reference_label: None, disabled: None },
    KindDef { folder: "neonNotificationType", label: "Notification type", root: "neonNotificationType", version: "1.2.0", needs_title: true, reference_label: None, disabled: None },
    KindDef { folder: "serviceDefinition", label: "Service", root: "serviceDefinition", version: "1.0.0", needs_title: false, reference_label: None, disabled: None },
    KindDef { folder: "neonDashboard", label: "Dashboard", root: "neonDashboard", version: "1.2.0", needs_title: false, reference_label: None, disabled: Some("Every dashboard of the corpus carries icon and roles: the minimal file is not evidenced yet") },
    KindDef { folder: "entityWebservice", label: "Entity webservice", root: "entityWebservice", version: "1.1.0", needs_title: false, reference_label: None, disabled: Some("Needs the field list of its entity: use Paste of an existing webservice") },
    KindDef { folder: "report", label: "Report", root: "report", version: "1.3.0", needs_title: false, reference_label: None, disabled: Some("Needs a Jasper template (reportData.jrxml) that Forge cannot author") },
    KindDef { folder: "language", label: "Language", root: "language", version: "1.3.0", needs_title: false, reference_label: None, disabled: Some(NO_SHAPE) },
    KindDef { folder: "aliasDefinition", label: "Alias definition", root: "aliasDefinition", version: "1.3.1", needs_title: false, reference_label: None, disabled: Some("Needs the data source type of the database") },
    KindDef { folder: "rendererDefinition", label: "Renderer", root: "rendererDefinition", version: "1.1.0", needs_title: false, reference_label: None, disabled: Some("Needs the renderer type and its configuration") },
    KindDef { folder: "system", label: "System", root: "system", version: "1.2.0", needs_title: false, reference_label: None, disabled: Some("Paths and login of a system are project specific: the original dialog values are unknown") },
];

pub fn kinds() -> Vec<NewObjectKind> {
    KINDS
        .iter()
        .map(|k| NewObjectKind {
            folder: k.folder.into(),
            label: k.label.into(),
            enabled: k.disabled.is_none(),
            hint: k.disabled.map(str::to_string),
            needs_title: k.needs_title,
            reference_label: k.reference_label.map(str::to_string),
        })
        .collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Line ending of the project: that of the first existing object file (own type first).
fn project_eol(root: &Path, folder: &str) -> &'static str {
    let mut folders = vec![folder.to_string()];
    folders.extend(KINDS.iter().map(|k| k.folder.to_string()));
    for f in folders {
        let Ok(entries) = fs::read_dir(root.join(&f)) else { continue };
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for d in dirs {
            let name = d.file_name().to_string_lossy().into_owned();
            if let Ok(bytes) = fs::read(d.path().join(format!("{name}.aod"))) {
                if bytes.windows(2).any(|w| w == b"\r\n") {
                    return "\r\n";
                }
                if bytes.contains(&b'\n') {
                    return "\n";
                }
            }
        }
    }
    "\r\n"
}

/// Model version of the project's own objects of this type, else the evidenced default.
fn project_version(root: &Path, kind: &KindDef) -> String {
    if let Ok(entries) = fs::read_dir(root.join(kind.folder)) {
        let mut dirs: Vec<_> = entries.flatten().filter(|e| e.path().is_dir()).collect();
        dirs.sort_by_key(|e| e.file_name());
        for d in dirs {
            let name = d.file_name().to_string_lossy().into_owned();
            if let Ok(text) = fs::read_to_string(d.path().join(format!("{name}.aod"))) {
                if let Some(v) = text.lines().take(3).find_map(|l| l.split("VERSION=\"").nth(1).and_then(|r| r.split('"').next())) {
                    if !v.is_empty() {
                        return v.to_string();
                    }
                }
            }
        }
    }
    kind.version.to_string()
}

fn body_lines(kind: &KindDef, name: &str, title: Option<&str>, reference: Option<&str>) -> Vec<String> {
    let mut v = vec![format!("  <name>{name}</name>")];
    match kind.folder {
        "role" | "neonNotificationType" => {
            v.push(format!("  <title>{}</title>", xml_escape(title.unwrap_or(""))));
            v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into());
        }
        "entity" => {
            v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into());
            v.extend(
                [
                    "  <entityFields>",
                    "    <entityProvider>",
                    "      <name>#PROVIDER</name>",
                    "    </entityProvider>",
                    "    <entityProvider>",
                    "      <name>#PROVIDER_AGGREGATES</name>",
                    "      <useAggregates v=\"true\" />",
                    "    </entityProvider>",
                    "  </entityFields>",
                ]
                .map(String::from),
            );
        }
        "neonView" => {
            v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into());
            v.extend(["  <layout>", "    <noneLayout />", "  </layout>"].map(String::from));
        }
        "neonContext" => {
            v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into());
            if let Some(e) = reference.filter(|e| !e.is_empty()) {
                v.push(format!("  <entity>{}</entity>", xml_escape(e)));
            }
        }
        "process" => {
            v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into());
            v.push(format!("  <process>%aditoprj%/process/{name}/process.js</process>"));
        }
        _ => v.push("  <majorModelMode>DISTRIBUTED</majorModelMode>".into()),
    }
    v
}

/// The complete text of the new object file in the given line ending.
pub fn render(folder: &str, name: &str, title: Option<&str>, reference: Option<&str>, version: &str, eol: &str) -> Result<String, String> {
    let kind = KINDS.iter().find(|k| k.folder == folder).ok_or("Unknown object type.")?;
    let mut lines = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        format!(
            "<{r} xmlns=\"http://www.adito.de/2018/ao/Model\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" VERSION=\"{version}\" xsi:schemaLocation=\"http://www.adito.de/2018/ao/Model adito://models/xsd/{r}/{version}\">",
            r = kind.root
        ),
    ];
    lines.extend(body_lines(kind, name, title, reference));
    lines.push(format!("</{}>", kind.root));
    Ok(lines.join(eol) + eol)
}

/// Creates the object. Nothing is written when the name is invalid or taken. Returns the `.aod`.
pub fn create_object(root: &Path, folder: &str, name: &str, title: Option<&str>, reference: Option<&str>) -> Result<PathBuf, String> {
    let kind = KINDS.iter().find(|k| k.folder == folder).ok_or("Unknown object type.")?;
    if let Some(why) = kind.disabled {
        return Err(format!("{} cannot be created yet: {why}.", kind.label));
    }
    if kind.needs_title && title.map(str::trim).unwrap_or("").is_empty() {
        return Err("A title is required.".into());
    }
    validate_name(root, folder, name)?;
    let eol = project_eol(root, folder);
    let version = project_version(root, kind);
    let text = render(folder, name, title.map(str::trim), reference.map(str::trim), &version, eol)?;
    let dir = root.join(folder).join(name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let aod = dir.join(format!("{name}.aod"));
    let result = (|| -> Result<(), String> {
        fs::write(&aod, text.as_bytes()).map_err(|e| e.to_string())?;
        platform::fs::note_own_change(&dir);
        platform::fs::note_own_change(&aod);
        if folder == "process" {
            fs::write(dir.join("process.js"), b"").map_err(|e| e.to_string())?;
            platform::fs::note_own_change(&dir.join("process.js"));
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(aod)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CORPUS: &str = r"C:\Users\ClemensBeile\Desktop\GitRepos_ADITO";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forge-new-object-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn corpus_bytes(rel: &str) -> Option<Vec<u8>> {
        fs::read(Path::new(CORPUS).join(rel)).ok()
    }

    /// The generated text of `name` must equal the real file once the name is substituted.
    fn assert_matches_corpus(folder: &str, rel: &str, real_name: &str, title: Option<&str>, reference: Option<&str>) {
        let Some(real) = corpus_bytes(rel) else { return };
        let real_text = String::from_utf8(real).unwrap();
        let version = real_text.split("VERSION=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
        let eol = if real_text.contains("\r\n") { "\r\n" } else { "\n" };
        let made = render(folder, real_name, title, reference, &version, eol).unwrap();
        assert_eq!(made, real_text, "{folder} differs from {rel}");
    }

    #[test]
    fn generated_files_equal_real_designer_files_byte_for_byte() {
        assert_matches_corpus("entity", r"SVB\entity\THHIT_TitleSuffix_entity\THHIT_TitleSuffix_entity.aod", "THHIT_TitleSuffix_entity", None, None);
        assert_matches_corpus("neonView", r"Hermes\neonView\THHIT_Test\THHIT_Test.aod", "THHIT_Test", None, None);
        assert_matches_corpus("role", r"BHB\role\PROJECT_DSGVO\PROJECT_DSGVO.aod", "PROJECT_DSGVO", Some("DSGVO"), None);
        assert_matches_corpus("neonContext", r"FZ_Jürlich\node_modules\@aditosoftware\root\neonContext\Object\Object.aod", "Object", None, Some("Object_entity"));
        assert_matches_corpus("serviceDefinition", r"FZ_Jürlich\node_modules\@aditosoftware\root\serviceDefinition\indexSearch_service\indexSearch_service.aod", "indexSearch_service", None, None);
        assert_matches_corpus("neonNotificationType", r"FFG\node_modules\@aditosoftware\workflow\neonNotificationType\WorkflowsStarted\WorkflowsStarted.aod", "WorkflowsStarted", Some("Worklow started"), None);
    }

    #[test]
    fn process_variants_of_the_real_file_are_the_only_difference() {
        // The corpus process carries a LIBRARY variant the new object does not have.
        let Some(real) = corpus_bytes(r"Car_Training\clemens-onboarding-main\process\CarPoolKeywords_registry\CarPoolKeywords_registry.aod") else { return };
        let real = String::from_utf8(real).unwrap();
        let made = render("process", "CarPoolKeywords_registry", None, None, "1.3.0", "\r\n").unwrap();
        assert!(real.starts_with(made.trim_end_matches("</process>\r\n")));
    }

    #[test]
    fn a_new_object_is_created_with_the_project_line_ending_and_files() {
        let root = scratch("create");
        fs::create_dir_all(root.join("neonView").join("Old_view")).unwrap();
        fs::write(root.join("neonView").join("Old_view").join("Old_view.aod"), "<neonView VERSION=\"1.2.1\" x=\"y\">\r\n</neonView>\r\n").unwrap();
        let aod = create_object(&root, "neonView", "New_view", None, None).unwrap();
        let text = fs::read_to_string(&aod).unwrap();
        assert!(text.contains("VERSION=\"1.2.1\""), "version of the project's own views");
        assert!(text.ends_with("</neonView>\r\n"));
        assert!(!text.replace("\r\n", "").contains('\n'));

        let proc = create_object(&root, "process", "My_lib", None, None).unwrap();
        assert!(proc.parent().unwrap().join("process.js").exists());
        assert!(fs::read_to_string(&proc).unwrap().contains("%aditoprj%/process/My_lib/process.js"));
    }

    #[test]
    fn taken_and_invalid_names_write_nothing() {
        let root = scratch("names");
        create_object(&root, "entity", "A_entity", None, None).unwrap();
        assert!(create_object(&root, "entity", "a_entity", None, None).unwrap_err().contains("already exists"));
        assert!(create_object(&root, "entity", "bad name", None, None).is_err());
        assert!(create_object(&root, "entity", "1abc", None, None).is_err());
        assert!(create_object(&root, "role", "R", None, None).unwrap_err().contains("title"));
        assert!(!root.join("role").exists());
        assert!(create_object(&root, "report", "R_report", None, None).unwrap_err().contains("cannot be created"));
    }

    #[test]
    fn names_of_installed_modules_are_taken() {
        let root = scratch("module");
        fs::create_dir_all(root.join("node_modules").join("@aditosoftware").join("root").join("neonContext").join("Object")).unwrap();
        assert_eq!(validate_name(&root, "neonContext", "Object").unwrap_err(), MSG_EXISTS);
        assert!(validate_name(&root, "neonContext", "Other").is_ok());
        assert!(!root.join("neonContext").exists());
    }

    #[test]
    fn name_check_runs_its_six_stages_in_order_with_the_original_messages() {
        let root = scratch("stages");
        create_object(&root, "entity", "Taken", None, None).unwrap();
        assert_eq!(validate_name(&root, "entity", "").unwrap_err(), "String is empty.");
        assert_eq!(validate_name(&root, "entity", "   ").unwrap_err(), "String is empty.");
        assert_eq!(validate_name(&root, "entity", "_____Mine").unwrap_err(), "Name is part of systemname.");
        assert_eq!(validate_name(&root, "entity", "A#B").unwrap_err(), "Name is part of systemname.");
        assert_eq!(validate_name(&root, "entity", "taken").unwrap_err(), "Name already exists in this project or model.");
        assert_eq!(check_reserved(&[("Special", "system")], "entity", "special").unwrap_err(), "Name is only valid for type system.");
        assert!(check_reserved(&[("Special", "system")], "system", "Special").is_ok());
        assert!(validate_name(&root, "entity", "bad name").unwrap_err().contains("letters, digits"));
        assert!(validate_name(&root, "entity", "1abc").unwrap_err().contains("digit"));
        assert_eq!(validate_name(&root, "role", "Sales").unwrap_err(), "Must start with PROJECT_");
        assert!(validate_name(&root, "role", "PROJECT_Sales").is_ok());
        assert!(validate_name(&root, "entity", "Free_entity").is_ok());
    }

    #[test]
    fn an_earlier_stage_wins_over_a_later_one() {
        let root = scratch("order");
        create_object(&root, "entity", "x", None, None).unwrap();
        assert_eq!(validate_name(&root, "role", "_____x").unwrap_err(), MSG_SYSTEM_NAME);
        assert_eq!(validate_name(&root, "entity", "X").unwrap_err(), MSG_EXISTS);
        assert_eq!(validate_name(&root, "entity", "#").unwrap_err(), MSG_SYSTEM_NAME);
    }

    #[test]
    fn titles_are_escaped() {
        let made = render("role", "R", Some("A & B <x>"), None, "1.3.0", "\n").unwrap();
        assert!(made.contains("<title>A &amp; B &lt;x&gt;</title>"));
    }

    #[test]
    fn unproven_types_are_listed_but_disabled() {
        let list = kinds();
        assert!(list.iter().find(|k| k.folder == "entity").unwrap().enabled);
        let report = list.iter().find(|k| k.folder == "report").unwrap();
        assert!(!report.enabled && report.hint.is_some());
    }
}
