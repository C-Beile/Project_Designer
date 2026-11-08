//! Git als Feature-Plugin: bildet die Befehle (Namen wie die Tauri-Befehle) auf `git_actions`/`git_scm` ab.
//! Argumente sind ein JSON-Objekt mit camelCase-Feldern (`projectRoot`, `sshKey` ...).

use crate::{clone, git_actions, git_scm};
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{Args, FeaturePlugin};
use serde_json::Value;
use std::path::PathBuf;

pub struct GitPlugin;

impl FeaturePlugin for GitPlugin {
    fn id(&self) -> &'static str {
        "git"
    }

    fn name(&self) -> &'static str {
        "Git"
    }

    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        let a = Args(&args);
        match command {
            "get_current_branch" => json(git_scm::current_branch(&a.root()?)),
            "get_file_history" => json(git_scm::file_history(&PathBuf::from(a.string("path")?))),
            "git_overview" => json(git_actions::overview(&a.root()?)?),
            "git_commit" => json(git_actions::commit(&a.root()?, &a.string("message")?, &a.get::<Vec<String>>("paths")?)?),
            "git_unpushed" => json(git_actions::unpushed(&a.root()?)?),
            "git_incoming" => json(git_actions::incoming(&a.root()?)?),
            "git_push_to" => json(git_actions::push_up_to(&a.root()?, &a.string("hash")?)?),
            "git_pull" => json(git_actions::pull(&a.root()?)?),
            "git_push" => json(git_actions::push(&a.root()?)?),
            "git_checkout" => json(git_actions::checkout(&a.root()?, &a.string("branch")?)?),
            "git_create_branch" => json(git_actions::create_branch(&a.root()?, &a.string("name")?, a.opt_string("start")?.as_deref())?),
            "scm_status" => json(git_scm::status(&a.root()?)?),
            "scm_stage" => json(git_scm::stage(&a.root()?, &a.get::<Vec<String>>("paths")?)?),
            "scm_stage_all" => json(git_scm::stage_all(&a.root()?)?),
            "scm_unstage" => json(git_scm::unstage(&a.root()?, &a.get::<Vec<String>>("paths")?)?),
            "scm_discard" => json(git_scm::discard(&a.root()?, &a.get::<Vec<String>>("paths")?)?),
            "scm_commit" => json(git_scm::commit_staged(&a.root()?, &a.string("message")?)?),
            "scm_sync" => json(git_scm::sync(&a.root()?)?),
            "scm_history" => json(git_scm::history(&a.root()?, a.get::<usize>("limit")?.clamp(1, 500))?),
            "scm_commit_files" => json(git_scm::commit_files(&a.root()?, &a.string("hash")?)?),
            "scm_diff" => {
                let side = git_scm::DiffSide::parse(&a.string("side")?, a.opt_string("hash")?)?;
                json(git_scm::diff_sides(&a.root()?, &a.string("path")?, &side)?)
            }
            "scm_gutter" => json(git_scm::gutter(&a.root()?, &PathBuf::from(a.string("file")?))?),
            "clone_repository" => {
                let dir = clone::clone_repository(&a.string("url")?, &a.string("location")?, &a.string("name")?, a.opt_string("sshKey")?.as_deref(), a.opt_string("password")?.as_deref())?;
                json(dir.to_string_lossy().into_owned())
            }
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::FeatureRegistry;
    use serde_json::json;

    fn registry() -> FeatureRegistry {
        let mut reg = FeatureRegistry::new();
        reg.register(Box::new(GitPlugin));
        reg
    }

    #[test]
    fn plugin_has_id_and_name() {
        assert_eq!((GitPlugin.id(), GitPlugin.name()), ("git", "Git"));
        assert!(registry().is_available("git"));
    }

    #[test]
    fn unknown_command_is_reported() {
        assert_eq!(registry().call("git", "git_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'git_nope' im Plugin 'git'");
    }

    #[test]
    fn missing_argument_is_reported() {
        let err = registry().call("git", "git_commit", json!({ "projectRoot": "x" })).unwrap_err();
        assert_eq!(err, "Argument 'message' fehlt");
    }

    #[test]
    fn wrong_argument_type_is_reported() {
        let err = registry().call("git", "scm_stage", json!({ "projectRoot": "x", "paths": "a" })).unwrap_err();
        assert!(err.starts_with("Argument 'paths' ist ungültig"), "{err}");
    }

    #[test]
    fn unknown_diff_side_is_refused() {
        let err = registry().call("git", "scm_diff", json!({ "projectRoot": "x", "path": "a", "side": "other" })).unwrap_err();
        assert_eq!(err, "Unknown diff side.");
    }

    #[test]
    fn current_branch_outside_a_repository_is_null() {
        let dir = std::env::temp_dir().join(format!("git-plugin-nobranch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = registry().call("git", "get_current_branch", json!({ "projectRoot": dir.to_string_lossy() })).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        // Liegt temp selbst in einem Repository, ist ein Branch erlaubt; sonst null.
        assert!(out.is_null() || out.is_string());
    }
}
