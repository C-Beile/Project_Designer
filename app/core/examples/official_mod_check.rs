// Hardening helper: writes Forge modifications (MODIFY / INSERT / DELETE / script) for the module
// object Activity_entity into a COPY of FZ_Juelich, runs the OFFICIAL transpiler on it and prints the
// line diff of dist/entity/Activity_entity between the baseline run and the run with the changes.
// Usage: official_mod_check <project_copy>   (the copy must already carry a baseline dist/)

use forge_app_core::modification_write::{delete, insert, modify, ModValue, ObjectRef};
use std::collections::HashMap;
use std::path::PathBuf;

fn changed(a: &str, b: &str) -> (Vec<String>, Vec<String>) {
    let al: Vec<&str> = a.split('\n').collect();
    let bl: Vec<&str> = b.split('\n').collect();
    let pre = al.iter().zip(&bl).take_while(|(x, y)| x == y).count();
    let suf = al[pre..].iter().rev().zip(bl[pre..].iter().rev()).take_while(|(x, y)| x == y).count();
    (al[pre..al.len() - suf].iter().map(|s| s.to_string()).collect(), bl[pre..bl.len() - suf].iter().map(|s| s.to_string()).collect())
}

fn main() {
    let project = PathBuf::from(std::env::args().nth(1).expect("project copy"));
    let target = project.join("dist/entity/Activity_entity/Activity_entity.aod");
    let baseline = std::fs::read_to_string(&target).expect("baseline dist");
    let o = ObjectRef { project_root: project.clone(), model_type: "entity".into(), model_name: "Activity_entity".into() };
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();

    let title_tag = baseline.split("<title>").nth(1).and_then(|t| t.split("</title>").next()).unwrap_or("").to_string();
    println!("{:?}", modify(&o, &s(&["title"]), ModValue::Text("Hardened Title".into()), Some(&title_tag)));
    let xml = "<entityField>\n  <name>HARDENING_FIELD</name>\n  <contentType>TEXT</contentType>\n</entityField>";
    println!("{:?}", insert(&o, &s(&["entityFields"]), "HARDENING_FIELD", xml));
    println!("{:?}", modify(&o, &s(&["afterSave"]), ModValue::Script { file_name: "afterSave.js".into(), content: "// hardened\n".into() }, Some("// module content")));

    let mut params = HashMap::new();
    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../_scratch/p8-official-transpiler/forge-data");
    params.insert("forge_data_dir".to_string(), data.to_string_lossy().into_owned());
    params.insert("engine".to_string(), "official".to_string());
    let t = std::time::Instant::now();
    let r = forge_app_core::actions::dispatch_action("transpile", project.to_string_lossy().into_owned(), params);
    println!("official transpile with Forge modifications: {:?} in {} s", r, t.elapsed().as_secs());

    let after = std::fs::read_to_string(&target).expect("dist after");
    let (old, new) = changed(&baseline, &after);
    println!("--- removed/changed lines: {}", old.len());
    for l in old.iter().take(10) {
        println!("- {}", l.trim_end());
    }
    println!("+++ added/changed lines: {}", new.len());
    for l in new.iter().take(12) {
        println!("+ {}", l.trim_end());
    }
}
