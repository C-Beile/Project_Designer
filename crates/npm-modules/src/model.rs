//! Data model for a single npm-resolved ADITO module (`adito.type` in `package.json`).
//!
//! Field semantics are taken from `transpiler.md` §1, verified against the real corpus
//! under `GitRepos_ADITO` (see `PROJECT/20_architecture/p3-npm-modules-notes.md`):
//! `dependencies` is a real install requirement AND a traversal edge (npm resolves and
//! flattens it into `node_modules`), while `peerDependencies` is a compatibility
//! constraint only — it never drives installation, it just has to be satisfied by
//! whatever ends up installed. Both are treated as version *requests* against the named
//! module for diamond-conflict checking; only `dependencies` is walked for reachability.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use semver::Version;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::error::ModuleGraphError;

/// The two `adito.type` values observed across the corpus: exactly one `"project"` root
/// per checkout, every installed dependency under `node_modules/@aditosoftware/*` /
/// `@3hills-it/*` is `"module"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AditoType {
    Project,
    Module,
    /// The `adito` wrapper is absent or holds an unrecognized `type`. Kept as a variant
    /// instead of rejecting the file: the real corpus contains at least one counter-
    /// example (`GitRepos_ADITO\Pichler\node_modules\@aditosoftware\contactmanagement\package.json`)
    /// that has a top-level `"type": "module"` (Node's own ESM/CJS field) instead of the
    /// nested `adito.type` wrapper — a real data-quality quirk, not a hypothetical.
    Unknown,
}

/// One resolved module: identity, and the two dependency maps relevant to graph
/// resolution. `overrides` is carried on every definition because the real corpus shows
/// it can appear both on the project root and on an individual module
/// (`@aditosoftware/platform/package.json` in Pichler carries the same override block as
/// the project root) — only the project root's map is authoritative for resolution here
/// (matches plain npm `overrides` semantics), a module's own copy is not consulted by
/// `graph::resolve`.
#[derive(Debug, Clone)]
pub struct ModuleDefinition {
    pub name: String,
    pub version: Version,
    pub adito_type: AditoType,
    /// Raw `dependencies` version ranges — real install requirement, also the
    /// reachability/traversal edge.
    pub dependencies: BTreeMap<String, String>,
    /// Raw `peerDependencies` version ranges — compatibility-only, never traversed.
    pub peer_dependencies: BTreeMap<String, String>,
    /// Raw `overrides` version ranges, empty map if the field is absent or `{}`.
    pub overrides: BTreeMap<String, String>,
    /// Filesystem directory this module was read from (the `package.json`'s parent
    /// directory) — for the project root this is `project_root` itself, for an installed
    /// module it is its `node_modules/<scope>/<name>` directory. Added for the P5
    /// `resolver-engine` wiring: the pipeline's next stage (copy-phase) needs to know where
    /// each resolved module's files (`entity/`, `process/`, ...) actually live on disk, and
    /// this was previously discarded once `package.json` had been parsed. See
    /// `PROJECT/20_architecture/p5-resolver-engine-notes.md` for why this was added
    /// additively rather than during the original P3 build (not needed for pure resolution
    /// correctness, only for downstream pipeline use).
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct RawAdito {
    #[serde(default)]
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawPackageJson {
    name: String,
    version: String,
    #[serde(default)]
    adito: Option<RawAdito>,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
    #[serde(default, rename = "peerDependencies")]
    peer_dependencies: BTreeMap<String, String>,
    #[serde(default, deserialize_with = "deserialize_flat_overrides")]
    overrides: BTreeMap<String, String>,
}

/// Real-corpus regression found while running the `incremental` P5 harness against
/// `FZ_Juerlich`: `node_modules/eslint/package.json` uses npm's nested `overrides` shape
/// (`"overrides": { "@arethetypeswrong/core": { "fflate": "0.8.2" } }` - a per-dependency
/// override scoped to when that package is required BY the named package, not a blanket
/// pin), which a plain `BTreeMap<String, String>` cannot deserialize (it errors on the
/// nested map value). `graph::resolve`'s diamond rule only ever consults a FLAT, blanket
/// override (`project.overrides.get(module_name)` - a plain pinned version string), so a
/// nested entry would never have been actionable there anyway. Rather than guess at nested-
/// override resolution semantics (out of this crate's verified scope), this keeps the flat
/// entries and drops nested ones - permissive parsing instead of a hard failure that blocks
/// the whole module graph over an override shape nothing here interprets.
fn deserialize_flat_overrides<'de, D>(deserializer: D) -> Result<BTreeMap<String, String>, D::Error>
where
    D: Deserializer<'de>,
{
    let raw: BTreeMap<String, Value> = BTreeMap::deserialize(deserializer)?;
    Ok(raw
        .into_iter()
        .filter_map(|(name, value)| match value {
            Value::String(version) => Some((name, version)),
            _ => None,
        })
        .collect())
}

/// Reads and parses one `package.json` into a [`ModuleDefinition`].
pub fn parse_package_json(path: &Path) -> Result<ModuleDefinition, ModuleGraphError> {
    let raw_text = fs::read_to_string(path).map_err(|source| ModuleGraphError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let raw: RawPackageJson =
        serde_json::from_str(&raw_text).map_err(|source| ModuleGraphError::Json {
            path: path.to_path_buf(),
            source,
        })?;
    let version = Version::parse(&raw.version).map_err(|source| ModuleGraphError::InvalidVersion {
        path: path.to_path_buf(),
        raw: raw.version.clone(),
        source,
    })?;
    let adito_type = match raw.adito.and_then(|a| a.r#type) {
        Some(t) if t == "project" => AditoType::Project,
        Some(t) if t == "module" => AditoType::Module,
        _ => AditoType::Unknown,
    };
    let module_dir = path.parent().unwrap_or(path).to_path_buf();
    Ok(ModuleDefinition {
        name: raw.name,
        version,
        adito_type,
        dependencies: raw.dependencies,
        peer_dependencies: raw.peer_dependencies,
        overrides: raw.overrides,
        path: module_dir,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn write_package_json(dir: &Path, contents: &str) -> PathBuf {
        let path = dir.join("package.json");
        fs::write(&path, contents).expect("failed to write test fixture");
        path
    }

    #[test]
    fn parses_project_type_and_overrides() {
        let dir = tempdir();
        let path = write_package_json(
            dir.path(),
            r#"{
                "name": "@3hills-it/easescreen",
                "version": "1.6.4",
                "adito": { "type": "project" },
                "dependencies": { "@aditosoftware/platform": "^5.0.0" },
                "overrides": { "@aditosoftware/root": "^5.0.1" }
            }"#,
        );
        let module = parse_package_json(&path).expect("must parse");
        assert_eq!(module.adito_type, AditoType::Project);
        assert_eq!(
            module.overrides.get("@aditosoftware/root"),
            Some(&"^5.0.1".to_string())
        );
        assert_eq!(module.path, dir.path());
    }

    /// Real corpus quirk (`GitRepos_ADITO\Pichler\node_modules\@aditosoftware\contactmanagement\package.json`):
    /// top-level `"type": "module"` (Node's own ESM/CJS field) with no `adito` wrapper at
    /// all — must parse as `AditoType::Unknown`, not error out and not be confused with the
    /// nested `adito.type` field.
    #[test]
    fn missing_adito_wrapper_parses_as_unknown_type() {
        let dir = tempdir();
        let path = write_package_json(
            dir.path(),
            r#"{
                "name": "@aditosoftware/contactmanagement",
                "version": "2.0.0",
                "type": "module",
                "overrides": {}
            }"#,
        );
        let module = parse_package_json(&path).expect("must parse despite missing adito wrapper");
        assert_eq!(module.adito_type, AditoType::Unknown);
    }

    /// Real corpus regression (`FZ_Juerlich\node_modules\eslint\package.json`): a nested,
    /// per-dependency `overrides` entry must not fail parsing of the whole `package.json` -
    /// it is dropped (not consulted by the flat diamond rule anyway), while a sibling FLAT
    /// override entry in the same block still parses correctly.
    #[test]
    fn nested_override_entry_is_dropped_but_does_not_fail_parsing() {
        let dir = tempdir();
        let path = write_package_json(
            dir.path(),
            r#"{
                "name": "eslint",
                "version": "9.0.0",
                "overrides": {
                    "@aditosoftware/root": "^5.0.1",
                    "@arethetypeswrong/core": { "fflate": "0.8.2" }
                }
            }"#,
        );
        let module = parse_package_json(&path).expect("nested override entry must not fail parsing");
        assert_eq!(module.overrides.get("@aditosoftware/root"), Some(&"^5.0.1".to_string()));
        assert_eq!(module.overrides.get("@arethetypeswrong/core"), None, "nested override shape is dropped, not guessed at");
    }

    /// Minimal cross-platform temp dir helper (avoids pulling in a `tempfile` dev-dependency
    /// for two small tests).
    fn tempdir() -> TempDir {
        TempDir::new()
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "npm-modules-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            path.push(unique);
            fs::create_dir_all(&path).expect("failed to create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
