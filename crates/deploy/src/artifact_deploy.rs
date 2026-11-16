//! Deploy aus dem Speicher: Die Modelle kommen als `BuildArtifact` direkt vom Transpiler, ohne `dist` auf der Platte.
//!
//! Was in `XMLDATA` steht, ist die Datei des Transpilers im V2-Format (COMPACT, LF, Skripte eingebettet) unverändert.
//! Der alte Weg über `dist` (`deploy_encode`) baut das Format noch einmal nach (CRLF in Skripten, V1-Stand). Für V2 ist das
//! eine ANNAHME, die am System geprüft werden muss: `compare_with_remote` vergleicht die MD5 jeder Zeile mit den Artefakten
//! (nur Lesen). Erst wenn dort alles gleich ist, soll `execute_artifacts` auf einem echten System schreiben.

use crate::deploy_encode;
use crate::system_deploy::{self, DeployMapping, DeployOutcome, DeployPlan, LocalModel};
use database::db_session::DbManager;
use plugin_api::BuildArtifact;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Aus Artefakten Deploy-Modelle machen. Ordner ohne `KIND` (keine Modelle des Systems) fallen weg.
pub fn local_models(artifacts: &[BuildArtifact]) -> Vec<LocalModel> {
    artifacts
        .iter()
        .filter_map(|a| {
            let kind = deploy_encode::kind_of(&a.folder)?;
            let content = String::from_utf8_lossy(&a.content).into_owned();
            let title = deploy_encode::title_of(&content);
            Some(LocalModel { key: a.key(), main_file: PathBuf::new(), content, kind, title, extra_files: 0 })
        })
        .collect()
}

/// Nur Lesen: vergleicht den Satz mit dem System und sagt, was ein Deploy tun würde.
pub fn plan_artifacts(manager: &DbManager, artifacts: &[BuildArtifact], force: bool, mapping: Option<DeployMapping>) -> Result<DeployPlan, String> {
    system_deploy::plan_models(manager, &local_models(artifacts), force, mapping)
}

/// Der Schreibweg. `confirmed` ist erst nach dem Klick im Deploy-Dialog true. Benutzer ist der Windows-Benutzer wie bei V2.
pub fn execute_artifacts(
    manager: &DbManager,
    artifacts: &[BuildArtifact],
    keys: &[String],
    force: bool,
    mapping: Option<DeployMapping>,
    confirmed: bool,
    project_version: &str,
) -> Result<DeployOutcome, String> {
    let user = windows_user();
    system_deploy::execute_models(manager, &local_models(artifacts), keys, force, mapping, confirmed, &user, &user, project_version)
}

/// "Show changes": beide Seiten eines Modells, die Artefakt-Seite aus dem Speicher, die Systemseite aus der Datenbank.
pub fn show_changes(manager: &DbManager, artifacts: &[BuildArtifact], key: &str, mapping: Option<DeployMapping>) -> Result<system_deploy::ChangeView, String> {
    let mapping = mapping.unwrap_or_default();
    mapping.validate()?;
    let local = local_models(artifacts).into_iter().find(|m| m.key == key);
    let Some((folder, name)) = key.split_once('/') else { return Ok(system_deploy::ChangeView { local: local.map(|m| m.content), remote: None }) };
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    let (true, Some(kind)) = (plain && mapping.is_system_table(), deploy_encode::kind_of(folder)) else {
        return Err(format!("{key} cannot be shown."));
    };
    let sql = format!("SELECT CAST(`XMLDATA` AS CHAR) FROM `ASYS_SYSTEM` WHERE `ID` = '{name}' AND `KIND` = {kind}");
    let remote = manager.query_all(&sql)?.rows.into_iter().next().and_then(|row| row.into_iter().next().flatten());
    Ok(system_deploy::ChangeView { local: local.map(|m| m.content), remote })
}

pub fn windows_user() -> String {
    let name = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    let name = name.trim();
    if name.is_empty() { "_____DESIGNERANONYM".to_string() } else { name.to_string() }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FormatCheck {
    /// Zeilen, deren MD5 gleich der des Artefakts ist.
    pub same: usize,
    /// Zeilen mit anderem Inhalt: Das Format stimmt (noch) nicht.
    pub different: Vec<String>,
    /// Artefakte, die das System nicht hat.
    pub missing_remote: usize,
    /// Zeilen des Systems, die kein Artefakt haben (zählen nicht als Fehler).
    pub extra_remote: usize,
}

/// Rein: vergleicht MD5-Fingerabdrücke (Schlüssel -> MD5 des Systems) mit den Artefakten.
pub fn compare_fingerprints(local: &[LocalModel], remote: &BTreeMap<String, String>) -> FormatCheck {
    let mut check = FormatCheck { same: 0, different: Vec::new(), missing_remote: 0, extra_remote: 0 };
    let local_keys: std::collections::HashSet<&str> = local.iter().map(|m| m.key.as_str()).collect();
    for m in local {
        match remote.get(&m.key) {
            None => check.missing_remote += 1,
            Some(hash) if *hash == system_deploy::md5_of(&m.content) => check.same += 1,
            Some(_) => check.different.push(m.key.clone()),
        }
    }
    check.extra_remote = remote.keys().filter(|k| !local_keys.contains(k.as_str())).count();
    check
}

/// Nur Lesen (eine Abfrage mit MD5 je Zeile): Stimmt das Format der Artefakte mit dem überein, was V2 ins System geschrieben hat?
pub fn compare_with_remote(manager: &DbManager, artifacts: &[BuildArtifact]) -> Result<FormatCheck, String> {
    let remote = system_deploy::remote_hashes(manager)?;
    Ok(compare_fingerprints(&local_models(artifacts), &remote))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact(folder: &str, name: &str, content: &str) -> BuildArtifact {
        BuildArtifact { folder: folder.into(), name: name.into(), content: content.as_bytes().to_vec() }
    }

    #[test]
    fn models_get_kind_and_title_and_unknown_folders_are_skipped() {
        let models = local_models(&[
            artifact("entity", "A_entity", "<entity>\n  <name>A_entity</name>\n  <title>Hello</title>\n</entity>\n"),
            artifact("entityWebservice", "W_ws", "<x/>"),
            artifact("rendererDefinition", "R", "<x/>"),
            artifact("userhelp", "U", "<x/>"),
            artifact("doc", "D", "<x/>"),
        ]);
        let kinds: Vec<(&str, i64)> = models.iter().map(|m| (m.key.as_str(), m.kind)).collect();
        assert_eq!(kinds, [("entity/A_entity", 189), ("entityWebservice/W_ws", 10250), ("rendererDefinition/R", 10267)]);
        assert_eq!(models[0].title.as_deref(), Some("Hello"));
        assert_eq!(models[0].content, "<entity>\n  <name>A_entity</name>\n  <title>Hello</title>\n</entity>\n");
    }

    #[test]
    fn fingerprints_show_same_different_missing_and_extra() {
        let local = local_models(&[artifact("entity", "A", "1"), artifact("entity", "B", "2"), artifact("entity", "C", "3")]);
        let remote: BTreeMap<String, String> = [
            ("entity/A".to_string(), system_deploy::md5_of("1")),
            ("entity/B".to_string(), system_deploy::md5_of("other")),
            ("entity/Old".to_string(), system_deploy::md5_of("x")),
        ]
        .into_iter()
        .collect();
        let check = compare_fingerprints(&local, &remote);
        assert_eq!((check.same, check.missing_remote, check.extra_remote), (1, 1, 1));
        assert_eq!(check.different, ["entity/B"]);
    }

    #[test]
    fn execute_refuses_without_confirmation() {
        let err = execute_artifacts(&DbManager::default(), &[], &["entity/A".into()], false, None, false, "1").unwrap_err();
        assert!(err.contains("not confirmed"));
    }

    #[test]
    fn rows_are_written_with_the_given_user() {
        let local = local_models(&[artifact("entity", "A_entity", "<a/>")]);
        let items = vec![system_deploy::PlanItem { op: system_deploy::DeployOp::I, key: "entity/A_entity".into(), extra_files: 0, selected_by_default: true }];
        let statements = system_deploy::batched_system_statements_as(&items, &local, "lion").unwrap();
        let users = statements[0].params.iter().filter(|p| matches!(p, database::drivers::DbValue::Text(t) if t == "lion")).count();
        assert_eq!(users, 2, "USER_NEW and USER_EDIT");
    }
}
