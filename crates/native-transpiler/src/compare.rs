// Recursive, byte-exact comparison of two directory trees (reference `dist/` vs. own-engine
// output). This is the actual safety mechanism (chef prompt §2.4): the engine switch is gated
// on this producing zero mismatches across the full corpus, so the comparison itself must be
// exact - no normalization, no whitespace tolerance, no "close enough".

use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum FileVerdict {
    Match,
    Mismatch { first_diff_byte: usize, reference_len: u64, own_len: u64 },
    OnlyInReference,
    OnlyInOwn,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileComparison {
    /// Path relative to the compared tree roots, forward-slash normalized so reports are
    /// stable across platforms.
    pub relative_path: String,
    pub verdict: FileVerdict,
}

#[derive(Clone, Debug, Serialize)]
pub struct ComparisonReport {
    pub total_files: usize,
    pub matches: usize,
    pub mismatches: usize,
    pub only_in_reference: usize,
    pub only_in_own: usize,
    pub files: Vec<FileComparison>,
}

impl ComparisonReport {
    /// Percentage of the union of both trees' files that matched byte-for-byte. 100.0 for two
    /// empty trees (vacuously identical) rather than NaN/0, so an empty-corpus edge case reads
    /// as "nothing to disagree about" instead of a false failure signal.
    pub fn match_rate_percent(&self) -> f64 {
        if self.total_files == 0 {
            100.0
        } else {
            (self.matches as f64 / self.total_files as f64) * 100.0
        }
    }

    pub fn is_perfect_match(&self) -> bool {
        self.mismatches == 0 && self.only_in_reference == 0 && self.only_in_own == 0
    }
}

/// Walks `reference_dir` and `own_dir` and compares every file that exists in either tree.
/// Directories themselves are not reported on - only leaf files, since that is what the
/// engine switch decision (chef prompt §2.4) is actually gated on.
pub fn compare_trees(reference_dir: &Path, own_dir: &Path) -> std::io::Result<ComparisonReport> {
    let reference_files = collect_relative_files(reference_dir)?;
    let own_files = collect_relative_files(own_dir)?;

    let mut all_paths: BTreeSet<PathBuf> = BTreeSet::new();
    all_paths.extend(reference_files.iter().cloned());
    all_paths.extend(own_files.iter().cloned());

    let mut files = Vec::with_capacity(all_paths.len());
    let mut matches = 0;
    let mut mismatches = 0;
    let mut only_in_reference = 0;
    let mut only_in_own = 0;

    for relative in all_paths {
        let in_reference = reference_files.contains(&relative);
        let in_own = own_files.contains(&relative);
        let relative_path = relative.to_string_lossy().replace('\\', "/");

        let verdict = match (in_reference, in_own) {
            (true, true) => {
                let reference_bytes = std::fs::read(reference_dir.join(&relative))?;
                let own_bytes = std::fs::read(own_dir.join(&relative))?;
                if reference_bytes == own_bytes {
                    matches += 1;
                    FileVerdict::Match
                } else {
                    mismatches += 1;
                    let first_diff_byte = reference_bytes
                        .iter()
                        .zip(own_bytes.iter())
                        .position(|(a, b)| a != b)
                        .unwrap_or_else(|| reference_bytes.len().min(own_bytes.len()));
                    FileVerdict::Mismatch {
                        first_diff_byte,
                        reference_len: reference_bytes.len() as u64,
                        own_len: own_bytes.len() as u64,
                    }
                }
            }
            (true, false) => {
                only_in_reference += 1;
                FileVerdict::OnlyInReference
            }
            (false, true) => {
                only_in_own += 1;
                FileVerdict::OnlyInOwn
            }
            (false, false) => unreachable!("path came from one of the two collected sets"),
        };

        files.push(FileComparison { relative_path, verdict });
    }

    Ok(ComparisonReport {
        total_files: files.len(),
        matches,
        mismatches,
        only_in_reference,
        only_in_own,
        files,
    })
}

fn collect_relative_files(root: &Path) -> std::io::Result<BTreeSet<PathBuf>> {
    let mut result = BTreeSet::new();
    if !root.is_dir() {
        return Ok(result);
    }
    collect_relative_files_into(root, root, &mut result)?;
    Ok(result)
}

fn collect_relative_files_into(root: &Path, current: &Path, out: &mut BTreeSet<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_relative_files_into(root, &path, out)?;
        } else if file_type.is_file() {
            let relative = path.strip_prefix(root).expect("path is under root by construction").to_path_buf();
            out.insert(relative);
        }
        // Symlinks are not expected in transpiler output trees; skipped rather than followed
        // to avoid infinite recursion on a malformed tree.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "native-transpiler-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn identical_trees_are_a_100_percent_match() {
        let reference = unique_temp_dir("identical-ref");
        let own = unique_temp_dir("identical-own");
        fs::write(reference.join("a.aod"), b"same content").unwrap();
        fs::write(own.join("a.aod"), b"same content").unwrap();
        fs::create_dir_all(reference.join("sub")).unwrap();
        fs::create_dir_all(own.join("sub")).unwrap();
        fs::write(reference.join("sub/b.aod"), b"also same").unwrap();
        fs::write(own.join("sub/b.aod"), b"also same").unwrap();

        let report = compare_trees(&reference, &own).unwrap();

        assert_eq!(report.total_files, 2);
        assert_eq!(report.matches, 2);
        assert_eq!(report.mismatches, 0);
        assert!(report.is_perfect_match());
        assert_eq!(report.match_rate_percent(), 100.0);
    }

    #[test]
    fn one_differing_byte_is_reported_as_a_mismatch_with_its_position() {
        let reference = unique_temp_dir("mismatch-ref");
        let own = unique_temp_dir("mismatch-own");
        fs::write(reference.join("a.aod"), b"abcXdef").unwrap();
        fs::write(own.join("a.aod"), b"abcYdef").unwrap();

        let report = compare_trees(&reference, &own).unwrap();

        assert_eq!(report.total_files, 1);
        assert_eq!(report.mismatches, 1);
        assert!(!report.is_perfect_match());
        match &report.files[0].verdict {
            FileVerdict::Mismatch { first_diff_byte, reference_len, own_len } => {
                assert_eq!(*first_diff_byte, 3);
                assert_eq!(*reference_len, 7);
                assert_eq!(*own_len, 7);
            }
            other => panic!("expected Mismatch, got {other:?}"),
        }
    }

    #[test]
    fn file_missing_from_own_tree_is_only_in_reference() {
        let reference = unique_temp_dir("missing-ref");
        let own = unique_temp_dir("missing-own");
        fs::write(reference.join("only_ref.aod"), b"reference only").unwrap();

        let report = compare_trees(&reference, &own).unwrap();

        assert_eq!(report.total_files, 1);
        assert_eq!(report.only_in_reference, 1);
        assert_eq!(report.matches, 0);
        assert_eq!(report.match_rate_percent(), 0.0);
        assert_eq!(report.files[0].verdict, FileVerdict::OnlyInReference);
    }

    #[test]
    fn file_present_only_in_own_tree_is_only_in_own() {
        let reference = unique_temp_dir("extra-ref");
        let own = unique_temp_dir("extra-own");
        fs::write(own.join("only_own.aod"), b"own only").unwrap();

        let report = compare_trees(&reference, &own).unwrap();

        assert_eq!(report.only_in_own, 1);
        assert_eq!(report.files[0].verdict, FileVerdict::OnlyInOwn);
    }

    #[test]
    fn two_empty_trees_are_vacuously_a_perfect_100_percent_match() {
        let reference = unique_temp_dir("empty-ref");
        let own = unique_temp_dir("empty-own");

        let report = compare_trees(&reference, &own).unwrap();

        assert_eq!(report.total_files, 0);
        assert!(report.is_perfect_match());
        assert_eq!(report.match_rate_percent(), 100.0);
    }
}
