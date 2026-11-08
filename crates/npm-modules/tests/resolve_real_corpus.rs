//! Resolver acceptance tests against real ADITO project structures.
//!
//! Every fixture under `tests/fixtures/` (except the `synthetic_*` ones, covered in
//! `resolve_synthetic.rs`) is a read-only copy of a subset of `package.json` files taken
//! verbatim from a real checkout under `C:\Users\ClemensBeile\Desktop\GitRepos_ADITO`
//! (never modified, never written back to). See
//! `PROJECT/20_architecture/p3-module-graph-notes.md` for the full corpus-search protocol
//! and provenance of each fixture.

use std::path::{Path, PathBuf};

use module_graph::{resolve, PROJECT_NODE};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Real, shipped diamond conflict: `GitRepos_ADITO\Pichler`. The project root's `overrides`
/// pins `@aditosoftware/root` to `^5.0.1`; the installed `5.0.3` satisfies that but violates
/// the `^4.0.0` peerDependency range declared by `attribute`, `keyword`, and
/// `basic-base-serviceimplementation` — all three are silently overruled by the override.
#[test]
fn pichler_diamond_resolves_via_project_root_override() {
    let graph = resolve(&fixture("pichler_diamond")).expect("Pichler fixture must resolve");

    assert_eq!(graph.project.name, "@3hills-it/easescreen");

    for expected in [
        "@aditosoftware/platform",
        "@aditosoftware/root",
        "@aditosoftware/sharedalias",
        "@aditosoftware/attribute",
        "@aditosoftware/keyword",
        "@aditosoftware/basic-base-serviceimplementation",
    ] {
        assert!(
            graph.modules.contains_key(expected),
            "expected {expected} to be reachable from the project root"
        );
    }

    // `platform` and `basic-base-serviceimplementation` are direct project dependencies;
    // `attribute`/`keyword`/`root`/`sharedalias` are only reachable transitively through
    // `platform`, so they must NOT be direct edges of the synthetic project node.
    let project_edges = &graph.edges[PROJECT_NODE];
    assert!(project_edges.contains("@aditosoftware/platform"));
    assert!(project_edges.contains("@aditosoftware/basic-base-serviceimplementation"));
    assert!(!project_edges.contains("@aditosoftware/root"));

    assert_eq!(
        graph.diamonds_resolved_via_override.len(),
        1,
        "exactly one module (root) should need the override to resolve"
    );
    let diamond = &graph.diamonds_resolved_via_override[0];
    assert_eq!(diamond.module, "@aditosoftware/root");
    assert_eq!(diamond.installed, "5.0.3");
    assert_eq!(diamond.override_range, "^5.0.1");
    let violators: Vec<&str> = diamond
        .violated_requesters
        .iter()
        .map(|(requester, _)| requester.as_str())
        .collect();
    assert!(violators.contains(&"@aditosoftware/attribute"));
    assert!(violators.contains(&"@aditosoftware/keyword"));
    assert!(violators.contains(&"@aditosoftware/basic-base-serviceimplementation"));

    // `sharedalias` is also overridden on the project root but no reachable requester's
    // range actually conflicts with the installed 2.1.1 — it must not show up as a diamond.
    assert!(graph
        .diamonds_resolved_via_override
        .iter()
        .all(|d| d.module != "@aditosoftware/sharedalias"));
}

/// Real, conflict-free project: `GitRepos_ADITO\SVB`. All copied modules were installed at
/// mutually-compatible versions in the real checkout (root 6.0.0 across the board) — this
/// exercises the "no diamond" / plausible-graph path on real data, plus a real, large
/// `unresolved_external` set (SVB has ~80 `dependencies`, only 7 are copied into the fixture).
#[test]
fn svb_resolves_without_diamonds() {
    let graph = resolve(&fixture("svb_clean")).expect("SVB fixture must resolve");

    assert_eq!(graph.project.name, "@3hills-IT/svb");
    assert_eq!(graph.modules.len(), 7);
    assert!(
        graph.diamonds_resolved_via_override.is_empty(),
        "SVB's overrides block is empty and versions are consistent — no diamond expected"
    );
    assert!(
        !graph.unresolved_external.is_empty(),
        "most of SVB's ~80 real dependencies are intentionally not copied into the fixture"
    );
    // `root` is requested by the project itself and by several peerDependencies
    // (document, manager, keyword, attribute) — a real, multi-requester duplicate.
    assert!(graph
        .duplicates
        .iter()
        .any(|d| d.module == "@aditosoftware/root" && d.requesters.len() > 1));
}

/// Real, minimal project: `GitRepos_ADITO\thhit-adito-modules`. Both shipped modules only
/// depend on base modules (`root`, `utility`, ...) that this checkout does not itself
/// install — a real example of a project that relies entirely on the host project for its
/// base layer, exercising `unresolved_external` as the dominant case rather than the
/// exception.
#[test]
fn thhit_pos_modules_resolve_with_mostly_unresolved_externals() {
    let graph = resolve(&fixture("thhit_pos")).expect("thhit-adito-modules fixture must resolve");

    assert_eq!(graph.project.name, "@3hills-it/pos-distribution-listing");
    assert_eq!(graph.modules.len(), 2);
    assert!(graph.modules.contains_key("@3hills-it/pos-listing"));
    assert!(graph.modules.contains_key("@3hills-it/pos-distribution"));

    let expected_unresolved = [
        "@aditosoftware/root",
        "@aditosoftware/utility",
        "@aditosoftware/keyword",
        "@aditosoftware/sharedalias",
        "@aditosoftware/contact",
        "@aditosoftware/product",
        "@aditosoftware/task",
        "@aditosoftware/export",
    ];
    assert_eq!(graph.unresolved_external.len(), expected_unresolved.len());
    for name in expected_unresolved {
        assert!(
            graph.unresolved_external.contains(name),
            "expected {name} to be reported as unresolved-external"
        );
    }

    // Neither module is reachable from the other, so no diamond/duplicate bookkeeping
    // applies to the two modules actually present in this fixture.
    assert!(graph.diamonds_resolved_via_override.is_empty());
}
