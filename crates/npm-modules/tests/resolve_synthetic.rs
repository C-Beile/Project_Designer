//! Synthetic resolver tests for failure paths that have no real example anywhere in the
//! `GitRepos_ADITO` corpus search (see `PROJECT/20_architecture/p3-module-graph-notes.md`):
//! a cyclic `dependencies` graph, and a diamond conflict with no `overrides` entry to save
//! it. Both fixtures under `tests/fixtures/synthetic_*` are hand-written, not derived from
//! any real project.

use std::path::{Path, PathBuf};

use module_graph::{resolve, ModuleGraphError};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// `@synthetic/a` <-> `@synthetic/b` reference each other's `dependencies` directly —
/// a hand-built cycle, since no cyclic `dependencies` graph was found anywhere in the real
/// corpus (`transpiler.md` §2).
#[test]
fn synthetic_cycle_is_detected_and_names_both_modules() {
    let err = resolve(&fixture("synthetic_cycle")).expect_err("cycle must be rejected");
    match err {
        ModuleGraphError::CyclicDependencies { cycle, display } => {
            assert!(cycle.contains(&"@synthetic/a".to_string()));
            assert!(cycle.contains(&"@synthetic/b".to_string()));
            assert!(display.contains("@synthetic/a"));
            assert!(display.contains("@synthetic/b"));
        }
        other => panic!("expected CyclicDependencies, got {other:?}"),
    }
}

/// The project directly requires `@synthetic/m@^2.0.0` (satisfied by the installed 2.0.0),
/// but `@synthetic/a`'s `peerDependencies` requires `@synthetic/m@^1.0.0`, which the
/// installed version violates. No project-root `overrides` entry exists to pick a winner —
/// this is the still-UNVERIFIED-in-the-real-corpus failure path (no real project was found
/// with a diamond conflict *and* no matching override), so it is exercised synthetically.
#[test]
fn synthetic_diamond_without_override_is_unresolved() {
    let err =
        resolve(&fixture("synthetic_unresolved_diamond")).expect_err("diamond must be rejected");
    match err {
        ModuleGraphError::UnresolvedDiamond {
            module,
            installed,
            conflicting,
            ..
        } => {
            assert_eq!(module, "@synthetic/m");
            assert_eq!(installed, "2.0.0");
            assert!(conflicting
                .iter()
                .any(|(requester, range)| requester == "@synthetic/a" && range == "^1.0.0"));
        }
        other => panic!("expected UnresolvedDiamond, got {other:?}"),
    }
}
