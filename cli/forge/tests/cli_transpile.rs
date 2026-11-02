// Real-subprocess integration test for `forge transpile`. Points the CLI at the same read-only
// ADITO Designer install and seeded scratch userdir every P2/P3 transpiler spike/test has used
// (see crates/transpiler/tests/real_transpiler.rs) and runs it against the known-broken fixture
// project - the CLI must reproduce the same "TRANSPILATION FAILED / exit 150" outcome the
// transpiler crate's own real-subprocess test already proved, this time through the full
// forge (CLI) -> forge-core -> transpiler -> nbexec64.exe path with no mocks anywhere in it.
//
// Uses the broken (not the valid) fixture deliberately: it fails fast, keeping this test's JVM
// startup cost to a single run instead of two, while still proving the real subprocess wiring
// end to end.

use std::path::PathBuf;
use std::process::Command;

const INSTALL_DIR: &str =
    r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4";
const USER_DIR: &str =
    r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\_scratch\p3-transpiler-wrapper\userdir";

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

#[test]
fn transpile_reports_real_failure_for_the_broken_fixture_project() {
    if !PathBuf::from(INSTALL_DIR).is_dir() {
        eprintln!("skipping: no local ADITO Designer install at {INSTALL_DIR}");
        return;
    }

    let output = Command::new(env!("CARGO_BIN_EXE_forge"))
        .args(["transpile", "--project"])
        .arg(fixture("testproject-broken"))
        .args(["--install-dir", INSTALL_DIR])
        .args(["--user-dir", USER_DIR])
        .args(["--timeout-secs", "180"])
        .output()
        .expect("forge binary must run");

    assert!(!output.status.success(), "the broken fixture must not transpile successfully");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stdout.contains("TRANSPILATION FAILED") || stderr.contains("150"),
        "expected the real TranspilerCLI failure to surface, got stdout: {stdout}\nstderr: {stderr}"
    );
}

#[test]
fn transpile_reports_an_honest_error_for_a_project_home_that_does_not_exist() {
    let output = Command::new(env!("CARGO_BIN_EXE_forge"))
        .args(["transpile", "--project"])
        .arg(r"C:\this\path\does\not\exist\forge-cli-test")
        .args(["--install-dir", INSTALL_DIR])
        .args(["--user-dir", USER_DIR])
        .output()
        .expect("forge binary must run");

    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("project_home does not exist"), "got: {stderr}");
}
