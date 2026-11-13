//! `designer.conf`: die eine Konfigurationsdatei der App (TOML, im App-Datenordner).
//!
//! Regeln:
//! - Jede Art von Einstellung hat einen eigenen Abschnitt (`[general]`, `[ssh]`, `[window]`, `[popups.git]` ...).
//! - Leere Werte (`null`, leere Listen, leere Abschnitte) werden nie gespeichert; sie fehlen einfach.
//! - Pfade stehen immer mit `/`, nie mit `\` (Laufwerkspfade `C:\x` und UNC-Pfade `\\host\x`).
//! - Lesen ist nachsichtig: eine fehlende oder beschädigte Datei ergibt eine leere Konfiguration.
//! - Geschrieben wird atomar (`platform::fs::atomic_write`).

use serde_json::Value as Json;
use std::path::Path;
use toml::{Table, Value};

pub const CONFIG_FILE_NAME: &str = "designer.conf";

const HEADER: &str = "# Dito Designer: Einstellungen. Wird vom Designer geschrieben; Pfade immer mit /.\n\n";

/// Liest die Konfiguration; fehlt die Datei oder ist sie beschädigt, ist sie leer.
#[must_use]
pub fn load(file: &Path) -> Table {
    std::fs::read_to_string(file).ok().and_then(|text| text.parse::<Table>().ok()).unwrap_or_default()
}

static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Lesen, ändern, schreiben unter einem Schloss: gleichzeitige Änderungen (Einstellungen, Fenster, Oberfläche)
/// überschreiben sich nie gegenseitig.
pub fn update<T>(file: &Path, change: impl FnOnce(&mut Table) -> T) -> Result<T, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut table = load(file);
    let out = change(&mut table);
    save(file, &table)?;
    Ok(out)
}

/// Schreibt die Konfiguration atomar.
pub fn save(file: &Path, table: &Table) -> Result<(), String> {
    let text = toml::to_string_pretty(table).map_err(|e| e.to_string())?;
    platform::fs::atomic_write(file, format!("{HEADER}{text}").as_bytes()).map_err(|e| e.to_string())
}

/// Ein Pfad mit Schrägstrichen: `C:\a\b` und `\\host\share\x` werden zu `C:/a/b` und `//host/share/x`.
/// Andere Texte (auch solche mit Backslash, etwa reguläre Ausdrücke) bleiben unverändert.
#[must_use]
pub fn slash_path(text: &str) -> String {
    let b = text.as_bytes();
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    let unc = text.starts_with("\\\\") && text.len() > 2 && !text[2..].starts_with('\\');
    if drive || unc {
        text.replace('\\', "/")
    } else {
        text.to_string()
    }
}

/// JSON zu TOML: `null` fällt weg (auch in Listen), Pfade bekommen Schrägstriche, leere Tabellen fallen weg.
#[must_use]
pub fn clean(value: &Json) -> Option<Value> {
    match value {
        Json::Null => None,
        Json::Bool(b) => Some(Value::Boolean(*b)),
        Json::Number(n) => n.as_i64().map(Value::Integer).or_else(|| n.as_f64().filter(|f| f.is_finite()).map(Value::Float)),
        Json::String(s) => Some(Value::String(slash_path(s))),
        Json::Array(items) => {
            let kept: Vec<Value> = items.iter().filter_map(clean).collect();
            if kept.is_empty() {
                None
            } else {
                Some(Value::Array(kept))
            }
        }
        Json::Object(map) => {
            let mut table = Table::new();
            for (k, v) in map {
                if let Some(v) = clean(v) {
                    table.insert(slash_path(k), v);
                }
            }
            if table.is_empty() {
                None
            } else {
                Some(Value::Table(table))
            }
        }
    }
}

/// TOML zu JSON (für die Oberfläche).
#[must_use]
pub fn to_json(value: &Value) -> Json {
    match value {
        Value::String(s) => Json::String(s.clone()),
        Value::Integer(i) => Json::from(*i),
        Value::Float(f) => serde_json::Number::from_f64(*f).map_or(Json::Null, Json::Number),
        Value::Boolean(b) => Json::Bool(*b),
        Value::Datetime(d) => Json::String(d.to_string()),
        Value::Array(a) => Json::Array(a.iter().map(to_json).collect()),
        Value::Table(t) => Json::Object(t.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
    }
}

/// Die ganze Konfiguration als JSON.
#[must_use]
pub fn table_to_json(table: &Table) -> Json {
    Json::Object(table.iter().map(|(k, v)| (k.clone(), to_json(v))).collect())
}

/// Der Abschnitt `a.b.c` (Teile durch Punkt getrennt), falls vorhanden.
#[must_use]
pub fn get_section<'a>(table: &'a Table, path: &str) -> Option<&'a Value> {
    let mut parts = path.split('.');
    let mut current = table.get(&slash_path(parts.next()?))?;
    for part in parts {
        current = current.as_table()?.get(&slash_path(part))?;
    }
    Some(current)
}

/// Ersetzt den Abschnitt `a.b.c` durch `value` (bereinigt); ist das Ergebnis leer, verschwindet der Abschnitt.
pub fn set_section(table: &mut Table, path: &str, value: &Json) {
    let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
    set_path(table, &parts, value);
}

/// Wie `set_section`, der Pfad kommt aber als Liste: ein Teil darf Punkte und Schrägstriche enthalten
/// (etwa ein Projektordner als Schlüssel).
pub fn set_path<S: AsRef<str>>(table: &mut Table, path: &[S], value: &Json) {
    let parts: Vec<&str> = path.iter().map(AsRef::as_ref).filter(|p| !p.is_empty()).collect();
    let Some((last, parents)) = parts.split_last() else { return };
    let cleaned = clean(value);
    set_in(table, parents, last, cleaned);
}

/// Der Wert unter dem Pfad (Liste von Teilen) als JSON, falls vorhanden.
#[must_use]
pub fn get_path<S: AsRef<str>>(table: &Table, path: &[S]) -> Option<Json> {
    let mut parts = path.iter();
    let mut current = table.get(&slash_path(parts.next()?.as_ref()))?;
    for part in parts {
        current = current.as_table()?.get(&slash_path(part.as_ref()))?;
    }
    Some(to_json(current))
}

fn set_in(table: &mut Table, parents: &[&str], last: &str, value: Option<Value>) {
    let owned_last = slash_path(last);
    let last = owned_last.as_str();
    match parents.split_first() {
        None => match value {
            Some(v) => {
                table.insert(last.to_string(), v);
            }
            None => {
                table.remove(last);
            }
        },
        Some((head, rest)) => {
            let head = &slash_path(head)[..];
            let entry = table.entry(head.to_string()).or_insert_with(|| Value::Table(Table::new()));
            if !entry.is_table() {
                *entry = Value::Table(Table::new());
            }
            let inner = entry.as_table_mut().expect("just made a table");
            set_in(inner, rest, last, value);
            if inner.is_empty() {
                table.remove(head);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paths_get_slashes_but_other_texts_stay() {
        assert_eq!(slash_path("C:\\Adito\\Projects\\x"), "C:/Adito/Projects/x");
        assert_eq!(slash_path("\\\\srv\\share\\a"), "//srv/share/a");
        assert_eq!(slash_path("D:/already/ok"), "D:/already/ok");
        assert_eq!(slash_path("^\\d+\\.aod$"), "^\\d+\\.aod$");
        assert_eq!(slash_path("a\\b"), "a\\b");
    }

    #[test]
    fn nulls_and_empty_sections_are_not_stored() {
        let mut t = Table::new();
        set_section(&mut t, "general", &json!({ "designer_install_dir": null, "name": "x", "list": [null, "C:\\a"] }));
        assert_eq!(to_json(get_section(&t, "general").unwrap()), json!({ "name": "x", "list": ["C:/a"] }));
        set_section(&mut t, "general", &json!({ "designer_install_dir": null, "empty": [], "also_empty": [null] }));
        assert!(get_section(&t, "general").is_none());
    }

    #[test]
    fn a_path_part_may_contain_dots_and_slashes_and_is_quoted_in_the_file() {
        let mut t = Table::new();
        let key = "C:/Adito/Projects/a.b";
        set_path(&mut t, &["git", "excluded", key], &json!(["x.aod"]));
        assert_eq!(get_path(&t, &["git", "excluded", key]), Some(json!(["x.aod"])));
        let text = toml::to_string(&t).unwrap();
        assert!(text.contains("[git.excluded]") && text.contains("\"C:/Adito/Projects/a.b\""), "{text}");
    }

    #[test]
    fn dotted_sections_nest_and_clean_up_after_themselves() {
        let mut t = Table::new();
        set_section(&mut t, "popups.git", &json!({ "x": 10, "y": 20, "width": 800.5 }));
        set_section(&mut t, "popups.sync", &json!({ "x": 1 }));
        assert_eq!(to_json(get_section(&t, "popups.git").unwrap())["x"], json!(10));
        set_section(&mut t, "popups.git", &json!(null));
        set_section(&mut t, "popups.sync", &json!(null));
        assert!(get_section(&t, "popups").is_none());
    }

    #[test]
    fn the_file_is_readable_toml_with_a_section_per_kind_and_round_trips() {
        let dir = std::env::temp_dir().join(format!("designer-conf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(CONFIG_FILE_NAME);
        let mut t = Table::new();
        set_section(&mut t, "general", &json!({ "designer_install_dir": "C:\\Program Files\\ADITO" }));
        set_section(&mut t, "window", &json!({ "x": 100, "y": 50, "maximized": false }));
        save(&file, &t).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        let back = load(&file);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(text.contains("[general]") && text.contains("[window]"), "{text}");
        assert!(text.contains("designer_install_dir = \"C:/Program Files/ADITO\""), "{text}");
        assert!(!text.contains('\\'), "{text}");
        assert_eq!(back, t);
    }

    #[test]
    fn a_broken_or_missing_file_is_an_empty_configuration() {
        let dir = std::env::temp_dir().join(format!("designer-conf-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(CONFIG_FILE_NAME);
        assert!(load(&file).is_empty());
        std::fs::write(&file, "this = is = not toml [[").unwrap();
        let loaded = load(&file);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(loaded.is_empty());
    }
}
