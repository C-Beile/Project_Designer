// Real-subprocess proof that this crate's NbexecTranspilerRunner reproduces both PASS
// criteria the P2 spike already established: exit 0 against a valid minimal project, exit
// 150 against a project without a resolvable ADITO project definition. Fixtures
// (tests/fixtures/testproject, tests/fixtures/testproject-broken) are copied from the spike;
// the scratch userdir (with the required de.adito.aditoweb.nbm.nodejs plugin seed, see
// spike-transpiler-wrapper.md) lives outside the crate under
// _scratch/p3-transpiler-wrapper/userdir, copied once from the spike's validated userdir.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use adito_transpiler::{EventSink, ExitOutcome, FailureReason, NbexecTranspilerRunner, TranspileEvent, TranspilerConfig, TranspilerRunner};

// Root of the read-only ADITO Designer installation used by every P2/P3 spike so far. Never
// written to by this crate.
const INSTALL_DIR: &str = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4";

const USER_DIR: &str = r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\_scratch\p3-transpiler-wrapper\userdir";

// Both real-subprocess tests in this file point nbexec64.exe at the SAME scratch userdir/
// cachedir (USER_DIR above - the one seeded with the required nodejs plugin per
// spike-transpiler-wrapper.md). The NetBeans platform launcher takes an exclusive lock on
// its userdir for the lifetime of the process; cargo's default test harness runs tests in
// the same binary on separate threads concurrently, so without serialization here the two
// tests race for that lock and the loser observes a garbage exit code instead of its real
// transpilation result. Confirmed by direct reproduction: each test passes reliably in
// isolation (cargo test <name>) but the second one to acquire the userdir fails with
// exit_code Some(-255) when both run in the same `cargo test` invocation. This mutex makes
// the two real subprocess runs mutually exclusive regardless of harness thread count, which
// is the actual constraint (one nbexec64.exe instance per userdir at a time) rather than an
// artifact of how the assertions are written.
fn real_subprocess_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}


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

fn fixture(name: &str) -> PathBuf {
    temp_copy_of(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name), name)
}

fn collecting_sink() -> (EventSink, Arc<Mutex<Vec<TranspileEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_for_sink = events.clone();
    let sink: EventSink = Arc::new(move |event| {
        events_for_sink.lock().unwrap().push(event);
    });
    (sink, events)
}

#[test]
fn valid_minimal_project_transpiles_successfully_with_exit_code_0() {
    let _guard = real_subprocess_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let config = TranspilerConfig::new(INSTALL_DIR, USER_DIR).with_timeout(Duration::from_secs(180));
    let runner = NbexecTranspilerRunner::new(config);
    let (sink, events) = collecting_sink();

    let outcome = runner
        .run(&fixture("testproject"), sink)
        .expect("wrapper-side setup must succeed (install dir / project dir both exist)");

    assert_eq!(outcome.exit_code, Some(0), "expected TRANSPILATION SUCCESSFUL / exit 0");
    assert_eq!(outcome.outcome, ExitOutcome::Success);
    assert!(outcome.is_success());

    // Note: the "TRANSPILATION SUCCESSFUL"/"Started Transpilation"/"Copying ... to target
    // folder" text lines only appear when TranspilerCLI is driven via the PowerShell
    // wrapper's ReadToEnd()-after-exit capture (see logs/valid-run4.log in the spike). Both
    // the spike's own direct Rust-subprocess reproduction (logs/rust-cli-valid.log) and this
    // crate's streaming reader stop at "Resolved definition" yet still report exit code 0 -
    // a real project directory (dist/) is produced either way. Exit code / ExitOutcome is
    // therefore the authoritative success signal here, matching the spike's own PASS
    // criterion; "Resolved definition" additionally proves the project was actually parsed
    // rather than short-circuited before doing any work.
    let events = events.lock().unwrap();
    assert!(
        events.iter().any(|event| matches!(
            event,
            TranspileEvent::Log { line, .. } if line.contains("Resolved definition")
        )),
        "expected a log line confirming the project definition was resolved, got: {events:#?}"
    );
    assert!(
        events.iter().any(|event| matches!(event, TranspileEvent::Done { exit_code: Some(0), .. })),
        "expected a Done event with exit_code 0, got: {events:#?}"
    );
}

#[test]
fn broken_project_fails_transpilation_with_exit_code_150() {
    let _guard = real_subprocess_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let config = TranspilerConfig::new(INSTALL_DIR, USER_DIR).with_timeout(Duration::from_secs(180));
    let runner = NbexecTranspilerRunner::new(config);
    let (sink, events) = collecting_sink();

    let outcome = runner
        .run(&fixture("testproject-broken"), sink)
        .expect("wrapper-side setup must succeed (install dir / project dir both exist)");

    assert_eq!(outcome.exit_code, Some(150), "expected TRANSPILATION FAILED / exit 150");
    assert_eq!(outcome.outcome, ExitOutcome::Failure(FailureReason::InvalidProject { code: 150 }));
    assert!(!outcome.is_success());

    let events = events.lock().unwrap();
    assert!(
        events.iter().any(|event| matches!(
            event,
            TranspileEvent::Log { line, .. } if line.contains("TRANSPILATION FAILED")
        )),
        "expected a log line containing TRANSPILATION FAILED, got: {events:#?}"
    );
}
