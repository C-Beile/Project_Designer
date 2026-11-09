//! Reads of the system database (users, alias configs).
//!
//! Business rule: secrets (passwords, tokens, keys) never leave this module: secret-looking columns
//! are dropped, secret-looking values inside text cells are masked, and every secret of the open
//! session is scrubbed from all cell texts.

use crate::db_session::{DbManager, SqlResult};
use crate::system_config::{alias_row_to_dto, is_secret_key, AliasConfigDto};
use serde::Serialize;
use std::collections::BTreeMap;

pub const REQUIRED_ALIASES: [&str; 2] = ["___SYSTEMALIAS", "Data_alias"];

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drivers::mock::MockConnection;

    fn result(columns: &[&str], rows: Vec<Vec<Option<&str>>>) -> SqlResult {
        SqlResult {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            rows: rows.into_iter().map(|r| r.into_iter().map(|c| c.map(String::from)).collect()).collect(),
            truncated: false,
            elapsed_ms: 0,
        }
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
