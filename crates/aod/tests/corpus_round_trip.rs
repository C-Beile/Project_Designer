//! Round-trip property test over a real-project corpus (the actual proof this crate exists to
//! deliver — see the crate root docs and `PROJECT/20_architecture/p3-aod-io-notes.md`).
//!
//! Fixture files under `tests/fixtures/` are copies of real `.aod` files from
//! `C:\Users\ClemensBeile\Desktop\GitRepos_ADITO\` (read-only source, nothing written there —
//! per the aod::document role's scope guardrail). 124 files across 5 projects (Hermes, Pichler, SVB,
//! FFG, Vendira_basic), spanning entity, neonView, neonContext, neonDashboard, aliasDefinition,
//! language, process, role, system, modification and application object types — comfortably
//! above the 40-file / 3-project acceptance bar, and roughly 1.6x the P2 spike's 76-file corpus.

use std::path::Path;
use walkdir::WalkDir;

/// Every fixture file must load (`aod::document::parse`) and re-save (`aod::document::serialize`)
/// byte-identical to its original bytes, with no edits applied — this is what proves
/// `AodDocument`'s event-stream representation captures the full file, including every
/// formatting quirk (CRLF, no BOM, irregular `customProperties` indentation, ...), without
/// needing to understand or reproduce those quirks explicitly.
#[test]
fn corpus_round_trip_is_byte_identical() {
    let fixtures_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    assert!(
        fixtures_dir.exists(),
        "fixtures dir not found at {fixtures_dir:?} — copy sample .aod files first"
    );

    let mut checked = 0usize;
    let mut projects = std::collections::HashSet::new();
    let mut failures = Vec::new();

    for entry in WalkDir::new(&fixtures_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("aod") {
            continue;
        }
        checked += 1;
        if let Ok(rel) = path.strip_prefix(&fixtures_dir) {
            if let Some(project) = rel.components().next() {
                projects.insert(project.as_os_str().to_owned());
            }
        }

        let bytes = std::fs::read(path).expect("read fixture file");
        if let Err(reason) = aod::document::round_trip_check(&bytes) {
            failures.push(format!("{}: {}", path.display(), reason));
        }
    }

    assert!(
        checked >= 40,
        "expected at least 40 fixture files, found {checked}"
    );
    assert!(
        projects.len() >= 3,
        "expected files from at least 3 projects, found {}",
        projects.len()
    );

    if !failures.is_empty() {
        panic!(
            "{}/{} fixture files failed byte-identical round-trip:\n{}",
            failures.len(),
            checked,
            failures.join("\n\n")
        );
    }

    println!(
        "PASS: {checked} fixture files across {} projects round-tripped byte-identical",
        projects.len()
    );
}

/// The `customProperties`-under-`entityFieldDb` indentation irregularity (aod-format.md #1.2)
/// is exactly the kind of quirk a byte-preserving design must round-trip without special-casing
/// it in the reader/writer — this test isolates that one file so a regression there fails with
/// a specific, easy-to-find name instead of only showing up as one anonymous entry in the
/// corpus sweep above.
#[test]
fn custom_properties_quirk_file_round_trips_byte_identical() {
    let fixtures_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let quirk_file = fixtures_dir
        .join("Hermes/aliasDefinition/THHIT_Data_alias/THHIT_Data_alias.aod");
    assert!(
        quirk_file.exists(),
        "expected fixture {quirk_file:?} (flagged in aod-format.md #1.2 for irregular \
         customProperties indentation) to be present"
    );
    let bytes = std::fs::read(&quirk_file).expect("read quirk fixture");
    assert!(
        bytes.windows(b"customProperties".len()).any(|w| w == b"customProperties"),
        "fixture no longer contains a customProperties block — quirk test would be vacuous"
    );
    aod::document::round_trip_check(&bytes).expect("byte-identical round trip of customProperties quirk file");
}
