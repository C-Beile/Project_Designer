//! Names of the operating-system windows (floating panels and dialogs). Kept free of any Tauri
//! type so the rules can be tested; `app/src-tauri/src/os_windows.rs` opens the windows.

pub const FLOAT_VIEWS: [&str; 4] = ["scm", "services", "navigator", "properties"];

/// Window label of a kind and name; only known names and plain identifiers pass.
pub fn label_of(kind: &str, name: &str) -> Result<String, String> {
    let plain = !name.is_empty() && name.len() <= 40 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    match kind {
        "float" if FLOAT_VIEWS.contains(&name) => Ok(format!("float-{name}")),
        "dialog" if plain => Ok(format!("dialog-{name}")),
        "editor" if plain => Ok(format!("editor-{name}")),
        _ => Err(format!("'{kind}/{name}' cannot be opened as a window.")),
    }
}

/// Splits `float-scm` / `dialog-new` / `editor-ed-1a2b` back into kind and name.
pub fn parse_label(label: &str) -> Option<(&'static str, &str)> {
    label
        .strip_prefix("float-")
        .map(|n| ("float", n))
        .or_else(|| label.strip_prefix("dialog-").map(|n| ("dialog", n)))
        .or_else(|| label.strip_prefix("editor-").map(|n| ("editor", n)))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_floats_and_plain_dialog_names_get_a_label() {
        assert_eq!(label_of("float", "scm").unwrap(), "float-scm");
        assert_eq!(label_of("dialog", "new").unwrap(), "dialog-new");
        assert!(label_of("float", "output").is_err());
        assert!(label_of("dialog", "../x").is_err());
        assert!(label_of("dialog", "").is_err());
        assert!(label_of("panel", "scm").is_err());
        assert_eq!(label_of("editor", "ed-1a2b3c4d").unwrap(), "editor-ed-1a2b3c4d");
        assert!(label_of("editor", "Ed 1").is_err());
        assert!(label_of("editor", "").is_err());
    }

    #[test]
    fn labels_split_back_into_kind_and_name() {
        assert_eq!(parse_label("float-navigator"), Some(("float", "navigator")));
        assert_eq!(parse_label("dialog-open"), Some(("dialog", "open")));
        assert_eq!(parse_label("editor-ed-1a2b"), Some(("editor", "ed-1a2b")));
        assert_eq!(parse_label("main"), None);
    }
}
