// Integration test for `forge validate`, run as a real subprocess (architecture.md §1: the CLI
// must behave the same standalone as it would invoked from CI). Exercises the full real path:
// designer_core::open_project -> real aod::document::parse of a real fixture -> ProjectModel flattening ->
// designer_core::build_plugin_registry()::validate_project - no mocks anywhere in the chain.

use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

#[test]
fn validate_succeeds_against_a_real_aod_fixture_with_no_registered_validators() {
    let output = Command::new(env!("CARGO_BIN_EXE_designer-cli"))
        .args(["validate", "--project"])
        .arg(fixture("single-aod"))
        .output()
        .expect("forge binary must run");

    assert!(output.status.success(), "stderr: {}", String::from_utf8_lossy(&output.stderr));

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("validated 1 file(s)"),
        "expected the single real .aod fixture to be found and opened, got: {stdout}"
    );
    // plugin-api's builtin::register_all only wires the JS linked-file compiler in this round
    // (see p3-plugin-api-notes.md) - no Validator is registered yet, so 0 is the honest,
    // currently-correct diagnostic count, not a stub.
    assert!(
        stdout.contains("0 registered validator(s): 0 diagnostic(s)"),
        "got: {stdout}"
    );
}

#[test]
fn validate_reports_a_clear_error_for_a_project_path_with_no_aod_files() {
    let empty_dir = std::env::temp_dir().join(format!("forge-cli-validate-empty-{}", std::process::id()));
    std::fs::create_dir_all(&empty_dir).unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_designer-cli"))
        .args(["validate", "--project"])
        .arg(&empty_dir)
        .output()
        .expect("forge binary must run");

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("no .aod files found"), "got: {stderr}");

    std::fs::remove_dir_all(&empty_dir).ok();
}
