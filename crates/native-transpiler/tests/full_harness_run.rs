// Full-harness integration test: real reference transpiler subprocess + StubEngine + byte
// comparison + report generation, against a small, purpose-built minimal project (fixture
// derived from the already-verified transpiler crate fixture, see tests/fixtures/minimal).
// This is the "reicht als manueller/dokumentierter Lauf" case from the role definition for the
// small project; the large-corpus (Hermes) run is documented separately and run manually (see
// PROJECT/20_architecture/p5-differential-harness-notes.md), not wired into `cargo test`.
//
// Known limitation shared with transpiler::tests::real_transpiler: nbexec64.exe takes an
// exclusive lock on its userdir for the process lifetime. This test reuses the SAME scratch
// userdir as the transpiler crate's own real-subprocess tests (already seeded with the
// required de.adito.aditoweb.nbm.nodejs plugin, see spike-transpiler-wrapper.md). Running this
// test concurrently with those (e.g. a workspace-wide `cargo test -j N` executing both test
// binaries at once) can race for that lock; run `cargo test -p differential-harness` and
// `cargo test -p transpiler` sequentially if both must run, exactly as documented in the
// notes file.

use differential_harness::{DifferentialHarness, OwnEngine, StubEngine};
use std::path::PathBuf;
use std::time::Duration;
use transpiler::TranspilerConfig;

const INSTALL_DIR: &str = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4";
const USER_DIR: &str = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\_scratch\p3-transpiler-wrapper\userdir";


// Each run works on a temp copy so no transpiler output is ever written into the checked-in
// fixture (fixture pollution was part of RISKS.md R43).
fn temp_copy_of(src: &std::path::Path, label: &str) -> PathBuf {
    fn copy_tree(src: &std::path::Path, dest: &std::path::Path) {
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
    let dest = std::env::temp_dir().join(format!("forge-fixture-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dest);
    copy_tree(src, &dest);
    dest
}

fn fixture_project() -> PathBuf {
    temp_copy_of(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal"), "harness-minimal")
}

#[test]
fn stub_engine_run_against_minimal_project_produces_a_report_with_0_percent_match() {
    let project = fixture_project();
    // Clean slate: remove any dist/ and own-engine-output left over from a previous run so the
    // test is deterministic regardless of what ran before it.
    let _ = std::fs::remove_dir_all(project.join("dist"));
    let own_output_dir = project.join("_own_engine_dist");
    let _ = std::fs::remove_dir_all(&own_output_dir);
    let report_path = project.join("differential-report.md");
    let _ = std::fs::remove_file(&report_path);

    let config = TranspilerConfig::new(INSTALL_DIR, USER_DIR).with_timeout(Duration::from_secs(180));
    let harness = DifferentialHarness::new(config);
    let own_engine = StubEngine;

    let result = harness
        .run(&project, &own_engine, &own_output_dir)
        .expect("harness run should complete (reference transpiler + stub engine + comparison)");

    assert_eq!(result.reference_exit_code, Some(0), "the minimal fixture project must transpile successfully");
    assert!(result.reference_dir.is_dir(), "reference transpiler must have produced a dist/ tree");
    assert!(
        result.comparison.total_files > 0,
        "reference dist/ must contain at least one file for a meaningful comparison"
    );
    // StubEngine writes nothing, so every reference file is correctly reported as
    // "only in reference" - the honest, expected starting point (role definition §Ziel/1).
    assert_eq!(result.comparison.matches, 0);
    assert_eq!(result.comparison.mismatches, 0);
    assert_eq!(result.comparison.only_in_reference, result.comparison.total_files);
    assert_eq!(result.comparison.match_rate_percent(), 0.0);
    assert!(!result.comparison.is_perfect_match());

    let run_report = differential_harness::RunReport {
        project_home: &project,
        reference_dir: &result.reference_dir,
        own_dir: &result.own_dir,
        own_engine_name: own_engine.name(),
        reference_exit_code: result.reference_exit_code,
        comparison: &result.comparison,
        max_listed_diffs: 50,
    };
    differential_harness::write_report(&run_report, &report_path).expect("report must be writable");
    let written = std::fs::read_to_string(&report_path).expect("report file must exist after write_report");
    assert!(written.contains("Match rate: 0.00%"));
    assert!(written.contains("NOT MET"));
}
