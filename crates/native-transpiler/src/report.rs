// Human-readable Markdown report for one harness run, written to disk so later P5 agents
// (`resolver-engine` etc.) can track engine progress across runs without re-running the harness
// themselves - a plain diff of two report files already shows whether the match rate improved.

use crate::compare::{ComparisonReport, FileVerdict};
use std::io::Write;
use std::path::Path;

pub struct RunReport<'a> {
    pub project_home: &'a Path,
    pub reference_dir: &'a Path,
    pub own_dir: &'a Path,
    pub own_engine_name: &'a str,
    pub reference_exit_code: Option<i32>,
    pub comparison: &'a ComparisonReport,
    /// Cap on how many mismatch/only-in-* entries are listed in full; the rest are only
    /// counted, to keep the report readable (and cheap to load into an agent's context) even
    /// against a corpus project with thousands of files.
    pub max_listed_diffs: usize,
}

pub fn render_markdown(report: &RunReport) -> String {
    let mut out = String::new();
    let c = report.comparison;

    out.push_str("# Differential Harness Report\n\n");
    out.push_str(&format!("- Project: `{}`\n", report.project_home.display()));
    out.push_str(&format!("- Reference (official transpiler) dist: `{}`\n", report.reference_dir.display()));
    out.push_str(&format!("- Reference exit code: `{:?}`\n", report.reference_exit_code));
    out.push_str(&format!("- Own engine: `{}`\n", report.own_engine_name));
    out.push_str(&format!("- Own engine output: `{}`\n\n", report.own_dir.display()));

    out.push_str("## Summary\n\n");
    out.push_str(&format!("- Total files compared (union of both trees): {}\n", c.total_files));
    out.push_str(&format!("- Match: {}\n", c.matches));
    out.push_str(&format!("- Mismatch: {}\n", c.mismatches));
    out.push_str(&format!("- Only in reference: {}\n", c.only_in_reference));
    out.push_str(&format!("- Only in own engine: {}\n", c.only_in_own));
    out.push_str(&format!("- **Match rate: {:.2}%**\n", c.match_rate_percent()));
    out.push_str(&format!(
        "- Engine switch gate (chef prompt §2.4, zero deviations required): {}\n\n",
        if c.is_perfect_match() { "PASS" } else { "NOT MET" }
    ));

    let diffs: Vec<&crate::compare::FileComparison> =
        c.files.iter().filter(|f| !matches!(f.verdict, FileVerdict::Match)).collect();

    if diffs.is_empty() {
        out.push_str("## Deviations\n\nNone.\n");
    } else {
        out.push_str(&format!(
            "## First {} deviation(s) (of {} total)\n\n",
            diffs.len().min(report.max_listed_diffs),
            diffs.len()
        ));
        out.push_str("| Path | Verdict |\n|---|---|\n");
        for f in diffs.iter().take(report.max_listed_diffs) {
            let verdict_str = match &f.verdict {
                FileVerdict::Match => unreachable!("filtered out above"),
                FileVerdict::Mismatch { first_diff_byte, reference_len, own_len } => {
                    format!("Mismatch (first differing byte at offset {first_diff_byte}, reference {reference_len}B, own {own_len}B)")
                }
                FileVerdict::OnlyInReference => "Only in reference".to_string(),
                FileVerdict::OnlyInOwn => "Only in own engine".to_string(),
            };
            out.push_str(&format!("| `{}` | {} |\n", f.relative_path, verdict_str));
        }
        if diffs.len() > report.max_listed_diffs {
            out.push_str(&format!("\n... and {} more, not listed.\n", diffs.len() - report.max_listed_diffs));
        }
    }

    out
}

pub fn write_report(report: &RunReport, path: &Path) -> std::io::Result<()> {
    let markdown = render_markdown(report);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::File::create(path)?;
    file.write_all(markdown.as_bytes())
}
