//! Lage und Größe eines Fensters für `designer.conf` (Abschnitte `[window]` und `[popups.<name>]`) und die Regel,
//! wann sie beim nächsten Start noch gelten. Ohne Tauri, damit die Regeln testbar sind.
//!
//! Gespeichert wird in physischen Pixeln: Position (`x`, `y`), Größe (`width`, `height`), der Name des
//! Bildschirms (`monitor`) und nur wenn wahr `maximized`. Ein maximiertes Fenster behält die letzte normale
//! Lage, damit "Wiederherstellen" nach dem Start dorthin zurückgeht.

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub monitor: Option<String>,
    pub maximized: bool,
}

/// Ein angeschlossener Bildschirm (physische Pixel).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Screen {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Liest einen gespeicherten Abschnitt; fehlen Lage oder Größe, gibt es nichts wiederherzustellen.
#[must_use]
pub fn from_json(section: &Value) -> Option<Saved> {
    let int = |k: &str| section.get(k).and_then(Value::as_i64);
    let (width, height) = (int("width")?, int("height")?);
    if width < 100 || height < 60 {
        return None;
    }
    Some(Saved {
        x: i32::try_from(int("x")?).ok()?,
        y: i32::try_from(int("y")?).ok()?,
        width: u32::try_from(width).ok()?,
        height: u32::try_from(height).ok()?,
        monitor: section.get("monitor").and_then(Value::as_str).map(str::to_string),
        maximized: section.get("maximized").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// Der Abschnitt zum Speichern; `maximized` und `monitor` fehlen, wenn sie leer bzw. falsch sind.
#[must_use]
pub fn to_json(saved: &Saved) -> Value {
    json!({
        "x": saved.x,
        "y": saved.y,
        "width": saved.width,
        "height": saved.height,
        "monitor": saved.monitor,
        "maximized": if saved.maximized { Some(true) } else { None },
    })
}

fn center(s: &Saved) -> (i64, i64) {
    (i64::from(s.x) + i64::from(s.width) / 2, i64::from(s.y) + i64::from(s.height) / 2)
}

fn contains(screen: &Screen, point: (i64, i64)) -> bool {
    point.0 >= i64::from(screen.x) && point.0 < i64::from(screen.x) + i64::from(screen.width) && point.1 >= i64::from(screen.y) && point.1 < i64::from(screen.y) + i64::from(screen.height)
}

/// Lage, die beim Start gilt: auf dem gemerkten Bildschirm, sonst auf dem Bildschirm, auf dem die Mitte des
/// Fensters liegt. Passt es auf keinen angeschlossenen Bildschirm mehr (Monitor abgesteckt), gibt es `None`,
/// und das Fenster startet an seiner Standardstelle. Das Ergebnis wird in den Bildschirm hineingeschoben und
/// nötigenfalls verkleinert, damit es nie halb außerhalb liegt (`x`, `y`, `width`, `height`).
#[must_use]
pub fn fit(saved: &Saved, screens: &[Screen]) -> Option<(i32, i32, u32, u32)> {
    let by_name = saved.monitor.as_deref().and_then(|name| screens.iter().find(|s| s.name.as_deref() == Some(name)));
    let screen = by_name.or_else(|| screens.iter().find(|s| contains(s, center(saved))))?;
    let width = saved.width.min(screen.width);
    let height = saved.height.min(screen.height);
    let max_x = i64::from(screen.x) + i64::from(screen.width) - i64::from(width);
    let max_y = i64::from(screen.y) + i64::from(screen.height) - i64::from(height);
    let x = i64::from(saved.x).clamp(i64::from(screen.x), max_x);
    let y = i64::from(saved.y).clamp(i64::from(screen.y), max_y);
    Some((i32::try_from(x).ok()?, i32::try_from(y).ok()?, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(name: &str, x: i32, y: i32, w: u32, h: u32) -> Screen {
        Screen { name: Some(name.into()), x, y, width: w, height: h }
    }

    fn saved(x: i32, y: i32, w: u32, h: u32, monitor: Option<&str>) -> Saved {
        Saved { x, y, width: w, height: h, monitor: monitor.map(str::to_string), maximized: false }
    }

    #[test]
    fn a_window_on_a_connected_screen_comes_back_where_it_was() {
        let screens = [screen("A", 0, 0, 1920, 1080), screen("B", 1920, 0, 2560, 1440)];
        assert_eq!(fit(&saved(2000, 100, 1200, 800, Some("B")), &screens), Some((2000, 100, 1200, 800)));
    }

    #[test]
    fn a_window_whose_screen_is_gone_falls_back_to_the_default_place() {
        let screens = [screen("A", 0, 0, 1920, 1080)];
        assert_eq!(fit(&saved(2500, 100, 1200, 800, Some("B")), &screens), None);
    }

    #[test]
    fn the_remembered_screen_wins_and_a_window_is_pushed_back_inside_it() {
        let screens = [screen("A", 0, 0, 1920, 1080), screen("B", 1920, 0, 1280, 720)];
        // Auf B gespeichert, B ist jetzt kleiner: verkleinert und hineingeschoben.
        assert_eq!(fit(&saved(2600, 400, 1800, 900, Some("B")), &screens), Some((1920, 0, 1280, 720)));
    }

    #[test]
    fn without_a_monitor_name_the_screen_under_the_center_decides() {
        let screens = [screen("A", 0, 0, 1920, 1080), screen("B", 1920, 0, 1920, 1080)];
        assert_eq!(fit(&saved(1900, 50, 400, 300, None), &screens), Some((1920, 50, 400, 300)));
        assert_eq!(fit(&saved(-3000, 0, 400, 300, None), &screens), None);
    }

    #[test]
    fn sections_round_trip_and_leave_out_false_and_empty_values() {
        let s = Saved { x: -10, y: 20, width: 1280, height: 800, monitor: None, maximized: false };
        let j = to_json(&s);
        assert_eq!(from_json(&j), Some(s));
        let max = Saved { maximized: true, monitor: Some("DP-1".into()), ..saved(0, 0, 800, 600, None) };
        assert_eq!(from_json(&to_json(&max)), Some(max));
        assert!(from_json(&json!({ "x": 1, "y": 2 })).is_none());
        assert!(from_json(&json!({ "x": 1, "y": 2, "width": 10, "height": 10 })).is_none());
    }

    #[test]
    fn the_saved_section_has_no_null_and_no_false_after_cleaning() {
        let mut t = toml::Table::new();
        crate::config::set_section(&mut t, "window", &to_json(&saved(1, 2, 800, 600, None)));
        let text = toml::to_string(&t).unwrap();
        assert!(!text.contains("maximized") && !text.contains("monitor"), "{text}");
    }
}
