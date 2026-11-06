//! Module-graph resolution: builds the full dependency graph for an ADITO project
//! checkout, detects cycles, and resolves/flags diamond version conflicts.
//!
//! ## Traversal vs. validation (verified against real corpus data)
//!
//! `dependencies` is npm's real install requirement — it is what actually gets resolved
//! into `node_modules`, and it is the edge this resolver walks to discover the reachable
//! module set. `peerDependencies` is a compatibility constraint only: real ADITO "feature"
//! modules (e.g. `@aditosoftware/correspondence`, `@aditosoftware/keyword`,
//! `@aditosoftware/basic-base-serviceimplementation` in the Pichler corpus) declare
//! `peerDependencies` on `@aditosoftware/root` etc. without ever listing a `dependencies`
//! entry of their own — they rely on some *other* module's `dependencies` chain (e.g.
//! `@aditosoftware/platform`'s own `dependencies`) to actually pull the peer in. Both
//! `dependencies` and `peerDependencies` ranges are therefore checked as version
//! *requests* against whatever ends up installed, but only `dependencies` edges are
//! followed for reachability.
//!
//! ## Diamond resolution (verified)
//!
//! `GitRepos_ADITO\Pichler\package.json` (adito.type "project", `@3hills-it/easescreen`)
//! declares a non-empty `overrides` block pinning `@aditosoftware/root` to `^5.0.1` and
//! `@aditosoftware/sharedalias` to `^2.0.0`. The installed `@aditosoftware/root` is
//! `5.0.3` — which satisfies that override, but violates the `^4.0.0` peerDependency
//! range declared by several real modules in the same corpus (`keyword`, `attribute`,
//! `basic-base-serviceimplementation`, and more — see
//! `PROJECT/20_architecture/p3-module-graph-notes.md` for the full list). This is a real,
//! shipped diamond conflict, and it is resolved purely in favor of the `overrides` entry,
//! with the conflicting peerDependency requesters silently overruled. That confirms the
//! rule this resolver implements: an `overrides` entry unconditionally wins over any
//! number of incompatible `dependencies`/`peerDependencies` requests for the same module
//! name, once the override's own range is itself satisfied by the installed version.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::Path;

use semver::{Version, VersionReq};

use crate::error::ModuleGraphError;
use crate::model::{parse_package_json, ModuleDefinition};

/// Synthetic node name for the project root in [`ModuleGraph::edges`] — never a valid npm
/// package name (no npm name can contain `<`/`>`), so it cannot collide with a real module.
pub const PROJECT_NODE: &str = "<project>";

/// A fully resolved module graph for one ADITO project checkout.
#[derive(Debug)]
pub struct ModuleGraph {
    pub project: ModuleDefinition,
    /// Every module reachable from the project's `dependencies`, transitively through
    /// each reached module's own `dependencies`, keyed by name.
    pub modules: BTreeMap<String, ModuleDefinition>,
    /// Outgoing `dependencies` edges per module name, including the synthetic
    /// [`PROJECT_NODE`] root, for callers that want to walk the graph themselves.
    pub edges: BTreeMap<String, BTreeSet<String>>,
    /// Names referenced via `dependencies`/`peerDependencies` with no corresponding
    /// folder under `node_modules` — reported, not an error: real corpus projects only
    /// ship a subset of node_modules in some checkouts/fixtures, and a `peerDependencies`
    /// entry in particular is not a hard installation requirement.
    pub unresolved_external: BTreeSet<String>,
    /// Modules requested (via `dependencies` or `peerDependencies`) by more than one
    /// distinct requester — `DuplicateDependenciesFinder`-equivalent. Purely informational.
    pub duplicates: Vec<DuplicateReport>,
    /// Diamond conflicts (installed version violates at least one requester's range) that
    /// were resolved because the project root's `overrides` pinned a winning version.
    pub diamonds_resolved_via_override: Vec<DiamondResolution>,
}

#[derive(Debug, Clone)]
pub struct DuplicateReport {
    pub module: String,
    pub requesters: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct DiamondResolution {
    pub module: String,
    pub installed: String,
    pub override_range: String,
    /// Requesters whose declared range the installed version actually violates, silently
    /// overruled by the `overrides` entry.
    pub violated_requesters: Vec<(String, String)>,
}

/// (requester module name, or [`PROJECT_NODE`]; target module name; raw version range)
type Request = (String, String, String);

/// Resolves the full module graph for the ADITO project checkout rooted at
/// `project_root` (must contain `package.json` and, for any real dependency, a sibling
/// `node_modules` directory).
pub fn resolve(project_root: &Path) -> Result<ModuleGraph, ModuleGraphError> {
    resolve_with(project_root, true)
}

/// Like [`resolve`], for showing a project in the Designer: one unreadable `package.json` among the installed
/// modules, a dependency cycle or a version that does not match a requested range no longer hides every module. The
/// affected module is skipped or kept as it is; only the project's own `package.json` must be readable.
pub fn resolve_lenient(project_root: &Path) -> Result<ModuleGraph, ModuleGraphError> {
    resolve_with(project_root, false)
}

fn resolve_with(project_root: &Path, strict: bool) -> Result<ModuleGraph, ModuleGraphError> {
    let project = parse_package_json(&project_root.join("package.json"))?;
    let installed = scan_node_modules(&project_root.join("node_modules"), strict)?;

    let mut edges: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut reachable: BTreeMap<String, ModuleDefinition> = BTreeMap::new();
    let mut unresolved_external: BTreeSet<String> = BTreeSet::new();
    let mut requests: Vec<Request> = Vec::new();

    let mut queue: VecDeque<String> = VecDeque::new();
    let mut enqueued: HashSet<String> = HashSet::new();

    // Seed with the project's own `dependencies` — both a traversal edge and a request.
    for (name, raw_range) in &project.dependencies {
        requests.push((PROJECT_NODE.to_string(), name.clone(), raw_range.clone()));
        edges
            .entry(PROJECT_NODE.to_string())
            .or_default()
            .insert(name.clone());
        if installed.contains_key(name) {
            if enqueued.insert(name.clone()) {
                queue.push_back(name.clone());
            }
        } else {
            unresolved_external.insert(name.clone());
        }
    }

    // Also record the project's own `peerDependencies` (rare on a project root, but the
    // schema allows it) as requests without further traversal semantics of their own.
    for (name, raw_range) in &project.peer_dependencies {
        requests.push((PROJECT_NODE.to_string(), name.clone(), raw_range.clone()));
        if !installed.contains_key(name) {
            unresolved_external.insert(name.clone());
        }
    }

    while let Some(name) = queue.pop_front() {
        let module = installed
            .get(&name)
            .expect("only names confirmed present in `installed` are ever queued")
            .clone();

        // Traversal: only `dependencies` edges are walked further.
        for (dep_name, raw_range) in &module.dependencies {
            requests.push((name.clone(), dep_name.clone(), raw_range.clone()));
            edges.entry(name.clone()).or_default().insert(dep_name.clone());
            if installed.contains_key(dep_name) {
                if enqueued.insert(dep_name.clone()) {
                    queue.push_back(dep_name.clone());
                }
            } else {
                unresolved_external.insert(dep_name.clone());
            }
        }

        // Validation only: `peerDependencies` never add a traversal edge.
        for (dep_name, raw_range) in &module.peer_dependencies {
            requests.push((name.clone(), dep_name.clone(), raw_range.clone()));
            if !installed.contains_key(dep_name) {
                unresolved_external.insert(dep_name.clone());
            }
        }

        reachable.insert(name, module);
    }

    let (duplicates, diamonds) = if strict {
        detect_cycles(&edges)?;
        analyze_requests(&project, &reachable, &requests)?
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(ModuleGraph {
        project,
        modules: reachable,
        edges,
        unresolved_external,
        duplicates,
        diamonds_resolved_via_override: diamonds,
    })
}

/// Scans a flat `node_modules` directory (scoped `@scope/name` and unscoped `name`
/// entries) for `package.json` files and parses each into a [`ModuleDefinition`], keyed
/// by the name declared *inside* the file (not the directory name) — the real corpus has
/// at least one scope-casing inconsistency (`@3hills-it` vs. `@3hills-IT` across
/// different projects), so the directory name is not a reliable identity.
fn scan_node_modules(dir: &Path, strict: bool) -> Result<HashMap<String, ModuleDefinition>, ModuleGraphError> {
    let mut modules = HashMap::new();
    if !dir.is_dir() {
        return Ok(modules);
    }
    for entry in read_dir_sorted(dir)? {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with('@') {
            let scoped = match read_dir_sorted(&entry.path()) {
                Ok(list) => list,
                Err(_) if !strict => continue,
                Err(e) => return Err(e),
            };
            for scoped_entry in scoped {
                match insert_if_package(&mut modules, &scoped_entry.path()) {
                    Err(_) if !strict => {}
                    other => other?,
                }
            }
        } else {
            match insert_if_package(&mut modules, &entry.path()) {
                Err(_) if !strict => {}
                other => other?,
            }
        }
    }
    Ok(modules)
}

fn insert_if_package(
    modules: &mut HashMap<String, ModuleDefinition>,
    module_dir: &Path,
) -> Result<(), ModuleGraphError> {
    let package_json = module_dir.join("package.json");
    if package_json.is_file() {
        let module = parse_package_json(&package_json)?;
        modules.insert(module.name.clone(), module);
    }
    Ok(())
}

fn read_dir_sorted(dir: &Path) -> Result<Vec<std::fs::DirEntry>, ModuleGraphError> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|source| ModuleGraphError::Io {
            path: dir.to_path_buf(),
            source,
        })?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    entries.sort_by_key(|e| e.file_name());
    Ok(entries)
}

/// DFS cycle detection over the `dependencies`-only edge set, starting from
/// [`PROJECT_NODE`]. Returns the first cycle found, module names in traversal order.
fn detect_cycles(edges: &BTreeMap<String, BTreeSet<String>>) -> Result<(), ModuleGraphError> {
    #[derive(Clone, Copy, PartialEq)]
    enum Color {
        White,
        Gray,
        Black,
    }

    fn visit<'a>(
        node: &'a str,
        edges: &'a BTreeMap<String, BTreeSet<String>>,
        colors: &mut HashMap<&'a str, Color>,
        path: &mut Vec<&'a str>,
    ) -> Result<(), ModuleGraphError> {
        colors.insert(node, Color::Gray);
        path.push(node);
        if let Some(children) = edges.get(node) {
            for child in children {
                let child = child.as_str();
                match colors.get(child).copied().unwrap_or(Color::White) {
                    Color::White => visit(child, edges, colors, path)?,
                    Color::Gray => {
                        let start = path
                            .iter()
                            .position(|n| *n == child)
                            .expect("gray node must be on the current path");
                        let mut cycle: Vec<String> =
                            path[start..].iter().map(|s| s.to_string()).collect();
                        cycle.push(child.to_string());
                        return Err(ModuleGraphError::cyclic(cycle));
                    }
                    Color::Black => {}
                }
            }
        }
        path.pop();
        colors.insert(node, Color::Black);
        Ok(())
    }

    if edges.contains_key(PROJECT_NODE) {
        let mut colors: HashMap<&str, Color> = HashMap::new();
        let mut path = Vec::new();
        visit(PROJECT_NODE, edges, &mut colors, &mut path)?;
    }
    Ok(())
}

/// Groups all `(requester, module, range)` requests by target module, computes
/// duplicates, and checks every request's range against the installed version — applying
/// the project's `overrides` when a conflict is found.
fn analyze_requests(
    project: &ModuleDefinition,
    reachable: &BTreeMap<String, ModuleDefinition>,
    requests: &[Request],
) -> Result<(Vec<DuplicateReport>, Vec<DiamondResolution>), ModuleGraphError> {
    let mut by_module: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for (requester, module, raw_range) in requests {
        if reachable.contains_key(module) {
            by_module
                .entry(module.clone())
                .or_default()
                .push((requester.clone(), raw_range.clone()));
        }
    }

    let mut duplicates = Vec::new();
    let mut diamonds = Vec::new();

    for (module_name, requesters) in &by_module {
        let distinct_requesters: BTreeSet<&str> =
            requesters.iter().map(|(r, _)| r.as_str()).collect();
        if distinct_requesters.len() > 1 {
            duplicates.push(DuplicateReport {
                module: module_name.clone(),
                requesters: distinct_requesters.into_iter().map(String::from).collect(),
            });
        }

        let installed_version = &reachable[module_name].version;
        let mut violated: Vec<(String, String)> = Vec::new();
        for (requester, raw_range) in requesters {
            let satisfies = version_satisfies(installed_version, raw_range).map_err(|source| {
                ModuleGraphError::InvalidRange {
                    module: module_name.clone(),
                    requester: requester.clone(),
                    raw: raw_range.clone(),
                    source,
                }
            })?;
            if !satisfies {
                violated.push((requester.clone(), raw_range.clone()));
            }
        }

        if violated.is_empty() {
            continue;
        }

        match project.overrides.get(module_name) {
            Some(override_range) => {
                diamonds.push(DiamondResolution {
                    module: module_name.clone(),
                    installed: installed_version.to_string(),
                    override_range: override_range.clone(),
                    violated_requesters: violated,
                });
            }
            None => {
                return Err(ModuleGraphError::unresolved_diamond(
                    module_name.clone(),
                    installed_version.to_string(),
                    violated,
                ));
            }
        }
    }

    Ok((duplicates, diamonds))
}

/// Matches `version` against a raw npm-style range, expanding `||`-separated
/// alternatives manually (the `semver` crate parses AND-style comparator sets but has no
/// built-in OR syntax) — real corpus ranges use it, e.g.
/// `"@aditosoftware/root": "^4.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0"` in
/// `GitRepos_ADITO\Pichler\node_modules\@aditosoftware\vertriebsdemo\package.json`.
fn version_satisfies(version: &Version, raw_range: &str) -> Result<bool, semver::Error> {
    for alternative in raw_range.split("||") {
        let alternative = alternative.trim();
        if alternative.is_empty() {
            continue;
        }
        if is_dist_tag(alternative) {
            return Ok(true);
        }
        let req = VersionReq::parse(&to_semver_crate_syntax(strip_stray_leading_at(alternative)))?;
        if req.matches(version) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// An npm dist-tag instead of a range. **Real-corpus finding** (P8 project tree, full Pichler):
/// `GitRepos_ADITO\Pichler\package.json` requests `"@aditosoftware/conversion-rate": "latest"`.
/// npm resolves a tag to whatever version the registry published under it, so whatever is
/// installed is by definition what the tag meant at install time - it cannot be violated.
fn is_dist_tag(alternative: &str) -> bool {
    alternative.starts_with(|c: char| c.is_ascii_alphabetic())
        && !alternative.eq_ignore_ascii_case("x")
        && alternative.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Strips one stray leading `@` from a version-range alternative. **Real-corpus finding**
/// (`resolver-engine` wiring round, full Hermes project, not covered by the smaller P3
/// fixture corpus): `GitRepos_ADITO\Hermes\node_modules\@aditosoftware\payment-term\package.json`
/// declares `"peerDependencies": { "@aditosoftware/attribute": "@>=3.0.0 <6.0.0", ... }` — a
/// leading `@` directly in front of the comparator, which is neither valid npm/node-semver
/// range syntax nor accepted by the `semver` crate (`unexpected character '@' while parsing
/// major version number`). A search of the ADITO-scoped (`@aditosoftware`/`@3hills-it`)
/// `package.json` files under Hermes's `node_modules` found exactly this one occurrence —
/// treated as an isolated authoring typo (most plausibly a copy-paste leftover from an
/// `npm install @aditosoftware/attribute@>=3.0.0` style command), not a second range syntax
/// to support generally. Stripping it and parsing the remainder as normal is safe here
/// because no other comparator character (`^`, `~`, `>=`, `<`, a bare version) legitimately
/// starts with `@` in npm ranges.
fn strip_stray_leading_at(alternative: &str) -> &str {
    alternative.strip_prefix('@').unwrap_or(alternative)
}

/// Rewrites one npm-style AND-comparator chain into the comma-separated syntax the
/// `semver` crate requires. **Real-corpus finding:** npm/node-semver AND-chains use a bare
/// space between comparators (`">=1.0.0 <1.2.0"`, verbatim from
/// `GitRepos_ADITO\thhit-adito-modules\node_modules\@3hills-it\pos-distribution\package.json`,
/// requested by the project root), while the `semver` crate only accepts a comma between
/// them (`">=1.0.0, <1.2.0"`) — passing the raw npm string through unchanged fails every
/// such range with `InvalidRange`, which this fixture caught as a genuine bug, not a
/// hypothetical.
///
/// **Second real-corpus finding** (`resolver-engine` wiring round, full Hermes project):
/// `GitRepos_ADITO\Hermes\node_modules\@aditosoftware\finance\package.json` declares
/// `"peerDependencies": { "@aditosoftware/utility": ">=2.0.0 < 6.0.0", ... }` — note the
/// extra space *inside* the second comparator, between `<` and `6.0.0`. A naive
/// whitespace-split-and-rejoin (the original implementation) tears that single comparator
/// into two tokens (`"<"` and `"6.0.0"`), producing the invalid `", <, 6.0.0"`. Fixed by
/// walking the whitespace-separated words and re-merging any word that is a bare comparator
/// operator (no digits of its own) with the word that follows it, before rejoining the
/// resulting comparator tokens with `", "`. This still handles the original
/// `">=1.0.0 <1.2.0"` case unchanged (neither word is a bare operator there). npm's separate
/// `"1.2.3 - 2.3.4"` hyphen-range syntax is not handled by this rewrite (not observed
/// anywhere in the corpus) and is left to fail loudly via `InvalidRange` rather than
/// silently mis-resolving.
fn to_semver_crate_syntax(alternative: &str) -> String {
    let words: Vec<&str> = alternative.split_whitespace().collect();
    let mut tokens: Vec<String> = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        let word = words[i];
        if is_bare_comparator_operator(word) && i + 1 < words.len() {
            tokens.push(format!("{word}{}", words[i + 1]));
            i += 2;
        } else {
            tokens.push(word.to_string());
            i += 1;
        }
    }
    tokens.join(", ")
}

/// True for an npm comparator operator with no version number attached to it yet (e.g. the
/// `"<"` in `"< 6.0.0"`) — every one of these operators can legally appear directly
/// concatenated with a version number (`"<6.0.0"`) elsewhere in the corpus, so a bare
/// occurrence unambiguously means "the space before the version number was kept".
fn is_bare_comparator_operator(word: &str) -> bool {
    matches!(word, ">" | ">=" | "<" | "<=" | "=" | "^" | "~")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real corpus request, verbatim from `GitRepos_ADITO\Pichler\package.json`.
    #[test]
    fn dist_tag_latest_is_satisfied_by_any_installed_version() {
        let version = Version::parse("1.2.3").unwrap();
        assert!(version_satisfies(&version, "latest").unwrap());
        assert!(version_satisfies(&version, "x").unwrap());
        assert!(!version_satisfies(&version, "^2.0.0").unwrap());
    }

    /// Real corpus range, verbatim from
    /// `GitRepos_ADITO\Pichler\node_modules\@aditosoftware\vertriebsdemo\package.json`.
    #[test]
    fn version_satisfies_handles_real_or_separated_range() {
        let version = Version::parse("6.0.0").unwrap();
        assert!(version_satisfies(&version, "^4.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0").unwrap());

        let version = Version::parse("5.0.0").unwrap();
        assert!(!version_satisfies(&version, "^4.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0").unwrap());
    }

    #[test]
    fn version_satisfies_rejects_invalid_range() {
        let version = Version::parse("1.0.0").unwrap();
        assert!(version_satisfies(&version, "not-a-range").is_err());
    }

    /// Real corpus range, verbatim from
    /// `GitRepos_ADITO\thhit-adito-modules\node_modules\@3hills-it\pos-distribution\package.json`
    /// (`@aditosoftware/product` there uses the same space-AND style). npm's bare-space
    /// AND-chain syntax, not `semver`'s comma-separated one — caught by the `thhit_pos`
    /// fixture test before this rewrite existed.
    #[test]
    fn version_satisfies_handles_real_space_separated_and_range() {
        let version = Version::parse("1.0.1").unwrap();
        assert!(version_satisfies(&version, ">=1.0.0 <1.2.0").unwrap());

        let version = Version::parse("1.2.0").unwrap();
        assert!(!version_satisfies(&version, ">=1.0.0 <1.2.0").unwrap());
    }

    /// Real corpus range, verbatim from
    /// `GitRepos_ADITO\Hermes\node_modules\@aditosoftware\payment-term\package.json`
    /// (`peerDependencies` on `@aditosoftware/attribute`) — found while wiring
    /// `resolver-engine` against the full Hermes project, not present in the smaller P3
    /// fixture corpus. A stray leading `@` in front of the comparator, previously rejected
    /// outright by the `semver` crate.
    #[test]
    fn version_satisfies_handles_real_stray_leading_at_range() {
        let version = Version::parse("4.0.0").unwrap();
        assert!(version_satisfies(&version, "@>=3.0.0 <6.0.0").unwrap());

        let version = Version::parse("6.0.0").unwrap();
        assert!(!version_satisfies(&version, "@>=3.0.0 <6.0.0").unwrap());
    }

    /// Real corpus range, verbatim from
    /// `GitRepos_ADITO\Hermes\node_modules\@aditosoftware\finance\package.json`
    /// (`peerDependencies` on `@aditosoftware/utility`) — extra whitespace between the `<`
    /// operator and its version number, which the original naive whitespace-split rewrite
    /// tore into two invalid tokens.
    #[test]
    fn version_satisfies_handles_real_space_after_operator_range() {
        let version = Version::parse("2.0.0").unwrap();
        assert!(version_satisfies(&version, ">=2.0.0 < 6.0.0").unwrap());

        let version = Version::parse("6.0.0").unwrap();
        assert!(!version_satisfies(&version, ">=2.0.0 < 6.0.0").unwrap());
    }
}

#[cfg(test)]
mod lenient_tests {
    use super::*;

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn one_broken_module_does_not_hide_the_others_in_the_lenient_resolution() {
        let root = std::env::temp_dir().join(format!("forge-lenient-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        write(&root.join("package.json"), r#"{"name":"p","version":"1.0.0","dependencies":{"@s/good":"^1.0.0","@s/old":"^2.0.0"}}"#);
        write(&root.join("node_modules/@s/good/package.json"), r#"{"name":"@s/good","version":"1.2.0"}"#);
        write(&root.join("node_modules/@s/old/package.json"), r#"{"name":"@s/old","version":"1.0.0"}"#);
        write(&root.join("node_modules/@s/broken/package.json"), "{ not json");
        assert!(resolve(&root).is_err());
        let graph = resolve_lenient(&root).unwrap();
        assert!(graph.modules.contains_key("@s/good"));
        assert!(graph.modules.contains_key("@s/old"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
