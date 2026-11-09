// Integration test for `forge deploy`. Der Befehl ist nicht verfuegbar und meldet das ehrlich,
// statt ein Deploy vorzutaeuschen.

use std::path::PathBuf;
use std::process::Command;

#[test]
fn deploy_reports_not_yet_implemented_instead_of_pretending_to_deploy() {
    let output = Command::new(env!("CARGO_BIN_EXE_designer-cli"))
        .args(["deploy", "--project"])
        .arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/single-aod"))
        .output()
        .expect("forge binary must run");

    assert!(!output.status.success(), "deploy must not report success - it does nothing real yet");
    assert_eq!(output.status.code(), Some(2));

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("nicht verfuegbar"), "got: {stderr}");
}
