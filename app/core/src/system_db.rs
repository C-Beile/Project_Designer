//! Reads of the system database (users, alias configs) and the deploy into ASYS_SYSTEM.
//!
//! Business rules:
//! - Secrets (passwords, tokens, keys) never leave this module: secret-looking columns are
//!   dropped, secret-looking values inside text cells are masked, and every secret of the open
//!   session is scrubbed from all cell texts.
//! - A deploy never runs on its own: the plan is a pure comparison, the write needs an explicit
//!   confirmation and runs as ONE transaction (rollback on the first error).
//!
//! UNVERIFIED against a real system database: the column layout of ASYS_SYSTEM (and the exact
//! row format the original Designer writes) is not documented in the manual. The mapping below
//! is therefore explicit, checked against the live columns before any statement is built, and
//! only the main model file is transferred. The write path is covered by mock tests only.

use crate::db_session::{DbManager, SqlResult};
use crate::system_config::{alias_row_to_dto, is_secret_key, AliasConfigDto};
use db_layer::{DbValue, TxStatement};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const REQUIRED_ALIASES: [&str; 2] = ["___SYSTEMALIAS", "Data_alias"];

/// Folders of `dist` that are no data models.
const NON_MODEL_DIRS: [&str; 6] = ["cypress", "doc", "node_modules", "tools", "userhelp", ".git"];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TableDump {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    /// Columns that exist in the table but are never shown.
    pub hidden_columns: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AliasConfigTable {
    pub table: TableDump,
    /// Of `___SYSTEMALIAS` and `Data_alias`, the ones not found in any cell.
    pub missing_required: Vec<String>,
}

/// Masks the value that follows a secret keyword (`password=abc`, `"token":"abc"`,
/// `<entry key="password" value="abc"/>`).
pub fn redact_text(text: &str) -> String {
    const WORDS: [&str; 6] = ["password", "passwd", "passphrase", "secret", "token", "pwd"];
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    'outer: while i < bytes.len() {
        for w in WORDS {
            if lower[i..].starts_with(w) {
                let mut j = i + w.len();
                out.push_str(&text[i..j]);
                let skip = |j: &mut usize| {
                    while *j < bytes.len() && matches!(bytes[*j], b' ' | b'\t' | b'"' | b'\'' | b'=' | b':' | b'>' | b'\\') {
                        *j += 1;
                    }
                };
                let before = j;
                skip(&mut j);
                if lower[j..].starts_with("value") {
                    j += 5;
                    skip(&mut j);
                }
                out.push_str(&text[before..j]);
                let start = j;
                while j < bytes.len() && !matches!(bytes[j], b'"' | b'\'' | b'<' | b',' | b'\n' | b'\r' | b';' | b'&' | b' ') {
                    j += 1;
                }
                if j > start {
                    out.push_str("***");
                }
                i = j;
                continue 'outer;
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_key_like_cell(cell: &str) -> bool {
    cell.len() <= 64 && !cell.contains(char::is_whitespace) && is_secret_key(cell)
}

/// Drops secret columns and masks secret values; `secrets` are the session's own credentials.
pub fn sanitize(result: &SqlResult, secrets: &[&str]) -> TableDump {
    let keep: Vec<usize> = (0..result.columns.len()).filter(|&i| !is_secret_key(&result.columns[i])).collect();
    let hidden_columns = (0..result.columns.len()).filter(|i| !keep.contains(i)).map(|i| result.columns[i].clone()).collect();
    let rows = result
        .rows
        .iter()
        .map(|row| {
            let key_value_row = keep.iter().any(|&i| row[i].as_deref().map(is_key_like_cell).unwrap_or(false));
            keep.iter()
                .map(|&i| {
                    let cell = row[i].as_ref()?;
                    if key_value_row && result.columns[i].to_ascii_lowercase().contains("value") {
                        return Some("***".to_string());
                    }
                    let mut text = redact_text(cell);
                    for s in secrets.iter().filter(|s| s.len() >= 3) {
                        text = text.replace(s, "***");
                    }
                    Some(text)
                })
                .collect()
        })
        .collect();
    TableDump { columns: keep.iter().map(|&i| result.columns[i].clone()).collect(), rows, hidden_columns, truncated: result.truncated }
}

fn dump(manager: &DbManager, sql: &str) -> Result<TableDump, String> {
    let result = manager.query(sql, false)?;
    Ok(sanitize(&result, &manager.secret_values().iter().map(|s| s.as_str()).collect::<Vec<_>>()))
}

/// Columns of the Users tab in the original Designer (manual 6.1.3), in this order.
const USER_COLUMNS: [&str; 5] = ["isActive", "title", "email", "firstname", "lastname"];
const USER_PAGES: usize = 20;

/// ASYS_USERS keeps one row per user property (user id in NAME, property key and value in two
/// further columns, GROUPID as property group). The Users tab shows one row per user with the
/// BASIC properties as columns. Secret-looking keys and values are never taken over.
pub fn pivot_users(columns: &[String], rows: &[Vec<Option<String>>], truncated: bool) -> Option<TableDump> {
    let find = |f: &dyn Fn(&str) -> bool| columns.iter().position(|c| f(&c.to_ascii_uppercase()));
    let user = find(&|c| c == "NAME")?;
    let key = find(&|c| c.contains("KEY"))?;
    let value = find(&|c| c.contains("VAL"))?;
    let mut order: Vec<String> = Vec::new();
    let mut per_user: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        let (Some(u), Some(k)) = (row.get(user)?.clone(), row.get(key)?.clone()) else { continue };
        if is_secret_key(&k) {
            continue;
        }
        let v = row.get(value)?.clone().map(|v| redact_text(&v)).unwrap_or_default();
        if !per_user.contains_key(&u) {
            order.push(u.clone());
        }
        per_user.entry(u).or_default().insert(k.clone(), v);
        *counts.entry(k).or_default() += 1;
    }
    let mut shown: Vec<String> = Vec::new();
    for wanted in USER_COLUMNS {
        if let Some(k) = counts.keys().find(|k| k.eq_ignore_ascii_case(wanted)) {
            shown.push(k.clone());
        }
    }
    let mut extra: Vec<(&String, &usize)> = counts.iter().filter(|(k, _)| !shown.contains(k)).collect();
    extra.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    shown.extend(extra.into_iter().take(4).map(|(k, _)| k.clone()));
    let out_rows = order.iter().map(|u| shown.iter().map(|k| per_user[u].get(k).cloned()).collect()).collect();
    Some(TableDump { columns: shown, rows: out_rows, hidden_columns: Vec::new(), truncated })
}

/// Users tab of the system editor: one row per user, no credential column.
pub fn read_users(manager: &DbManager) -> Result<TableDump, String> {
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;
    for page in 0..USER_PAGES {
        let sql = format!("SELECT * FROM ASYS_USERS WHERE GROUPID = 'BASIC' ORDER BY ID LIMIT {} OFFSET {}", crate::db_session::MAX_ROWS, page * crate::db_session::MAX_ROWS);
        let Ok(result) = manager.query(&sql, false) else {
            if page == 0 {
                return dump(manager, "SELECT * FROM ASYS_USERS");
            }
            break;
        };
        if columns.is_empty() {
            columns = result.columns.clone();
        }
        let n = result.rows.len();
        rows.extend(result.rows);
        if n < crate::db_session::MAX_ROWS {
            break;
        }
        truncated = page + 1 == USER_PAGES;
    }
    match pivot_users(&columns, &rows, truncated) {
        Some(table) => Ok(table),
        None => dump(manager, "SELECT * FROM ASYS_USERS"),
    }
}

/// Alias config rows of one server id (`dev`, `dev-bg`, ...) from ASYS_ALIASCONFIG, the list of
/// the system editor. Without any matching row all rows are listed, so the editor is never empty
/// only because the server id guess was wrong.
pub fn read_system_alias_list(manager: &DbManager, server_ids: &[String]) -> Result<Vec<AliasConfigDto>, String> {
    let ids: Vec<String> = server_ids.iter().filter(|i| !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).map(|i| format!("'{i}'")).collect();
    let run = |filter: &str| -> Result<crate::db_session::SqlResult, String> {
        let with_text = format!("SELECT ALIASID, DESCRIPTION, CAST(XMLDATA AS CHAR) FROM ASYS_ALIASCONFIG{filter} ORDER BY ALIASID");
        manager.query(&with_text, false).or_else(|_| manager.query(&format!("SELECT ALIASID, DESCRIPTION FROM ASYS_ALIASCONFIG{filter} ORDER BY ALIASID"), false))
    };
    let mut result = if ids.is_empty() { run("")? } else { run(&format!(" WHERE SERVERID IN ({})", ids.join(", ")))? };
    if result.rows.is_empty() && !ids.is_empty() {
        result = run("")?;
    }
    let mut out: Vec<AliasConfigDto> = Vec::new();
    for row in &result.rows {
        let Some(Some(alias)) = row.first() else { continue };
        if out.iter().any(|a| &a.name == alias) {
            continue;
        }
        let description = row.get(1).and_then(|d| d.as_deref());
        let xml = row.get(2).and_then(|d| d.as_deref());
        out.push(alias_row_to_dto(alias, description, xml));
    }
    if !out.iter().any(|a| a.name.eq_ignore_ascii_case("_____CONFIGURATION")) {
        out.push(alias_row_to_dto("_____CONFIGURATION", None, None));
    }
    out.sort_by_key(|a| a.name.to_ascii_lowercase());
    Ok(out)
}

/// Connection data of one database alias, read from the system database (session of `manager`).
/// The password stays in memory in the returned value and is never printed.
pub fn read_alias_db(manager: &DbManager, alias_id: &str) -> Result<crate::db_session::DbAlias, String> {
    if alias_id.is_empty() || !alias_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("The alias name contains characters that are not allowed.".into());
    }
    let result = manager.query(&format!("SELECT CAST(XMLDATA AS CHAR) FROM ASYS_ALIASCONFIG WHERE ALIASID = '{alias_id}'"), false)?;
    for row in &result.rows {
        if let Some(Some(xml)) = row.first() {
            if let Some(alias) = crate::system_config::alias_db_connection(xml) {
                return Ok(alias);
            }
        }
    }
    Err(format!("No connection data (host, database, user) found for {alias_id} in ASYS_ALIASCONFIG."))
}

/// Alias configs from ASYS_ALIASCONFIG; there must always be `___SYSTEMALIAS` and `Data_alias`.
pub fn read_alias_configs(manager: &DbManager) -> Result<AliasConfigTable, String> {
    let table = dump(manager, "SELECT * FROM ASYS_ALIASCONFIG")?;
    let missing_required = REQUIRED_ALIASES
        .iter()
        .filter(|name| !table.rows.iter().flatten().flatten().any(|cell| cell == *name))
        .map(|s| s.to_string())
        .collect();
    Ok(AliasConfigTable { table, missing_required })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeployMapping {
    pub table: String,
    pub name_column: String,
    pub content_column: String,
}

impl Default for DeployMapping {
    fn default() -> Self {
        Self { table: "ASYS_SYSTEM".into(), name_column: "ID".into(), content_column: "CONTENT".into() }
    }
}

fn is_identifier(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl DeployMapping {
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
    pub content: String,
    /// Files next to the main file that are NOT transferred (format unverified).
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
        let mut models: Vec<_> = std::fs::read_dir(t.path()).map_err(|e| e.to_string())?.flatten().filter(|e| e.path().is_dir()).collect();
        models.sort_by_key(|e| e.file_name());
        for m in models {
            let name = m.file_name().to_string_lossy().into_owned();
            let main_file = m.path().join(format!("{name}.aod"));
            if !main_file.is_file() {
                continue;
            }
            let content = std::fs::read_to_string(&main_file).map_err(|e| format!("{} is not readable text: {e}", main_file.display()))?;
            let extra_files = count_files(&m.path()).saturating_sub(1);
            out.push(LocalModel { key: format!("{type_name}/{name}"), main_file, content, extra_files });
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

fn live_columns(manager: &DbManager, mapping: &DeployMapping) -> Result<Vec<String>, String> {
    let sql = format!("SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '{}'", mapping.table);
    let r = manager.query(&sql, false)?;
    Ok(r.rows.into_iter().filter_map(|row| row.into_iter().next().flatten()).collect())
}

fn remote_models(manager: &DbManager, mapping: &DeployMapping) -> Result<BTreeMap<String, String>, String> {
    let sql = format!("SELECT `{}`, `{}` FROM `{}`", mapping.name_column, mapping.content_column, mapping.table);
    let r = manager.query(&sql, false)?;
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
    let statements = build_statements(&current.mapping, &chosen, &local)?;
    manager.transaction(&statements)?;
    Ok(DeployOutcome { executed: statements.len(), target: current.target })
}

#[cfg(test)]
mod tests {
    use super::*;
    use db_layer::mock::MockConnection;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn result(columns: &[&str], rows: Vec<Vec<Option<&str>>>) -> SqlResult {
        SqlResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            rows: rows.into_iter().map(|r| r.into_iter().map(|c| c.map(String::from)).collect()).collect(),
            truncated: false,
            elapsed_ms: 0,
        }
    }

    fn model(key: &str, content: &str) -> LocalModel {
        LocalModel { key: key.into(), main_file: PathBuf::new(), content: content.into(), extra_files: 0 }
    }

    #[test]
    fn users_are_pivoted_to_one_row_per_user_without_secrets() {
        let cols: Vec<String> = ["ID", "NAME", "GROUPID", "PROPKEY", "PROPVAL"].iter().map(|c| c.to_string()).collect();
        let row = |u: &str, k: &str, v: &str| vec![Some("1".to_string()), Some(u.to_string()), Some("BASIC".to_string()), Some(k.to_string()), Some(v.to_string())];
        let rows = vec![
            row("u1", "email", "a@b.c"),
            row("u1", "isActive", "true"),
            row("u1", "lastname", "Admin"),
            row("u1", "password", "HUSH"),
            row("u2", "lastname", "Second"),
        ];
        let t = pivot_users(&cols, &rows, false).unwrap();
        assert_eq!(t.columns, vec!["isActive", "email", "lastname"]);
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.rows[0], vec![Some("true".into()), Some("a@b.c".into()), Some("Admin".into())]);
        assert_eq!(t.rows[1], vec![None, None, Some("Second".into())]);
        assert!(!format!("{t:?}").contains("HUSH"));
    }

    #[test]
    fn users_without_a_key_column_are_not_pivoted() {
        let cols: Vec<String> = ["ID", "LOGIN"].iter().map(|c| c.to_string()).collect();
        assert!(pivot_users(&cols, &[], false).is_none());
    }

    #[test]
    fn secret_columns_are_dropped_and_listed() {
        let r = result(&["LOGINNAME", "PASSWORD", "ID"], vec![vec![Some("admin"), Some("topsecret"), Some("1")]]);
        let d = sanitize(&r, &[]);
        assert_eq!(d.columns, vec!["LOGINNAME", "ID"]);
        assert_eq!(d.hidden_columns, vec!["PASSWORD"]);
        assert_eq!(d.rows[0], vec![Some("admin".to_string()), Some("1".to_string())]);
    }

    #[test]
    fn secret_values_in_text_and_key_value_rows_are_masked() {
        assert_eq!(redact_text("jdbc:x?user=a&password=abc123&ssl=1"), "jdbc:x?user=a&password=***&ssl=1");
        assert_eq!(redact_text(r#"<entry key="password" value="abc123"/>"#), r#"<entry key="password" value="***"/>"#);
        assert_eq!(redact_text(r#"{"token":"abc"}"#), r#"{"token":"***"}"#);
        let r = result(&["PROPERTY", "VALUE"], vec![vec![Some("dbpassword"), Some("abc")], vec![Some("host"), Some("db1")]]);
        let d = sanitize(&r, &[]);
        assert_eq!(d.rows[0][1].as_deref(), Some("***"));
        assert_eq!(d.rows[1][1].as_deref(), Some("db1"));
    }

    #[test]
    fn session_secrets_are_scrubbed_from_cells() {
        let r = result(&["NOTE"], vec![vec![Some("login with hunter2 works")]]);
        assert_eq!(sanitize(&r, &["hunter2"]).rows[0][0].as_deref(), Some("login with *** works"));
    }

    #[test]
    fn users_and_alias_configs_read_through_the_session_without_secrets() {
        let manager = DbManager::default();
        manager.attach_connection(Box::new(MockConnection::default()), vec![]);
        // The mock echoes the SQL as a single column "echo"; that proves the read statements.
        let users = read_users(&manager).unwrap();
        assert_eq!(users.rows[0][0].as_deref(), Some("SELECT * FROM ASYS_USERS"));
        let aliases = read_alias_configs(&manager).unwrap();
        assert_eq!(aliases.missing_required, vec!["___SYSTEMALIAS", "Data_alias"]);
    }

    #[test]
    fn mapping_rejects_injection_and_unknown_columns() {
        let bad = DeployMapping { table: "ASYS_SYSTEM; DROP TABLE x".into(), ..Default::default() };
        assert!(bad.validate().is_err());
        let m = DeployMapping::default();
        assert!(m.verify_columns(&["id".into(), "content".into()]).is_ok());
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
        let s = build_statements(&DeployMapping::default(), &items, &local).unwrap();
        assert_eq!(s[0].sql, "INSERT INTO `ASYS_SYSTEM` (`ID`, `CONTENT`) VALUES (?, ?)");
        assert_eq!(s[1].sql, "UPDATE `ASYS_SYSTEM` SET `CONTENT` = ? WHERE `ID` = ?");
        assert_eq!(s[2].sql, "DELETE FROM `ASYS_SYSTEM` WHERE `ID` = ?");
        assert_eq!(s[1].params, vec![DbValue::Text("<b/>".into()), DbValue::Text("entity/B".into())]);
        assert!(!s.iter().any(|x| x.sql.contains("<b/>")), "values are bound, never spliced");
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
        use db_layer::DbConnection;
        assert!(rt.block_on(failing.execute_transaction(&statements)).is_err());
        assert!(failing.committed.lock().unwrap().is_empty(), "nothing is committed after a failure");
        let bad = DbManager::default();
        bad.attach_connection(Box::new(failing), vec![]);
        assert!(bad.transaction(&statements).is_err());
    }
}
