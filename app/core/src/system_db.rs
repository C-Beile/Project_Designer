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
use crate::deploy_encode::{self, DEPLOY_META_ID, DEPLOY_META_KIND};
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
    /// Key of every row where the rows stand for something with an identity (the user name of the
    /// Users tab); empty for plain dumps.
    pub row_keys: Vec<String>,
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
    TableDump { columns: keep.iter().map(|&i| result.columns[i].clone()).collect(), rows, hidden_columns, truncated: result.truncated, row_keys: Vec::new() }
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
    // Like the original Designer the list has exactly these columns, sorted by title.
    if shown.is_empty() {
        let mut extra: Vec<(&String, &usize)> = counts.iter().collect();
        extra.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        shown.extend(extra.into_iter().take(4).map(|(k, _)| k.clone()));
    }
    let title_col = shown.iter().position(|c| c.eq_ignore_ascii_case("title"));
    let mut entries: Vec<(String, Vec<Option<String>>)> = order.iter().map(|u| (u.clone(), shown.iter().map(|k| per_user[u].get(k).cloned()).collect())).collect();
    if let Some(t) = title_col {
        entries.sort_by(|a, b| a.1[t].as_deref().unwrap_or("").cmp(b.1[t].as_deref().unwrap_or("")));
    }
    let row_keys = entries.iter().map(|e| e.0.clone()).collect();
    let out_rows = entries.into_iter().map(|e| e.1).collect();
    Some(TableDump { columns: shown, rows: out_rows, hidden_columns: Vec::new(), truncated, row_keys })
}

/// One property of a user (one row of ASYS_USERS). Secret-looking properties are listed with their
/// name only: no value, not editable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UserProperty {
    pub id: String,
    pub group: String,
    pub key: String,
    pub value: Option<String>,
    pub editable: bool,
}

const USER_VALUE_LIMIT: usize = 1024;

fn is_safe_word(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@'))
}

fn sql_text(v: &str) -> String {
    v.replace('\\', "\\\\").replace('\'', "''")
}

/// All properties of one user (every group), for the property list next to the Users tab.
pub fn read_user_properties(manager: &DbManager, user: &str) -> Result<Vec<UserProperty>, String> {
    if !is_safe_word(user, 63) {
        return Err("The user name contains characters that are not allowed.".into());
    }
    let sql = format!("SELECT ID, GROUPID, PROPKEY, PROPVAL FROM ASYS_USERS WHERE NAME = '{}' ORDER BY GROUPID, PROPKEY", sql_text(user));
    let result = manager.query(&sql, false)?;
    let mut out = Vec::new();
    for row in &result.rows {
        let (Some(Some(id)), Some(Some(key))) = (row.first(), row.get(2)) else { continue };
        let secret = is_secret_key(key);
        out.push(UserProperty {
            id: id.clone(),
            group: row.get(1).cloned().flatten().unwrap_or_default(),
            key: key.clone(),
            value: if secret { None } else { row.get(3).cloned().flatten().map(|v| redact_text(&v)) },
            editable: !secret,
        });
    }
    Ok(out)
}

/// Changes the value of one user property. Only called after the user confirmed; a secret property
/// or an unknown row is refused, and only that one row is touched.
pub fn update_user_property(manager: &DbManager, id: &str, value: &str) -> Result<(), String> {
    let is_id = id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if !is_id {
        return Err("The property id is not valid.".into());
    }
    if value.len() > USER_VALUE_LIMIT {
        return Err(format!("The value is longer than {USER_VALUE_LIMIT} characters."));
    }
    let found = manager.query(&format!("SELECT PROPKEY FROM ASYS_USERS WHERE ID = '{id}'"), false)?;
    let Some(Some(key)) = found.rows.first().and_then(|r| r.first()) else {
        return Err("This property does not exist (anymore). Reload the list.".into());
    };
    if is_secret_key(key) {
        return Err("Passwords and keys are not changed here.".into());
    }
    manager.query(&format!("UPDATE ASYS_USERS SET PROPVAL = '{}', DATE_EDIT = NOW() WHERE ID = '{id}'", sql_text(value)), true)?;
    Ok(())
}

const USER_PREFIX: &str = "_____USER_";

fn check_user_name(user: &str) -> Result<(), String> {
    if !is_safe_word(user, 63) {
        return Err("The user name contains characters that are not allowed.".into());
    }
    Ok(())
}

fn check_property_key(key: &str) -> Result<(), String> {
    if !is_safe_word(key, 200) {
        return Err("The property name contains characters that are not allowed.".into());
    }
    if is_secret_key(key) {
        return Err("Passwords and keys are not changed here.".into());
    }
    Ok(())
}

/// The group a property belongs to: the one other users already use for that key, otherwise the
/// group of its kind, otherwise BASIC.
fn property_group(manager: &DbManager, key: &str) -> String {
    let sql = format!("SELECT GROUPID FROM ASYS_USERS WHERE PROPKEY = '{}' AND GROUPID IS NOT NULL LIMIT 1", sql_text(key));
    if let Ok(found) = manager.query(&sql, false) {
        if let Some(Some(group)) = found.rows.first().and_then(|r| r.first()) {
            return group.clone();
        }
    }
    match key {
        "country" | "language" | "locale" | "timezone" => "LOCALIZATION",
        "nonWorkdays" | "showWeekend" => "CALENDAR",
        _ => "BASIC",
    }
    .to_string()
}

fn insert_property(manager: &DbManager, user: &str, key: &str, value: &str, group: &str) -> Result<(), String> {
    manager.query(
        &format!(
            "INSERT INTO ASYS_USERS (ID, DATE_NEW, DATE_EDIT, NAME, GROUPID, PROPKEY, PROPVAL) VALUES (UUID(), NOW(), NOW(), '{}', '{}', '{}', '{}')",
            sql_text(user),
            sql_text(group),
            sql_text(key),
            sql_text(value)
        ),
        true,
    )?;
    Ok(())
}

/// Sets one single-valued property of a user: changes the row when the user has it, otherwise adds it.
pub fn set_user_property(manager: &DbManager, user: &str, key: &str, value: &str) -> Result<(), String> {
    check_user_name(user)?;
    check_property_key(key)?;
    if value.len() > USER_VALUE_LIMIT {
        return Err(format!("The value is longer than {USER_VALUE_LIMIT} characters."));
    }
    let found = manager.query(&format!("SELECT ID FROM ASYS_USERS WHERE NAME = '{}' AND PROPKEY = '{}'", sql_text(user), sql_text(key)), false)?;
    if found.rows.len() > 1 {
        return Err("This property has several values. Use the list editor for it.".into());
    }
    if let Some(Some(id)) = found.rows.first().and_then(|r| r.first()) {
        return update_user_property(manager, id, value);
    }
    let group = property_group(manager, key);
    insert_property(manager, user, key, value, &group)
}

/// Replaces all values of a list property (roleNames ...): one row per value.
pub fn set_user_list_property(manager: &DbManager, user: &str, key: &str, values: &[String]) -> Result<(), String> {
    check_user_name(user)?;
    check_property_key(key)?;
    if values.iter().any(|v| v.is_empty() || v.len() > USER_VALUE_LIMIT) {
        return Err("A value of the list is empty or too long.".into());
    }
    let group = property_group(manager, key);
    manager.query(&format!("DELETE FROM ASYS_USERS WHERE NAME = '{}' AND PROPKEY = '{}'", sql_text(user), sql_text(key)), true)?;
    for v in values {
        insert_property(manager, user, key, v, &group)?;
    }
    Ok(())
}

/// Adds a user with its basic properties and returns its id. It has no password yet.
pub fn create_user(manager: &DbManager, title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() || title.len() > 200 || title.contains(|c: char| c.is_control()) {
        return Err("Enter a user name without control characters.".into());
    }
    let taken = manager.query(&format!("SELECT ID FROM ASYS_USERS WHERE PROPKEY = 'title' AND PROPVAL = '{}' LIMIT 1", sql_text(title)), false)?;
    if !taken.rows.is_empty() {
        return Err("A user with this name exists already.".into());
    }
    let uuid = manager.query("SELECT UUID()", false)?;
    let Some(Some(uuid)) = uuid.rows.first().and_then(|r| r.first()) else {
        return Err("The database did not return an id.".into());
    };
    let user = format!("{USER_PREFIX}{uuid}");
    insert_property(manager, &user, "name", &user, "BASIC")?;
    insert_property(manager, &user, "title", title, "BASIC")?;
    insert_property(manager, &user, "isActive", "true", "BASIC")?;
    insert_property(manager, &user, "isBlocked", "false", "BASIC")?;
    Ok(user)
}

/// Removes a user with all of its properties. Only called after the user confirmed.
pub fn delete_user(manager: &DbManager, user: &str) -> Result<(), String> {
    check_user_name(user)?;
    if !user.starts_with(USER_PREFIX) {
        return Err("Only users that were created in the Designer can be removed here.".into());
    }
    manager.query(&format!("DELETE FROM ASYS_USERS WHERE NAME = '{}'", sql_text(user)), true)?;
    Ok(())
}

/// Users tab of the system editor: one row per user, no credential column.
/// The roles of the platform itself; they are not defined in any project but can be given to a user.
const BUILT_IN_ROLES: &[&str] = &["INTERNAL_ADMINISTRATOR", "INTERNAL_EVERYONE", "INTERNAL_TECHNICAL", "INTERNAL_WEBSERVICE"];

/// Every role a user of this system can be given besides the project's own roles: the platform's
/// built-in roles and every role that is already assigned to a user of the system.
pub fn assigned_roles(manager: &DbManager) -> Result<Vec<String>, String> {
    let result = manager.query("SELECT DISTINCT PROPVAL FROM ASYS_USERS WHERE PROPKEY = 'roleNames'", false)?;
    let mut roles: Vec<String> = BUILT_IN_ROLES.iter().map(|r| r.to_string()).collect();
    for row in result.rows {
        if let Some(Some(role)) = row.into_iter().next() {
            let role = role.trim().to_string();
            if !role.is_empty() && !roles.contains(&role) {
                roles.push(role);
            }
        }
    }
    roles.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(roles)
}

pub fn read_users(manager: &DbManager) -> Result<TableDump, String> {
    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;
    for page in 0..USER_PAGES {
        let sql = format!("SELECT * FROM ASYS_USERS WHERE PROPKEY IN ('isActive', 'title', 'email', 'firstname', 'lastname') ORDER BY ID LIMIT {} OFFSET {}", crate::db_session::MAX_ROWS, page * crate::db_session::MAX_ROWS);
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

/// Order in which the configs of one alias (one row per server id: `default`, `dev`, `dev-bg` ...)
/// are tried: the server ids of the system first, then every other specific one, `default` last
/// (`default` describes the local developer setup, for example localhost).
pub fn rank_server_ids(rows: &[(String, String)], wanted: &[String]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..rows.len()).collect();
    order.sort_by_key(|&i| {
        let id = rows[i].0.as_str();
        let rank = wanted.iter().position(|w| w.eq_ignore_ascii_case(id)).unwrap_or(usize::MAX - 1);
        let default_last = id.eq_ignore_ascii_case("default");
        (rank, default_last, id.len(), id.to_ascii_lowercase())
    });
    order
}

/// Connection data of one database alias, read from the system database (session of `manager`).
/// `server_ids` are the server ids of the system; its row wins over the other rows of the alias.
/// The password stays in memory in the returned value and is never printed.
pub fn read_alias_db(manager: &DbManager, alias_id: &str, server_ids: &[String]) -> Result<crate::db_session::DbAlias, String> {
    if alias_id.is_empty() || !alias_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("The alias name contains characters that are not allowed.".into());
    }
    let result = manager.query(&format!("SELECT COALESCE(SERVERID, ''), CAST(XMLDATA AS CHAR) FROM ASYS_ALIASCONFIG WHERE ALIASID = '{alias_id}'"), false)?;
    let rows: Vec<(String, String)> = result.rows.iter().filter_map(|r| Some((r.first()?.clone().unwrap_or_default(), r.get(1)?.clone()?))).collect();
    for i in rank_server_ids(&rows, server_ids) {
        if let Some(alias) = crate::system_config::alias_db_connection(&rows[i].1) {
            return Ok(alias);
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
        LocalModel { key: key.into(), main_file: PathBuf::new(), content: content.into(), kind: 189, title: None, extra_files: 0 }
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
        use db_layer::DbConnection;
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

#[cfg(test)]
mod alias_rank_tests {
    use super::*;

    fn rows(ids: &[&str]) -> Vec<(String, String)> {
        ids.iter().map(|i| (i.to_string(), String::new())).collect()
    }

    #[test]
    fn the_server_id_of_the_system_comes_first_and_default_last() {
        let r = rows(&["default", "dev-bg", "dev"]);
        let order = rank_server_ids(&r, &["dev".to_string()]);
        assert_eq!(order.iter().map(|&i| r[i].0.as_str()).collect::<Vec<_>>(), vec!["dev", "dev-bg", "default"]);
    }

    #[test]
    fn without_a_known_server_id_a_specific_row_still_beats_default() {
        let r = rows(&["default", "dev-bg", "dev"]);
        let order = rank_server_ids(&r, &[]);
        assert_eq!(r[order[0]].0, "dev");
        assert_eq!(r[order[2]].0, "default");
    }
}

#[cfg(test)]
mod user_property_tests {
    use super::*;

    #[test]
    fn quotes_text_and_accepts_only_plain_user_names() {
        assert_eq!(sql_text("it's a\\b"), "it''s a\\\\b");
        assert!(is_safe_word("___USER_7df12a4c-890f", 63));
        assert!(!is_safe_word("x' OR '1'='1", 63));
        assert!(!is_safe_word("", 63));
    }

    #[test]
    fn the_user_list_carries_the_user_name_of_every_row() {
        let columns: Vec<String> = ["NAME", "PROPKEY", "PROPVAL"].iter().map(|s| s.to_string()).collect();
        let row = |n: &str, k: &str, v: &str| vec![Some(n.to_string()), Some(k.to_string()), Some(v.to_string())];
        let table = pivot_users(&columns, &[row("u1", "title", "A"), row("u2", "title", "B"), row("u1", "password", "x")], false).unwrap();
        assert_eq!(table.row_keys, vec!["u1".to_string(), "u2".to_string()]);
        assert!(!table.columns.iter().any(|c| c.eq_ignore_ascii_case("password")));
    }
}
