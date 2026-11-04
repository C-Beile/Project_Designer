//! What the deploy writes into the system table (`ASYS_SYSTEM`): one row per model of `dist`, with
//! the model number (`KIND`) of its type and the model file as `XMLDATA`.
//!
//! Derived from a deployed system (FZ Juelich dev1) and checked against its rows:
//! - `ID` and `NAME` are the model name, `KIND` the number of the model type (`MODEL_KINDS`).
//! - `XMLDATA` is the model file of `dist` with the model mode `COMPACT` instead of `DISTRIBUTED`
//!   and every linked file (`%aditoprj%/process/X/process.js`) written into the element that
//!   pointed at it. The inlined text is XML-escaped (`&`, `<`, `>`), quotes stay, line breaks are
//!   CRLF, and the `export` keyword in front of a top-level declaration is dropped (the server
//!   runs a library as plain script; the imports stay). Images are written as Base64.

use std::path::Path;

/// Model type folder of `dist` and the `KIND` number the system table stores for it.
pub const MODEL_KINDS: &[(&str, i64)] = &[
    ("application", 102),
    ("process", 103),
    ("report", 120),
    ("preferences", 132),
    ("language", 139),
    ("role", 159),
    ("aliasDefinition", 187),
    ("entity", 189),
    ("system", 196),
    ("neonNotificationType", 10069),
    ("neonContext", 10077),
    ("neonView", 10078),
    ("neonDashboard", 10090),
    ("serviceDefinition", 10309),
];

/// Not deployed: the system table holds the rendered HTML of a help page (`userhelp`, kind 10217),
/// not the AsciiDoc source of `dist`; such rows are left alone.

/// The deploy's own bookkeeping row; never a project model.
pub const DEPLOY_META_ID: &str = "_____DEPLOY_META_INFOS";
pub const DEPLOY_META_KIND: i64 = 10306;

pub fn kind_of(folder: &str) -> Option<i64> {
    MODEL_KINDS.iter().find(|(f, _)| *f == folder).map(|(_, k)| *k)
}

pub fn folder_of(kind: i64) -> Option<&'static str> {
    MODEL_KINDS.iter().find(|(_, k)| *k == kind).map(|(f, _)| *f)
}

const LINK_PREFIX: &str = "%aditoprj%/";
const DISTRIBUTED: &str = "<majorModelMode>DISTRIBUTED</majorModelMode>";
const COMPACT: &str = "<majorModelMode>COMPACT</majorModelMode>";

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + text.len() / 16);
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
    out
}

/// The text of a linked file; a file that is not valid UTF-8 is read as Latin-1 (the old script
/// encoding of ADITO projects).
fn read_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{} is not readable: {e}", path.display()))?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(e) => e.into_bytes().iter().map(|&b| b as char).collect(),
    })
}

/// Script text as the system table holds it: CRLF line breaks and no `export` in front of
/// top-level declarations.
fn as_deployed_script(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + text.len() / 25);
    let mut first = true;
    for line in text.split('\n') {
        if !first {
            out.push_str("\r\n");
        }
        first = false;
        out.push_str(&drop_export(line.strip_suffix('\r').unwrap_or(line)));
    }
    out
}

/// The server runs a library as plain script, so `export` in front of a declaration is gone: at
/// the start of a line and also in a commented-out declaration (`//export function ...`), but
/// not where the word is part of a sentence in a comment.
fn drop_export(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let body = &line[indent..];
    let (lead, rest) = match body.strip_prefix("//") {
        Some(after) => {
            let spaces = after.len() - after.trim_start().len();
            (&line[..indent + 2 + spaces], &after[spaces..])
        }
        None => (&line[..indent], body),
    };
    for keyword in ["function", "async", "const", "let", "var", "class"] {
        if let Some(tail) = rest.strip_prefix("export ").filter(|t| t.starts_with(keyword)) {
            return format!("{lead}{tail}");
        }
    }
    line.to_string()
}

/// Properties that hold a linked file. When the file is empty the transpiled model carries an empty
/// element (`<expression></expression>`) and the system table leaves it out.
const LINKED_PROPERTIES: &[&str] = &["valueProcess", "process", "stateProcess", "documentation", "onActionProcess", "displayValueProcess", "expression", "onValidation", "titleProcess", "dropDownProcess", "mandatoryProcess", "conditionProcess", "contentProcess", "onValueChange", "filterConditionProcess", "contentTitleProcess", "tooltipProcess", "orderClauseProcess", "onDBDelete", "grantDeleteProcess", "onDBInsert", "fromClauseProcess", "onInsert", "colorProcess", "onDBUpdate", "linkedContextProcess", "onUpdate", "translationProcess", "filterValuesProcess", "imageProcess", "afterUiInit", "onDelete", "initFilterProcess", "grantUpdateProcess", "reference", "serviceTaskParameterProcess", "externalInitFilterProcess", "contentDescriptionProcess", "contentTypeProcess", "afterSave", "filterFieldsProcess", "iconIdProcess", "grantCreateProcess", "reportData", "query", "cacheKeyProcess", "affectedIds", "targetConsumerProcess", "selectionModeProcess", "rowCountProcess", "patternExtensionProcess", "filterVariablesProcess", "placeholderProcess", "imageData", "groupQueryProcess", "afterOperatingState", "titlePluralProcess", "templateProcess", "onInit", "preview", "icon", "iconInactive", "syncIds"];

/// Drops the lines of empty linked-file elements.
fn without_empty_links(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut first = true;
    for line in xml.split('\n') {
        let trimmed = line.trim();
        let empty_link = trimmed
            .strip_prefix('<')
            .and_then(|t| t.split_once("></"))
            .is_some_and(|(name, rest)| rest.strip_suffix('>').is_some_and(|close| close == name) && LINKED_PROPERTIES.contains(&name));
        if empty_link {
            continue;
        }
        if !first {
            out.push('\n');
        }
        first = false;
        out.push_str(line);
    }
    out
}

const BINARY_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "jrxml", "jasper"];

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

/// What a linked file turns into inside its element: images as Base64 on one line, everything
/// else as deployed script text.
fn linked_content(file: &Path) -> Result<String, String> {
    let binary = file.extension().and_then(|e| e.to_str()).is_some_and(|e| BINARY_EXTENSIONS.iter().any(|b| b.eq_ignore_ascii_case(e)));
    if binary {
        let bytes = std::fs::read(file).map_err(|e| format!("{} is not readable: {e}", file.display()))?;
        return Ok(base64(&bytes));
    }
    Ok(escape(&as_deployed_script(&read_text(file)?)))
}

/// Builds the `XMLDATA` of one model. `dist` is the folder the `%aditoprj%/` links point into.
pub fn encode_model(dist: &Path, main_file: &Path) -> Result<String, String> {
    let text = without_empty_links(&read_text(main_file)?);
    let mut out = String::with_capacity(text.len() * 2);
    let mut rest = text.as_str();
    while let Some(at) = rest.find(LINK_PREFIX) {
        let before = &rest[..at];
        let after = &rest[at + LINK_PREFIX.len()..];
        let linked_element = before.ends_with('>') && after.find('<').is_some();
        if !linked_element {
            out.push_str(&rest[..at + LINK_PREFIX.len()]);
            rest = after;
            continue;
        }
        let end = after.find('<').unwrap_or(after.len());
        let relative = after[..end].trim();
        let file = dist.join(relative);
        if !file.is_file() {
            out.push_str(&rest[..at + LINK_PREFIX.len()]);
            rest = after;
            continue;
        }
        out.push_str(before);
        out.push_str(&linked_content(&file)?);
        rest = &after[end..];
    }
    out.push_str(rest);
    Ok(out.replacen(DISTRIBUTED, COMPACT, 1))
}

/// The `<title>` of a model, shown as `TITLE` in the system table (None when it has none).
pub fn title_of(xml: &str) -> Option<String> {
    let marker = "\n  <title>";
    let start = xml.find(marker)? + marker.len();
    let end = xml[start..].find("</title>")? + start;
    let title = &xml[start..end];
    if title.is_empty() || title.contains('<') {
        None
    } else {
        Some(title.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("deploy-encode-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_linked_script_is_written_into_its_element_and_escaped() {
        let dist = scratch("link");
        std::fs::create_dir_all(dist.join("process/P")).unwrap();
        std::fs::write(dist.join("process/P/process.js"), "if (a < b && c > d) {\r\n}\r\n").unwrap();
        let aod = "<process>\r\n  <majorModelMode>DISTRIBUTED</majorModelMode>\r\n  <process>%aditoprj%/process/P/process.js</process>\r\n</process>";
        std::fs::write(dist.join("process/P/P.aod"), aod).unwrap();
        let xml = encode_model(&dist, &dist.join("process/P/P.aod")).unwrap();
        assert!(xml.contains("<majorModelMode>COMPACT</majorModelMode>"));
        assert!(xml.contains("<process>if (a &lt; b &amp;&amp; c &gt; d) {\r\n}\r\n</process>"));
    }

    #[test]
    fn scripts_get_crlf_and_lose_the_export_keyword() {
        assert_eq!(as_deployed_script("export function a() {\n}\nconst x = 1;\n"), "function a() {\r\n}\r\nconst x = 1;\r\n");
        assert_eq!(as_deployed_script("a\r\nb"), "a\r\nb");
        assert_eq!(as_deployed_script("//export function a() {}"), "//function a() {}");
        assert_eq!(as_deployed_script(" * needed for export functions (e.g. reports)"), " * needed for export functions (e.g. reports)");
        assert_eq!(as_deployed_script("  export function a() {}"), "  function a() {}");
        assert_eq!(as_deployed_script("exports.value = 1;"), "exports.value = 1;");
    }

    #[test]
    fn empty_linked_elements_are_left_out_but_other_empty_elements_stay() {
        let xml = "<a>
  <expression></expression>
  <description></description>
  <errorProcess></errorProcess>
</a>";
        let kept = "<a>
  <description></description>
  <errorProcess></errorProcess>
</a>";
        assert_eq!(without_empty_links(xml), kept);
    }

    #[test]
    fn images_are_written_as_base64() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
    }

    #[test]
    fn a_link_to_a_missing_file_stays_as_it_is() {
        let dist = scratch("missing");
        std::fs::create_dir_all(dist.join("process/P")).unwrap();
        let aod = "<process><process>%aditoprj%/process/P/gone.js</process></process>";
        std::fs::write(dist.join("process/P/P.aod"), aod).unwrap();
        let xml = encode_model(&dist, &dist.join("process/P/P.aod")).unwrap();
        assert_eq!(xml, aod);
    }

    #[test]
    fn model_types_and_numbers_map_both_ways() {
        assert_eq!(kind_of("entity"), Some(189));
        assert_eq!(folder_of(10078), Some("neonView"));
        assert_eq!(kind_of("unknownType"), None);
        assert_eq!(kind_of("userhelp"), None);
    }

    #[test]
    fn the_title_is_the_plain_title_element() {
        assert_eq!(title_of("<entity>\r\n  <title>Activity_Activity</title>\r\n</entity>").as_deref(), Some("Activity_Activity"));
        assert_eq!(title_of("<entity>\r\n  <fields>\r\n    <title>nested</title>\r\n  </fields>\r\n</entity>"), None);
        assert_eq!(title_of("<entity><name>x</name></entity>"), None);
    }
}
