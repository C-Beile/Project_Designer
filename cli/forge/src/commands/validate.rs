//! `forge validate` - opens a project's `.aod` file(s) through forge_core::open_project, converts
//! each node to plugin_kernel's placeholder `ProjectModel` shape via forge_core's own bridge
//! functions, and runs every `Validator` in forge_core::build_plugin_registry() against it
//! (architecture.md §2/§6: the same registry the later Tauri app consumes, so this subcommand's
//! result matches GUI validation exactly). No validation rule and no project-model logic lives
//! here - only the flattening from the nested value tree `ProjectHandle::value_at` hands back into
//! the flat node list `ProjectModel` expects, which is pure data reshaping, not a business rule.

use clap::Args;
use forge_core::core_model::{NodePath, PropertyValue};
use forge_core::plugin_kernel::{Diagnostic, ObjectType, ProjectModel, PropertyNode, Severity};
use forge_core::{build_plugin_registry, open_project, to_plugin_property_node};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Args)]
pub struct ValidateArgs {
    /// A single `.aod` file, or a directory scanned recursively for `.aod` files.
    #[arg(long)]
    project: PathBuf,
}

pub fn run(args: ValidateArgs) -> ExitCode {
    let files = match collect_aod_files(&args.project) {
        Ok(files) if !files.is_empty() => files,
        Ok(_) => {
            eprintln!("no .aod files found under {}", args.project.display());
            return ExitCode::FAILURE;
        }
        Err(err) => {
            eprintln!("could not scan {}: {err}", args.project.display());
            return ExitCode::FAILURE;
        }
    };

    let registry = build_plugin_registry();
    let mut had_error = false;
    let mut total_diagnostics = 0usize;

    for file in &files {
        let handle = match open_project(file) {
            Ok(handle) => handle,
            Err(err) => {
                eprintln!("{}: failed to open ({err})", file.display());
                had_error = true;
                continue;
            }
        };

        // The real object family (Entity/View/...) is not derivable from forge-core's current
        // schema-free projection (see p3-forge-core-integration-notes.md's open point on the
        // projector); the file stem is the one honest, non-fabricated label available here.
        let object_type = ObjectType::Other(
            file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        );

        let mut nodes = Vec::new();
        if let Some(root_value) = handle.value_at(&NodePath::root()) {
            collect_nodes(&NodePath::root(), root_value, &object_type, &mut nodes);
        }
        let model = ProjectModel::new(nodes);

        let diagnostics = registry.validate_project(&model);
        total_diagnostics += diagnostics.len();
        for diagnostic in &diagnostics {
            if diagnostic.severity == Severity::Error {
                had_error = true;
            }
            print_diagnostic(file, diagnostic);
        }
    }

    println!(
        "validated {} file(s) with {} registered validator(s): {} diagnostic(s)",
        files.len(),
        registry.validator_count(),
        total_diagnostics
    );

    if had_error {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn print_diagnostic(file: &Path, diagnostic: &Diagnostic) {
    let severity = match diagnostic.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "info",
    };
    match &diagnostic.path {
        Some(path) => println!("{}: {severity}: {} ({path})", file.display(), diagnostic.message),
        None => println!("{}: {severity}: {}", file.display(), diagnostic.message),
    }
}

/// Flattens the nested value tree `ProjectHandle::value_at(root)` hands back into the flat node
/// list `plugin_kernel::ProjectModel` expects (its own Validator contract operates on a flat,
/// addressable node list per its doc comment, not a nested tree).
fn collect_nodes(
    path: &NodePath,
    value: &PropertyValue,
    object_type: &ObjectType,
    out: &mut Vec<PropertyNode>,
) {
    out.push(to_plugin_property_node(path, object_type.clone(), value));
    match value {
        PropertyValue::Object(fields) => {
            for (key, child) in fields {
                collect_nodes(&path.field(key), child, object_type, out);
            }
        }
        PropertyValue::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                collect_nodes(&path.index(i), child, object_type, out);
            }
        }
        PropertyValue::Scalar(_) => {}
    }
}

fn collect_aod_files(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    if root.is_file() {
        return Ok(vec![root.to_path_buf()]);
    }
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                // Generated/vendored trees never carry hand-authored `.aod` objects and can be
                // large; skipping them keeps a project-wide scan fast and honest (no invented
                // "these are the same" heuristic - just excluded from the scan).
                let name = entry.file_name();
                if name == "node_modules" || name == "dist" || name == ".git" {
                    continue;
                }
                stack.push(path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("aod") {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}
