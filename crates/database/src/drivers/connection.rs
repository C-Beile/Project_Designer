//! The `DbConnection` trait: the one abstraction every driver (MariaDB,
//! PostgreSQL, MS SQL, and the test `MockConnection`) implements, and the
//! only thing the rest of the designer depends on for alias management and
//! data-model introspection.
//!
//! Scope is intentionally narrow — connect/test, run a query, list schema
//! and tables. No transactions, no prepared-statement cache, no ORM
//! mapping: the designer needs to manage aliases and preview data, not run
//! application business logic against these connections.

use async_trait::async_trait;

use crate::error::DbError;
use crate::types::{DbValue, QueryResult, TableInfo};

/// One parameterised write inside a transaction; values are bound, never spliced into the SQL.
#[derive(Debug, Clone, PartialEq)]
pub struct TxStatement {
    pub sql: String,
    pub params: Vec<DbValue>,
}

#[async_trait]
pub trait DbConnection: Send + Sync {
    /// Round-trips a trivial statement against the server to confirm the
    /// connection is actually usable (used by the alias editor's "test
    /// connection" button, separately from the initial `connect()` call).
    async fn test_connection(&self) -> Result<(), DbError>;

    /// Executes an arbitrary query and returns its result set. Used for
    /// ad-hoc queries in the data-model introspection view.
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, DbError>;

    /// Lists tables and views visible to the connected user, across all
    /// schemas the server exposes. Backs the alias editor's table picker.
    async fn list_tables(&self) -> Result<Vec<TableInfo>, DbError>;

    /// Runs all statements in ONE transaction on one connection: either every statement is
    /// committed or, on the first failure, none is (rollback). Returns the affected row counts.
    /// Drivers that cannot do this refuse instead of running statements without a transaction.
    async fn execute_transaction(&self, _statements: &[TxStatement]) -> Result<Vec<u64>, DbError> {
        Err(DbError::Unsupported("transactions are not supported by this driver".to_string()))
    }
}
