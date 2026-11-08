// Real, end-to-end proof that the "transpile" action's engine selection switches which engine
// runs, through the same `actions::dispatch_action` entry point the frontend reaches via the
// Tauri `execute_action` command.
//
// The official run goes through the same path the installed app uses (RISKS.md R43): Designer
// installation found by discovery, Forge's own transpiler profile under a Forge data folder,
// seeded once from the user's real Designer profile (read-only). The data folder lives in the
// project scratch area so the 165 MB seed is copied only once across test runs.
//
// Every test works on its own copy of the `minimal` fixture, so no run can leave output behind
// in the checked-in fixture (that pollution was part of R43). Tests are serialised because
// official runs share one transpiler profile, which is single-instance.

use forge_app_core::actions::dispatch_action;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|p| p.into_inner())
}

fn copy_tree(src: &Path, dest: &Path) {
    if src.is_dir() {
        std::fs::create_dir_all(dest).unwrap();
        for entry in std::fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            copy_tree(&entry.path(), &dest.join(entry.file_name()));
        }
    } else {
        std::fs::copy(src, dest).unwrap();
    }
}

fn fresh_fixture_copy(label: &str) -> PathBuf {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../crates/differential-harness/tests/fixtures/minimal");
    let dest = std::env::temp_dir().join(format!("forge-transpile-real-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dest);
    copy_tree(&src, &dest);
    dest
}

fn forge_data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../../_scratch/p8-official-transpiler/forge-data")
}

fn official_params() -> HashMap<String, String> {
    let mut params = HashMap::new();
    params.insert("forge_data_dir".to_string(), forge_data_dir().to_string_lossy().into_owned());
    params
}

#[test]
fn official_engine_transpiles_the_minimal_project_through_the_installed_app_path() {
    let _serial = serial();
    let project = fresh_fixture_copy("official");
    let mut params = official_params();
    params.insert("engine".to_string(), "official".to_string());

    let result = dispatch_action("transpile", project.to_string_lossy().into_owned(), params);

    assert_eq!(result, Ok(()), "official transpiler must succeed against the minimal fixture");
    assert!(project.join("dist").is_dir(), "a successful official run leaves a dist/ tree behind");
    let _ = std::fs::remove_dir_all(project);
}

#[test]
fn missing_engine_param_runs_the_built_in_engine() {
    let _serial = serial();
    let project = fresh_fixture_copy("default");

    let result = dispatch_action("transpile", project.to_string_lossy().into_owned(), official_params());

    assert_eq!(result, Ok(()));
    assert!(project.join("dist").is_dir(), "the default is the built-in Dito_Transpiler, which writes dist/");
    assert!(!project.join("_forge_experimental_dist").exists());
    let _ = std::fs::remove_dir_all(project);
}

#[test]
fn built_in_engine_writes_dist_without_the_official_transpiler() {
    let _serial = serial();
    let project = fresh_fixture_copy("experimental");
    let mut params = HashMap::new();
    params.insert("engine".to_string(), "experimental".to_string());

    let result = dispatch_action("transpile", project.to_string_lossy().into_owned(), params);

    assert_eq!(result, Ok(()));
    assert!(project.join("dist").is_dir());
    assert!(!project.join("_forge_experimental_dist").exists());
    let _ = std::fs::remove_dir_all(project);
}
