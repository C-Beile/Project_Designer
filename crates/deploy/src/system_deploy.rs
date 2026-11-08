//! Deploy nach ASYS_SYSTEM: Plan (nur lesen), Schreiben in einer Transaktion und Deploy-Übersicht.
//!
//! - Ein Deploy läuft nie von selbst: der Plan ist ein reiner Vergleich, das Schreiben braucht eine
//!   ausdrückliche Bestätigung und läuft als EINE Transaktion (Rollback beim ersten Fehler).
//!
//! UNVERIFIED gegen eine echte Systemdatenbank: das Spaltenlayout von ASYS_SYSTEM ist im Handbuch
//! nicht dokumentiert. Das Mapping ist deshalb explizit, wird vor jedem Statement gegen die echten
//! Spalten geprüft, und nur die Hauptmodelldatei wird übertragen. Der Schreibpfad ist nur mit
//! Mock-Tests abgedeckt.

use crate::deploy_encode::{self, DEPLOY_META_ID, DEPLOY_META_KIND};
use database::db_session::DbManager;
use database::drivers::{DbValue, TxStatement};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Folders of `dist` that are no data models.
const NON_MODEL_DIRS: [&str; 6] = ["cypress", "doc", "node_modules", "tools", "userhelp", ".git"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeployMapping {
    pub table: String,
    pub name_column: String,
    pub content_column: String,
}

impl Default for DeployMapping {
    fn default() -> Self {
        Self { table: "ASYS_SYSTEM".into(), name_column: "ID".into(), content_column: "XMLDATA".into() }
    }
}

fn is_identifier(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl DeployMapping {
    /// The real system table of ADITO: one row per model with its model number and `XMLDATA`.
    /// Any other mapping is written generically (name and content column only).
    pub fn is_system_table(&self) -> bool {
        self.table.eq_ignore_ascii_case("ASYS_SYSTEM") && self.name_column.eq_ignore_ascii_case("ID") && self.content_column.eq_ignore_ascii_case("XMLDATA")
    }

    pub fn validate(&self) -> Result<(), String> {
        for part in [&self.table, &self.name_column, &self.content_column] {
            if !is_identifier(part) {
                return Err(format!("'{part}' is not a plain table or column name."));
            }
        }
        Ok(())
    }

    /// Checks the mapped columns against the live ones (case-insensitive).
    pub fn verify_columns(&self, live: &[String]) -> Result<(), String> {
        let has = |c: &str| live.iter().any(|l| l.eq_ignore_ascii_case(c));
        if live.is_empty() {
            return Err(format!("Table {} was not found in the connected database.", self.table));
        }
        for c in [&self.name_column, &self.content_column] {
            if !has(c) {
                return Err(format!("Column {c} does not exist in {}. Existing columns: {}.", self.table, live.join(", ")));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalModel {
    /// `<type folder>/<model name>`, e.g. `entity/Person_entity`.
    pub key: String,
    pub main_file: PathBuf,
    /// What the system table holds for the model (`deploy_encode::encode_model`).
    pub content: String,
    /// Model number of the type (`KIND`).
    pub kind: i64,
    pub title: Option<String>,
    /// Files next to the main file that are not part of the row (linked files are inlined; any other
    /// file only counts here).
    pub extra_files: usize,
}

/// Models of `<project>/dist`: one per `<type>/<name>/` folder with a main `<name>.aod`.
pub fn collect_local_models(project_root: &Path) -> Result<Vec<LocalModel>, String> {
    let dist = project_root.join("dist");
    if !dist.is_dir() {
        return Err("The project has no dist folder yet; run a transpile first.".into());
    }
    let mut out = Vec::new();
    let mut types: Vec<_> = std::fs::read_dir(&dist).map_err(|e| e.to_string())?.flatten().filter(|e| e.path().is_dir()).collect();
    types.sort_by_key(|e| e.file_name());
    for t in types {
        let type_name = t.file_name().to_string_lossy().into_owned();
        if NON_MODEL_DIRS.contains(&type_name.as_str()) {
            continue;
        }
        let Some(kind) = deploy_encode::kind_of(&type_name) else { continue };
        let mut models: Vec<_> = std::fs::read_dir(t.path()).map_err(|e| e.to_string())?.flatten().filter(|e| e.path().is_dir()).collect();
        models.sort_by_key(|e| e.file_name());
        for m in models {
            let name = m.file_name().to_string_lossy().into_owned();
            let main_file = m.path().join(format!("{name}.aod"));
            if !main_file.is_file() {
                continue;
            }
            let content = deploy_encode::encode_model(&dist, &main_file)?;
            let title = deploy_encode::title_of(&content);
            let extra_files = count_files(&m.path()).saturating_sub(1);
            out.push(LocalModel { key: format!("{type_name}/{name}"), main_file, content, kind, title, extra_files });
        }
    }
    Ok(out)
}

fn count_files(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| if e.path().is_dir() { count_files(&e.path()) } else { 1 }).sum())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum DeployOp {
    I,
    U,
    D,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanItem {
    pub op: DeployOp,
    pub key: String,
    pub extra_files: usize,
    /// Deletes are never pre-selected: the remote table may hold rows this project does not own.
    pub selected_by_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeployPlan {
    pub target: String,
    pub items: Vec<PlanItem>,
    pub outdated: bool,
    pub mapping: DeployMapping,
}

/// Pure comparison local vs. remote (`remote`: name to content). `force` updates every model.
pub fn compute_plan(local: &[LocalModel], remote: &BTreeMap<String, String>, force: bool) -> Vec<PlanItem> {
    let mut items = Vec::new();
    for m in local {
        match remote.get(&m.key) {
            None => items.push(PlanItem { op: DeployOp::I, key: m.key.clone(), extra_files: m.extra_files, selected_by_default: true }),
            Some(r) if force || r != &m.content => items.push(PlanItem { op: DeployOp::U, key: m.key.clone(), extra_files: m.extra_files, selected_by_default: true }),
            Some(_) => {}
        }
    }
    for key in remote.keys() {
        if !local.iter().any(|m| &m.key == key) {
            items.push(PlanItem { op: DeployOp::D, key: key.clone(), extra_files: 0, selected_by_default: false });
        }
    }
    items
}

/// Parameterised I/U/D statements for the chosen items. Identifiers were validated beforehand.
pub fn build_statements(mapping: &DeployMapping, items: &[PlanItem], local: &[LocalModel]) -> Result<Vec<TxStatement>, String> {
    mapping.validate()?;
    if mapping.is_system_table() {
        return system_table_statements(items, local);
    }
    let (t, n, c) = (&mapping.table, &mapping.name_column, &mapping.content_column);
    items
        .iter()
        .map(|item| {
            let content = || {
                local
                    .iter()
                    .find(|m| m.key == item.key)
                    .map(|m| DbValue::Text(m.content.clone()))
                    .ok_or_else(|| format!("{} is not part of the local project.", item.key))
            };
            Ok(match item.op {
                DeployOp::I => TxStatement { sql: format!("INSERT INTO `{t}` (`{n}`, `{c}`) VALUES (?, ?)"), params: vec![DbValue::Text(item.key.clone()), content()?] },
                DeployOp::U => TxStatement { sql: format!("UPDATE `{t}` SET `{c}` = ? WHERE `{n}` = ?"), params: vec![content()?, DbValue::Text(item.key.clone())] },
                DeployOp::D => TxStatement { sql: format!("DELETE FROM `{t}` WHERE `{n}` = ?"), params: vec![DbValue::Text(item.key.clone())] },
            })
        })
        .collect()
}

const DESIGNER_USER: &str = "_____DESIGNERANONYM";

fn model_name(key: &str) -> &str {
    key.split_once('/').map(|(_, name)| name).unwrap_or(key)
}

/// The statements the original Designer's deploy amounts to: a model row carries its name as `ID`
/// and `NAME`, its model number as `KIND`, its `<title>` as `TITLE` and the model as `XMLDATA`.
fn system_table_statements(items: &[PlanItem], local: &[LocalModel]) -> Result<Vec<TxStatement>, String> {
    items
        .iter()
        .map(|item| {
            let name = model_name(&item.key).to_string();
            let find = || local.iter().find(|m| m.key == item.key).ok_or_else(|| format!("{} is not part of the local project.", item.key));
            Ok(match item.op {
                DeployOp::I => {
                    let m = find()?;
                    TxStatement {
                        sql: "INSERT INTO `ASYS_SYSTEM` (`ID`, `NAME`, `KIND`, `TITLE`, `USER_NEW`, `DATE_NEW`, `USER_EDIT`, `DATE_EDIT`, `XMLDATA`) VALUES (?, ?, ?, ?, ?, NOW(), ?, NOW(), ?)".into(),
                        params: vec![
                            DbValue::Text(name.clone()),
                            DbValue::Text(name),
                            DbValue::Int(m.kind),
                            m.title.clone().map(DbValue::Text).unwrap_or(DbValue::Null),
                            DbValue::Text(DESIGNER_USER.into()),
                            DbValue::Text(DESIGNER_USER.into()),
                            DbValue::Bytes(m.content.clone().into_bytes()),
                        ],
                    }
                }
                DeployOp::U => {
                    let m = find()?;
                    TxStatement {
                        sql: "UPDATE `ASYS_SYSTEM` SET `XMLDATA` = ?, `TITLE` = ?, `KIND` = ?, `USER_EDIT` = ?, `DATE_EDIT` = NOW() WHERE `ID` = ?".into(),
                        params: vec![
                            DbValue::Bytes(m.content.clone().into_bytes()),
                            m.title.clone().map(DbValue::Text).unwrap_or(DbValue::Null),
                            DbValue::Int(m.kind),
                            DbValue::Text(DESIGNER_USER.into()),
                            DbValue::Text(name),
                        ],
                    }
                }
                DeployOp::D => TxStatement { sql: "DELETE FROM `ASYS_SYSTEM` WHERE `ID` = ? AND `KIND` = ?".into(), params: vec![DbValue::Text(name), DbValue::Int(deploy_encode::kind_of(item.key.split('/').next().unwrap_or("")).unwrap_or(-1))] },
            })
        })
        .collect()
}

/// The bookkeeping row of a deploy (who, when, which project version), as the Designer writes it.
fn deploy_meta_statement(author: &str, time_ms: i64, project_version: &str) -> TxStatement {
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<deployMetaInfo xmlns=\"http://www.adito.de/2018/ao/Model\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" VERSION=\"1.0.0\" xsi:schemaLocation=\"http://www.adito.de/2018/ao/Model adito://models/xsd/deployMetaInfo/1.0.0\">\r\n  <name>{DEPLOY_META_ID}</name>\r\n  <majorModelMode>COMPACT</majorModelMode>\r\n  <infos>\r\n    <entry>\r\n      <key>DefaultDeployMetaInfoProvider.deployAuthor</key>\r\n      <value>{author}</value>\r\n    </entry>\r\n    <entry>\r\n      <key>de.adito.aditoweb.nbm.deploy.metainfo.ProjectVersionDeployMetaInfoProvider.designer.project.version</key>\r\n      <value>{project_version}</value>\r\n    </entry>\r\n    <entry>\r\n      <key>DefaultDeployMetaInfoProvider.deployTime</key>\r\n      <value>{time_ms}</value>\r\n    </entry>\r\n  </infos>\r\n</deployMetaInfo>\r\n"
    );
    TxStatement {
        sql: "INSERT INTO `ASYS_SYSTEM` (`ID`, `NAME`, `KIND`, `USER_NEW`, `DATE_NEW`, `USER_EDIT`, `DATE_EDIT`, `XMLDATA`) VALUES (?, ?, ?, ?, NOW(), ?, NOW(), ?) ON DUPLICATE KEY UPDATE `XMLDATA` = VALUES(`XMLDATA`), `USER_EDIT` = VALUES(`USER_EDIT`), `DATE_EDIT` = NOW()".into(),
        params: vec![
            DbValue::Text(DEPLOY_META_ID.into()),
            DbValue::Text(DEPLOY_META_ID.into()),
            DbValue::Int(DEPLOY_META_KIND),
            DbValue::Text(DESIGNER_USER.into()),
            DbValue::Text(DESIGNER_USER.into()),
            DbValue::Bytes(xml.into_bytes()),
        ],
    }
}

fn xml_text(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn live_columns(manager: &DbManager, mapping: &DeployMapping) -> Result<Vec<String>, String> {
    let sql = format!("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '{}'", mapping.table);
    let r = manager.query(&sql, false)?;
    Ok(r.rows.into_iter().filter_map(|row| row.into_iter().next().flatten()).collect())
}

fn remote_models(manager: &DbManager, mapping: &DeployMapping) -> Result<BTreeMap<String, String>, String> {
    if mapping.is_system_table() {
        let r = manager.query_all("SELECT `ID`, `KIND`, CAST(`XMLDATA` AS CHAR) FROM `ASYS_SYSTEM`")?;
        if r.truncated {
            return Err("The system table has more rows than the plan can compare; refusing to guess.".into());
        }
        // Rows of a type this deploy does not write (help pages, the deploy's own row) are not part of the plan.
        return Ok(r
            .rows
            .into_iter()
            .filter_map(|row| {
                let mut cells = row.into_iter();
                let name = cells.next().flatten()?;
                let kind: i64 = cells.next().flatten()?.parse().ok()?;
                let content = cells.next().flatten().unwrap_or_default();
                let folder = deploy_encode::folder_of(kind)?;
                Some((format!("{folder}/{name}"), content))
            })
            .collect());
    }
    let sql = format!("SELECT `{}`, `{}` FROM `{}`", mapping.name_column, mapping.content_column, mapping.table);
    let r = manager.query_all(&sql)?;
    if r.truncated {
        return Err("The system table has more rows than the plan can compare; refusing to guess.".into());
    }
    Ok(r.rows.into_iter().filter_map(|mut row| {
        let content = row.pop().flatten().unwrap_or_default();
        let name = row.pop().flatten()?;
        Some((name, content))
    }).collect())
}

/// Dry run: reads only (SELECT) and compares. Nothing is written.
pub fn plan(manager: &DbManager, project_root: &Path, force: bool, mapping: Option<DeployMapping>) -> Result<DeployPlan, String> {
    let mapping = mapping.unwrap_or_default();
    mapping.validate()?;
    let target = manager.database_label().ok_or("Not connected. Open the tunnel in the Services tab first.")?;
    mapping.verify_columns(&live_columns(manager, &mapping)?)?;
    let local = collect_local_models(project_root)?;
    let remote = remote_models(manager, &mapping)?;
    let items = compute_plan(&local, &remote, force);
    let outdated = !items.is_empty();
    Ok(DeployPlan { target, items, outdated, mapping })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChangeView {
    pub local: Option<String>,
    pub remote: Option<String>,
}

/// "Show changes": both sides of one model.
pub fn show_changes(manager: &DbManager, project_root: &Path, key: &str, mapping: Option<DeployMapping>) -> Result<ChangeView, String> {
    let mapping = mapping.unwrap_or_default();
    mapping.validate()?;
    let local = collect_local_models(project_root)?.into_iter().find(|m| m.key == key).map(|m| m.content);
    let remote = remote_models(manager, &mapping)?.remove(key);
    Ok(ChangeView { local, remote })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeployOutcome {
    pub executed: usize,
    pub target: String,
}

/// The write. `confirmed` must be true (explicit click in the UI). The plan is recomputed and
/// only the selected keys that are still part of it are written, all in one transaction.
pub fn execute(manager: &DbManager, project_root: &Path, keys: &[String], force: bool, mapping: Option<DeployMapping>, confirmed: bool) -> Result<DeployOutcome, String> {
    if !confirmed {
        return Err("Deploy was not confirmed.".into());
    }
    let current = plan(manager, project_root, force, mapping)?;
    let chosen: Vec<PlanItem> = current.items.iter().filter(|i| keys.contains(&i.key)).cloned().collect();
    if chosen.is_empty() {
        return Err("Nothing selected, or the selection is no longer part of the plan.".into());
    }
    let local = collect_local_models(project_root)?;
    let mut statements = build_statements(&current.mapping, &chosen, &local)?;
    if current.mapping.is_system_table() {
        let author = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
        let time_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let version = std::fs::read_to_string(project_root.join(".aditoprj").join("project.version")).unwrap_or_default();
        statements.push(deploy_meta_statement(&xml_text(author.trim()), time_ms, &xml_text(version.trim())));
    }
    manager.transaction(&statements)?;
    Ok(DeployOutcome { executed: statements.len(), target: current.target })
}

#[cfg(test)]
mod tests {
    use super::*;
    use database::drivers::mock::MockConnection;
    use database::drivers::DbConnection;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn model(key: &str, content: &str) -> LocalModel {
        LocalModel { key: key.into(), main_file: PathBuf::new(), content: content.into(), kind: 189, title: None, extra_files: 0 }
    }

    #[test]
    fn mapping_rejects_injection_and_unknown_columns() {
        let bad = DeployMapping { table: "ASYS_SYSTEM; DROP TABLE x".into(), ..Default::default() };
        assert!(bad.validate().is_err());
        let m = DeployMapping::default();
        assert!(m.verify_columns(&["id".into(), "xmldata".into()]).is_ok());
        let err = m.verify_columns(&["NAME".into(), "BLOB".into()]).unwrap_err();
        assert!(err.contains("Existing columns: NAME, BLOB"));
        assert!(m.verify_columns(&[]).unwrap_err().contains("not found"));
    }

    #[test]
    fn plan_marks_insert_update_delete_and_force() {
        let local = vec![model("entity/A", "1"), model("entity/B", "2-new"), model("entity/C", "3")];
        let remote: BTreeMap<String, String> = [("entity/B", "2"), ("entity/C", "3"), ("entity/Gone", "x")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let items = compute_plan(&local, &remote, false);
        let ops: Vec<(DeployOp, &str)> = items.iter().map(|i| (i.op, i.key.as_str())).collect();
        assert_eq!(ops, vec![(DeployOp::I, "entity/A"), (DeployOp::U, "entity/B"), (DeployOp::D, "entity/Gone")]);
        assert!(!items[2].selected_by_default);
        assert_eq!(compute_plan(&local, &remote, true).iter().filter(|i| i.op == DeployOp::U).count(), 2);
        assert!(compute_plan(&local, &local.iter().map(|m| (m.key.clone(), m.content.clone())).collect(), false).is_empty());
    }

    #[test]
    fn statements_are_parameterised_per_operation() {
        let local = vec![model("entity/A", "<a/>"), model("entity/B", "<b/>")];
        let items = vec![
            PlanItem { op: DeployOp::I, key: "entity/A".into(), extra_files: 0, selected_by_default: true },
            PlanItem { op: DeployOp::U, key: "entity/B".into(), extra_files: 0, selected_by_default: true },
            PlanItem { op: DeployOp::D, key: "entity/Gone".into(), extra_files: 0, selected_by_default: false },
        ];
        let generic = DeployMapping { table: "ASYS_SYSTEM".into(), name_column: "ID".into(), content_column: "CONTENT".into() };
        let s = build_statements(&generic, &items, &local).unwrap();
        assert_eq!(s[0].sql, "INSERT INTO `ASYS_SYSTEM` (`ID`, `CONTENT`) VALUES (?, ?)");
        assert_eq!(s[1].sql, "UPDATE `ASYS_SYSTEM` SET `CONTENT` = ? WHERE `ID` = ?");
        assert_eq!(s[2].sql, "DELETE FROM `ASYS_SYSTEM` WHERE `ID` = ?");
        assert_eq!(s[1].params, vec![DbValue::Text("<b/>".into()), DbValue::Text("entity/B".into())]);
        assert!(!s.iter().any(|x| x.sql.contains("<b/>")), "values are bound, never spliced");
    }

    #[test]
    fn the_system_table_rows_carry_name_kind_title_and_content() {
        let mut m = model("entity/Person_entity", "<entity/>");
        m.title = Some("Person_Person".into());
        let items = vec![
            PlanItem { op: DeployOp::I, key: "entity/Person_entity".into(), extra_files: 0, selected_by_default: true },
            PlanItem { op: DeployOp::U, key: "entity/Person_entity".into(), extra_files: 0, selected_by_default: true },
            PlanItem { op: DeployOp::D, key: "entity/Old_entity".into(), extra_files: 0, selected_by_default: false },
        ];
        assert!(DeployMapping::default().is_system_table());
        let s = build_statements(&DeployMapping::default(), &items, &[m]).unwrap();
        assert!(s[0].sql.starts_with("INSERT INTO `ASYS_SYSTEM` (`ID`, `NAME`, `KIND`, `TITLE`"));
        assert_eq!(s[0].params[0], DbValue::Text("Person_entity".into()));
        assert_eq!(s[0].params[2], DbValue::Int(189));
        assert_eq!(s[0].params[3], DbValue::Text("Person_Person".into()));
        assert!(s[1].sql.starts_with("UPDATE `ASYS_SYSTEM` SET `XMLDATA` = ?"));
        assert_eq!(s[2].params, vec![DbValue::Text("Old_entity".into()), DbValue::Int(189)]);
    }

    #[test]
    fn the_deploy_row_records_author_time_and_project_version() {
        let s = deploy_meta_statement("Clemens", 1793696855326, "6.5.0");
        assert!(s.sql.contains("ON DUPLICATE KEY UPDATE"));
        let DbValue::Bytes(xml) = &s.params[5] else { panic!("the row is bound as bytes") };
        let xml = String::from_utf8(xml.clone()).unwrap();
        assert!(xml.contains("<value>Clemens</value>") && xml.contains("<value>1793696855326</value>") && xml.contains("<value>6.5.0</value>"));
    }

    static N: AtomicUsize = AtomicUsize::new(0);

    fn temp_project() -> PathBuf {
        let root = std::env::temp_dir().join(format!("forge-deploy-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let m = root.join("dist/entity/Person_entity");
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("Person_entity.aod"), "<entity/>").unwrap();
        std::fs::write(m.join("extra.js"), "x").unwrap();
        std::fs::create_dir_all(root.join("dist/doc/ignored")).unwrap();
        root
    }

    #[test]
    fn local_models_come_from_dist_and_count_untransferred_files() {
        let root = temp_project();
        let models = collect_local_models(&root).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].key, "entity/Person_entity");
        assert_eq!(models[0].extra_files, 1);
        assert!(collect_local_models(&root.join("nope")).unwrap_err().contains("transpile"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn execute_refuses_without_confirmation() {
        let manager = DbManager::default();
        let err = execute(&manager, Path::new("."), &["entity/A".into()], false, None, false).unwrap_err();
        assert!(err.contains("not confirmed"));
    }

    #[test]
    fn transaction_commits_all_statements_or_none() {
        let statements = vec![
            TxStatement { sql: "UPDATE t SET c = ? WHERE n = ?".into(), params: vec![DbValue::Text("v".into()), DbValue::Text("k".into())] },
            TxStatement { sql: "DELETE FROM t WHERE n = ?".into(), params: vec![DbValue::Text("x".into())] },
        ];
        let ok = DbManager::default();
        ok.attach_connection(Box::new(MockConnection::default()), vec![]);
        assert_eq!(ok.transaction(&statements).unwrap().len(), 2);

        let mut failing = MockConnection::default();
        failing.fail_at = Some(1);
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        assert!(rt.block_on(failing.execute_transaction(&statements)).is_err());
        assert!(failing.committed.lock().unwrap().is_empty(), "nothing is committed after a failure");
        let bad = DbManager::default();
        bad.attach_connection(Box::new(failing), vec![]);
        assert!(bad.transaction(&statements).is_err());
    }
}

// ---------------------------------------------------------------------------------------------
// Deploy overview (read-only). The original Designer records every deploy in the row
// `_____DEPLOY_META_INFOS` of ASYS_SYSTEM (author, time, project version) and keeps in
// `dist/cache.txt` the time of the last transpile of every source file. A file whose time is newer
// than the last deploy is a change the system does not have yet. The model rows themselves hold the
// merged model (modules included), which is bigger than the file in `dist`, so `dist` is never
// compared to those rows and never written into them.
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LastDeploy {
    pub author: Option<String>,
    /// Milliseconds since 1970.
    pub time_ms: Option<i64>,
    pub designer_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub changed_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ChangedModel {
    /// `<type folder>/<model name>`.
    pub key: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeployOverview {
    pub target: String,
    pub last_deploy: Option<LastDeploy>,
    pub changed: Vec<ChangedModel>,
    /// Changed files that belong to no model (Liquibase scripts, configuration).
    pub other_files: Vec<ChangedFile>,
}

fn meta_value(xml: &str, key_suffix: &str) -> Option<String> {
    let mut rest = xml;
    while let Some(k) = rest.find("<key>") {
        let after = &rest[k + 5..];
        let end = after.find("</key>")?;
        let key = &after[..end];
        let tail = &after[end + 6..];
        if key.ends_with(key_suffix) {
            let v = tail.find("<value>")?;
            let tail = &tail[v + 7..];
            let e = tail.find("</value>")?;
            return Some(tail[..e].trim().to_string());
        }
        rest = tail;
    }
    None
}

pub fn parse_last_deploy(xml: &str) -> LastDeploy {
    LastDeploy {
        author: meta_value(xml, "deployAuthor"),
        time_ms: meta_value(xml, "deployTime").and_then(|t| t.parse().ok()),
        designer_version: meta_value(xml, "designer.project.version"),
    }
}

/// Files of `dist/cache.txt` that were transpiled after `since_ms`, grouped by model.
pub fn changed_since(cache_json: &str, since_ms: i64) -> Result<(Vec<ChangedModel>, Vec<ChangedFile>), String> {
    let map: BTreeMap<String, i64> = serde_json::from_str(cache_json).map_err(|e| format!("dist/cache.txt is not readable: {e}"))?;
    let mut models: BTreeMap<String, Vec<ChangedFile>> = BTreeMap::new();
    let mut other = Vec::new();
    for (path, ts) in map {
        if ts <= since_ms {
            continue;
        }
        let norm = path.replace('\\', "/");
        let file = ChangedFile { path: norm.clone(), changed_ms: ts };
        let parts: Vec<&str> = norm.split('/').collect();
        if parts.len() >= 3 && !parts[0].starts_with('.') && !NON_MODEL_DIRS.contains(&parts[0]) {
            models.entry(format!("{}/{}", parts[0], parts[1])).or_default().push(file);
        } else {
            other.push(file);
        }
    }
    Ok((models.into_iter().map(|(key, files)| ChangedModel { key, files }).collect(), other))
}

/// Reads the last deploy of the connected system and lists what changed in the project since.
/// Reads only (one SELECT); nothing is written.
pub fn deploy_overview(manager: &DbManager, project_root: &Path) -> Result<DeployOverview, String> {
    let target = manager.database_label().ok_or("Not connected. Open the tunnel in the Services tab first.")?;
    let meta = manager.query("SELECT CAST(XMLDATA AS CHAR) FROM `ASYS_SYSTEM` WHERE `ID` = '_____DEPLOY_META_INFOS'", false)?;
    let last_deploy = meta.rows.into_iter().next().and_then(|r| r.into_iter().next().flatten()).map(|x| parse_last_deploy(&x));
    let cache = project_root.join("dist").join("cache.txt");
    let json = std::fs::read_to_string(&cache).map_err(|_| "The project has no dist/cache.txt yet; run a transpile first.".to_string())?;
    let since = last_deploy.as_ref().and_then(|l| l.time_ms).unwrap_or(0);
    let (changed, other_files) = changed_since(&json, since)?;
    Ok(DeployOverview { target, last_deploy, changed, other_files })
}

#[cfg(test)]
mod deploy_overview_tests {
    use super::*;

    const META: &str = "<infos><entry><key>DefaultDeployMetaInfoProvider.deployAuthor</key>\r\n<value>ClemensBeile</value></entry><entry><key>DefaultDeployMetaInfoProvider.deployTime</key><value>1793695345880</value></entry></infos>";

    #[test]
    fn reads_author_and_time_of_the_last_deploy() {
        let l = parse_last_deploy(META);
        assert_eq!(l.author.as_deref(), Some("ClemensBeile"));
        assert_eq!(l.time_ms, Some(1793695345880));
    }

    #[test]
    fn lists_only_files_changed_after_the_deploy_grouped_by_model() {
        let json = r#"{"preferences\\P\\P.aod": 1793695661283, "entity\\A\\a.js": 1793695400000, "entity\\B\\b.js": 1000, ".liquibase\\x\\y.xml": 1793695500000}"#;
        let (models, other) = changed_since(json, 1793695345880).unwrap();
        assert_eq!(models.iter().map(|m| m.key.as_str()).collect::<Vec<_>>(), vec!["entity/A", "preferences/P"]);
        assert_eq!(other.len(), 1);
    }
}
