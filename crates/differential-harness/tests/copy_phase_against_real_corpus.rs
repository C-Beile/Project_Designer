// Integration test for the copy-phase stage (role brief requirement: "Copy-Phase gegen ein
// reales, kleines Modul aus dem Korpus, Ergebnis mit dem entsprechenden Teil des echten dist/
// byteweise vergleichen für die unmodifizierten Anteile"). Uses the already-prepared Hermes
// scratch corpus copy (`_scratch/p5-differential-harness/corpus/Hermes`, produced by the
// `differential-harness` agent's own earlier real run - not GitRepos_ADITO, which stays
// strictly read-only per the chef prompt) as the real module source, and the reference `dist/`
// that same corpus copy already carries from the official-transpiler run done during that
// earlier round.
//
// Deliberately does NOT invoke the reference transpiler subprocess itself (unlike
// `full_harness_run.rs`) - this only needs module resolution plus a filesystem copy, both fast
// and side-effect-free against the read-only-by-convention scratch corpus, so it runs as a
// normal `cargo test` rather than a documented manual step.
//
// Skips (rather than fails) if the scratch corpus is not present on this machine - it is a
// large, separately-prepared fixture (~18k files) that is not checked into the repo.

use differential_harness::run_copy_phase;
use std::path::{Path, PathBuf};

fn hermes_corpus() -> PathBuf {
    PathBuf::from(r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\_scratch\p5-differential-harness\corpus\Hermes")
}

#[test]
fn copy_phase_matches_real_dist_for_unmodified_resource_operation_files() {
    let project_home = hermes_corpus();
    let reference_dist = project_home.join("dist");
    if !project_home.exists() || !reference_dist.exists() {
        eprintln!(
            "skipping: Hermes scratch corpus not present at {} (large externally-prepared fixture, not checked into the repo)",
            project_home.display()
        );
        return;
    }

    let graph = module_graph::resolve(&project_home).expect("module resolution must succeed against the real Hermes corpus");

    let output_dir = std::env::temp_dir().join(format!(
        "copy-phase-corpus-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let report = run_copy_phase(&graph, &output_dir).expect("copy phase must succeed against the real corpus");
    assert!(report.files_copied > 10_000, "expected the full corpus copy to produce a large number of files, got {}", report.files_copied);

    // Files known (from this agent's own corpus verification, see p5-copy-phase-notes.md) to
    // be untouched by both modification and linked-file inlining - real evidence, not a
    // synthetic guess, so a byte mismatch here is a genuine regression.
    let untouched_relative_paths = [
        "entity/ResourceOperationLink_entity/ResourceOperationLink_entity.aod",
        "entity/ResourceOperationLink_entity/documentation.adoc",
        "entity/ResourceOperationLink_entity/entityfields/date_edit/valueProcess.js",
        "entity/OpenRouteRessourceSelection_entity/OpenRouteRessourceSelection_entity.aod",
    ];

    for rel in untouched_relative_paths {
        let own_bytes = std::fs::read(output_dir.join(rel))
            .unwrap_or_else(|e| panic!("own engine output missing {rel}: {e}"));
        let reference_bytes = std::fs::read(reference_dist.join(rel))
            .unwrap_or_else(|e| panic!("reference dist missing {rel}: {e}"));
        assert_eq!(
            own_bytes, reference_bytes,
            "expected byte-exact match for untouched file {rel} (own engine output at {})",
            output_dir.join(rel).display()
        );
    }

    // Sanity check on the KNOWN-modified/linked-file counterpart in the same module: this one
    // is expected to still MISMATCH at this stage (modification application + linked-file
    // inlining are later pipeline stages) - asserting that keeps this test honest about scope
    // rather than silently passing if a future change accidentally started matching it for the
    // wrong reason (e.g. a bug that makes everything match).
    let known_still_mismatching = Path::new("entity/ResourceOperation_entity/ResourceOperation_entity.aod");
    let own_bytes = std::fs::read(output_dir.join(known_still_mismatching)).expect("own engine must still produce this file");
    let reference_bytes = std::fs::read(reference_dist.join(known_still_mismatching)).expect("reference dist must have this file");
    assert_ne!(
        own_bytes, reference_bytes,
        "ResourceOperation_entity.aod carries a MODIFY modification and linked-file references - it is expected to still differ at the copy-phase stage; a match here would mean this test's scope assumption is stale"
    );

    std::fs::remove_dir_all(&output_dir).ok();
}
