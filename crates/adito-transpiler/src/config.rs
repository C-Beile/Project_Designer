// Configuration for one TranspilerCLI invocation: which installation to launch, which
// scratch profile to run it under, and how long to wait before the watchdog steps in.
//
// Business background: the official ADITO Designer install ships no dedicated
// "ADITOtranspiler.exe" launcher. The generic NetBeans platform launcher (nbexec64.exe)
// reproduces the effect of config\ADITOtranspiler.conf/.clusters when given the right
// cluster list on its own command line (verified in
// PROJECT/30_spec/official-transpiler-invocation.md). That cluster list, the JDK location
// and the scratch userdir/cachedir are exactly the moving parts a caller needs to vary
// (e.g. a different Designer version, a different scratch profile), so they live here
// rather than as crate-level constants.

use crate::layout;
use std::path::PathBuf;
use std::time::Duration;

// Mirrors config\ADITOtranspiler.clusters: the cluster set containing the "modular"
// cluster, which is where the TranspilerCLI module itself lives. The shipped
// Designer/Deploy/Database/Tasks cluster lists do not include it.
pub const DEFAULT_CLUSTER_SUBDIRS: [&str; 6] = [
    "lib/designer/aditoonline",
    "lib/designer/modular",
    "lib/designer/extra",
    "lib/designer/ide",
    "lib/designer/ireport",
    "lib/designer/platform",
];

// Safety net for a hung TranspilerCLI process (observed once during the P2 spike). No
// stdout/stderr progress for this long means the run is stuck, not just slow.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

/// Everything `NbexecTranspilerRunner` needs to build the launcher command line for one
/// project. `install_dir` and `user_dir` are always caller-supplied paths, never fixed
/// constants here — the install tree is read-only project infrastructure, and the userdir
/// is a caller-owned scratch profile the crate must never guess at (see
/// `spike-transpiler-wrapper.md`: the userdir must already carry the
/// `de.adito.aditoweb.nbm.nodejs` plugin seed, which is a setup concern outside this crate).
#[derive(Clone, Debug)]
pub struct TranspilerConfig {
    /// Root of the ADITO Designer installation. Read-only; never written to.
    pub install_dir: PathBuf,
    /// Scratch userdir/cachedir root for this run. Must never be the real interactive
    /// designer userdir (that one is off-limits: read-only for this task and owned by the
    /// running Designer's own profile/locks).
    pub user_dir: PathBuf,
    /// Kill the process tree if no exit has happened after this long.
    pub timeout: Duration,
    /// Cluster subdirectories (relative to `install_dir`) passed via `--clusters`.
    pub cluster_subdirs: Vec<String>,
}

impl TranspilerConfig {
    pub fn new(install_dir: impl Into<PathBuf>, user_dir: impl Into<PathBuf>) -> Self {
        let install_dir = install_dir.into();
        // A macOS app bundle keeps the installation below Contents/Resources; resolved here once.
        let install_dir = layout::designer_root(&install_dir).unwrap_or(install_dir);
        Self {
            install_dir,
            user_dir: user_dir.into(),
            timeout: DEFAULT_TIMEOUT,
            cluster_subdirs: DEFAULT_CLUSTER_SUBDIRS.iter().map(|s| s.to_string()).collect(),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub(crate) fn nbexec_path(&self) -> PathBuf {
        layout::launcher_path(&self.install_dir)
    }

    pub(crate) fn jdkhome(&self) -> PathBuf {
        layout::jdk_home(&self.install_dir)
    }

    pub(crate) fn cachedir(&self) -> PathBuf {
        layout::join_rel(&self.user_dir, "var/cache")
    }

    pub(crate) fn clusters_arg(&self) -> String {
        self.cluster_subdirs
            .iter()
            .map(|sub| layout::join_rel(&self.install_dir, sub).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(layout::CLUSTER_SEPARATOR)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn clusters_arg_joins_all_six_default_subdirs_with_semicolons() {
        let config = TranspilerConfig::new(r"C:\install", r"C:\scratch\userdir");
        let arg = config.clusters_arg();
        assert_eq!(arg.matches(';').count(), 5);
        assert!(arg.contains(r"C:\install\lib\designer\modular"));
    }

    #[cfg(not(windows))]
    #[test]
    fn clusters_arg_joins_all_six_default_subdirs_with_colons() {
        let config = TranspilerConfig::new("/install", "/scratch/userdir");
        let arg = config.clusters_arg();
        assert_eq!(arg.matches(':').count(), 5);
        assert!(arg.contains("/install/lib/designer/modular"));
    }

    #[cfg(windows)]
    #[test]
    fn cachedir_and_jdkhome_are_derived_from_their_roots() {
        let config = TranspilerConfig::new(r"C:\install", r"C:\scratch\userdir");
        assert_eq!(config.cachedir(), PathBuf::from(r"C:\scratch\userdir\var\cache"));
        assert_eq!(config.jdkhome(), PathBuf::from(r"C:\install\jre"));
    }
}
