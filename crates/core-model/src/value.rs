//! Typed values held by a `PropertyTree` node.
//!
//! Mirrors the flattening convention already fixed by the JSON schemas under
//! `PROJECT\30_spec\schema\*.schema.json` (README.md there: each XML element becomes an object
//! property, repeatable elements become arrays, ADITO's typed-scalar encoding `<foo v="..."/>`
//! becomes `{"v": ...}`) so a schema-driven projector can be dropped in later without changing
//! this shape (see `p3-core-model-notes.md` for why the projector itself is out of this round's
//! scope).

#[derive(Debug, Clone, PartialEq)]
pub enum ScalarValue {
    /// Plain element text content, e.g. `<title>Tour</title>`, or a bare-name reference.
    Text(String),
    /// ADITO's typed-scalar boolean encoding `<foo v="true"/>`.
    Bool(bool),
    /// ADITO's typed-scalar integer encoding `<foo v="12"/>` (column types, grid positions, ...).
    Int(i64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PropertyValue {
    Scalar(ScalarValue),
    /// An ordered field map. Order is preserved (not sorted) because aod-format.md §1.2 found
    /// that real files follow declaration/insertion order, not alphabetical order - re-emitting
    /// a newly inserted structural node must respect the same convention.
    Object(Vec<(String, PropertyValue)>),
    /// A repeatable element (`entityField`, `dbRecordContainer`, ...), in document order.
    Array(Vec<PropertyValue>),
}

impl PropertyValue {
    pub fn as_scalar(&self) -> Option<&ScalarValue> {
        match self {
            PropertyValue::Scalar(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self.as_scalar() {
            Some(ScalarValue::Text(t)) => Some(t.as_str()),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(String, PropertyValue)]> {
        match self {
            PropertyValue::Object(fields) => Some(fields),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[PropertyValue]> {
        match self {
            PropertyValue::Array(items) => Some(items),
            _ => None,
        }
    }

    /// Business meaning: follow one named field of an object-shaped value, e.g. reading
    /// `recordContainer.dbRecordContainer` off an entity's `recordContainers` value.
    pub fn field(&self, name: &str) -> Option<&PropertyValue> {
        self.as_object()?.iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }
}
