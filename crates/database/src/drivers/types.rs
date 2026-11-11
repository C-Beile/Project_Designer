//! Shared value types used by the `DbConnection` trait, independent of the
//! concrete driver.
//!
//! Kept deliberately minimal (designer needs, not a full ORM): connection
//! parameters, a generic tabular query result, and enough schema/table
//! metadata to populate an alias editor's "pick a table" list.

use std::time::Duration;

/// Connection parameters common to all three engines. Alias-specific
/// options (e.g. MS SQL "trust server certificate") live in `extra`
/// rather than growing this struct per engine.
#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    /// Upper bound for connection attempts, so a wrong host/port never
    /// hangs the caller indefinitely (relevant for the designer's "test
    /// connection" button in the alias editor).
    pub connect_timeout: Duration,
}

impl ConnectionConfig {
    pub fn new(
        host: impl Into<String>,
        port: u16,
        database: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            database: database.into(),
            username: username.into(),
            password: password.into(),
            connect_timeout: Duration::from_secs(5),
        }
    }
}

/// A single value in a query result row. Deliberately coarse-grained
/// (no per-engine numeric width distinctions) since the designer's use
/// cases (alias test query, schema browser preview) only need to display
/// values, not round-trip them losslessly.
#[derive(Debug, Clone, PartialEq)]
pub enum DbValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(Vec<u8>),
}

/// Result of an arbitrary query: column names in order, plus rows of
/// values in the same column order.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<DbValue>>,
    /// Rows changed by a writing statement (UPDATE, INSERT, DELETE); `None` for a statement that reads.
    pub rows_affected: Option<u64>,
}

/// One table/view discovered via schema introspection, for the alias
/// editor's table picker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
}
