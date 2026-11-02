//! Wire format between the Rust core and the TypeScript frontend.
//!
//! `core_model::value::PropertyValue`/`ScalarValue` and `core_model::path::NodePath` are not
//! `serde`-serializable (deliberately - `core-model` has no frontend/IPC concern, see
//! architecture.md ADR-0002 "Kern ohne UI"). This module is the one, single translation layer
//! between those real types and JSON, living in the app crate rather than in `core-model` -
//! keeping the generic Tauri command surface (architecture.md §6) the only place that needs to
//! know about IPC shapes at all.

use core_model::path::{NodePath, PathSegment};
use core_model::value::{PropertyValue as CoreValue, ScalarValue as CoreScalar};
use serde::{Deserialize, Serialize};

/// JSON projection of `core_model::value::PropertyValue`. Field order is carried explicitly as a
/// `Vec` (not a JSON object) for `Object`, because ADITO's own format is order-sensitive
/// (aod-format.md §1.2, `value.rs`'s own doc comment) and a plain JSON object's key order is not
/// a format guarantee worth relying on across the IPC boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// The frontend (ui/src/wire/types.ts) reads the lowercase tags: "text", "object", ... (rc2 fix: without
// the rename every editor received "Object"/"Text" and rendered an empty tree).
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WireValue {
    Text { value: String },
    Bool { value: bool },
    Int { value: i64 },
    Object { fields: Vec<WireField> },
    Array { items: Vec<WireValue> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireField {
    pub key: String,
    pub value: WireValue,
}

impl WireValue {
    pub fn from_core(value: &CoreValue) -> WireValue {
        match value {
            CoreValue::Scalar(CoreScalar::Text(t)) => WireValue::Text { value: t.clone() },
            CoreValue::Scalar(CoreScalar::Bool(b)) => WireValue::Bool { value: *b },
            CoreValue::Scalar(CoreScalar::Int(i)) => WireValue::Int { value: *i },
            CoreValue::Object(fields) => WireValue::Object {
                fields: fields
                    .iter()
                    .map(|(k, v)| WireField { key: k.clone(), value: WireValue::from_core(v) })
                    .collect(),
            },
            CoreValue::Array(items) => {
                WireValue::Array { items: items.iter().map(WireValue::from_core).collect() }
            }
        }
    }

    /// Only scalar edits are wired end-to-end right now (see `p4-editor-entity-notes.md` - the
    /// `forge-core` write-back path only supports the `Text`-content scalar case today, and the
    /// UI is expected to gate non-Text fields read-only accordingly). Returns `None` for
    /// `Object`/`Array`, which are never a valid `set_property` payload.
    pub fn as_core_scalar(&self) -> Option<CoreScalar> {
        match self {
            WireValue::Text { value } => Some(CoreScalar::Text(value.clone())),
            WireValue::Bool { value } => Some(CoreScalar::Bool(*value)),
            WireValue::Int { value } => Some(CoreScalar::Int(*value)),
            _ => None,
        }
    }
}

/// Parses the dotted/indexed path notation `NodePath`'s own `Display` impl produces
/// (`"entityFields.entityField[2].valueProcess"`, root is `"$"` or `""`) back into a real
/// `NodePath`. This is the exact inverse of `path.rs`'s `Display` impl, kept in the app crate
/// (not `core-model`) since it is purely an IPC-string-format concern.
pub fn parse_node_path(raw: &str) -> Result<NodePath, String> {
    if raw.is_empty() || raw == "$" {
        return Ok(NodePath::root());
    }

    let chars: Vec<char> = raw.chars().collect();
    let mut i = 0usize;
    let mut path = NodePath::root();

    while i < chars.len() {
        if chars[i] == '.' {
            i += 1;
            continue;
        }
        if chars[i] == '[' {
            let start = i + 1;
            let mut j = start;
            while j < chars.len() && chars[j] != ']' {
                j += 1;
            }
            if j >= chars.len() {
                return Err(format!("unterminated '[' in node path '{raw}'"));
            }
            let digits: String = chars[start..j].iter().collect();
            let idx: usize = digits
                .parse()
                .map_err(|_| format!("non-numeric index '[{digits}]' in node path '{raw}'"))?;
            path = path.index(idx);
            i = j + 1;
            continue;
        }
        let start = i;
        let mut j = i;
        while j < chars.len() && chars[j] != '.' && chars[j] != '[' {
            j += 1;
        }
        let field: String = chars[start..j].iter().collect();
        if field.is_empty() {
            return Err(format!("empty field segment in node path '{raw}'"));
        }
        path = path.field(field);
        i = j;
    }

    Ok(path)
}

/// The inverse direction (`NodePath` -> wire string), reusing `NodePath`'s own `Display` -
/// kept here too so callers only ever import one module for both directions.
pub fn format_node_path(path: &NodePath) -> String {
    path.to_string()
}

/// Business meaning: is this path segment chain addressing a repeatable child (used by the UI to
/// know whether a node label needs an index suffix). Not currently consumed by any command, kept
/// as a small helper for the frontend-facing tree builder in `tree.rs`.
pub fn last_is_index(path: &NodePath) -> bool {
    matches!(path.last(), Some(PathSegment::Index(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_round_trips_through_display() {
        let original = NodePath::root().field("entityFields").field("entityField").index(2).field("valueProcess");
        let s = format_node_path(&original);
        assert_eq!(s, "entityFields.entityField[2].valueProcess");
        let reparsed = parse_node_path(&s).unwrap();
        assert_eq!(reparsed, original);
    }

    #[test]
    fn root_parses_from_dollar_and_empty_string() {
        assert_eq!(parse_node_path("$").unwrap(), NodePath::root());
        assert_eq!(parse_node_path("").unwrap(), NodePath::root());
    }

    #[test]
    fn wire_value_scalar_round_trips() {
        let core = CoreValue::Scalar(CoreScalar::Text("Tour".into()));
        let wire = WireValue::from_core(&core);
        assert_eq!(wire.as_core_scalar(), Some(CoreScalar::Text("Tour".into())));
    }

    #[test]
    fn wire_value_object_preserves_field_order() {
        let core = CoreValue::Object(vec![
            ("b".into(), CoreValue::Scalar(CoreScalar::Int(2))),
            ("a".into(), CoreValue::Scalar(CoreScalar::Int(1))),
        ]);
        let wire = WireValue::from_core(&core);
        match wire {
            WireValue::Object { fields } => {
                assert_eq!(fields[0].key, "b");
                assert_eq!(fields[1].key, "a");
            }
            _ => panic!("expected object"),
        }
    }

    #[test]
    fn json_tags_are_the_lowercase_kinds_the_frontend_reads() {
        let wire = WireValue::Object { fields: vec![WireField { key: "name".into(), value: WireValue::Text { value: "A".into() } }] };
        let json = serde_json::to_string(&wire).unwrap();
        assert_eq!(json, r#"{"kind":"object","fields":[{"key":"name","value":{"kind":"text","value":"A"}}]}"#);
        let back: WireValue = serde_json::from_str(r#"{"kind":"array","items":[{"kind":"int","value":3},{"kind":"bool","value":true}]}"#).unwrap();
        assert_eq!(back, WireValue::Array { items: vec![WireValue::Int { value: 3 }, WireValue::Bool { value: true }] });
    }
}
