// Hardening helper: runs the OFFICIAL transpiler (same path as the app's transpile action) on a
// COPY of a corpus project and reports success. Usage: official_transpile_copy <project_copy>
use std::collections::HashMap;

fn main() {
    let project = std::env::args().nth(1).expect("project copy");
    let mut params = HashMap::new();
    let data = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../_scratch/p8-official-transpiler/forge-data");
    params.insert("forge_data_dir".to_string(), data.to_string_lossy().into_owned());
    params.insert("engine".to_string(), "official".to_string());
    let t = std::time::Instant::now();
    let r = forge_app_core::actions::dispatch_action("transpile", project, params);
    println!("official transpile: {:?} in {} s", r, t.elapsed().as_secs());
}
