//! In-memory `DbConnection` implementation used by tests (both in this
//! crate and later in the alias-management code that consumes
//! `DbConnection` as a trait object) so behaviour can be verified without a
//! real database server.

use async_trait::async_trait;

use crate::connection::{DbConnection, TxStatement};
use std::sync::Mutex;
use crate::error::DbError;
use crate::types::{DbValue, QueryResult, TableInfo};

/// A canned connection: always reports success, returns a fixed table list
/// and echoes the query text back as a single-column result so callers can
/// assert on what was sent.
pub struct MockConnection {
    pub tables: Vec<TableInfo>,
    /// Statements that were committed by `execute_transaction`.
    pub committed: Mutex<Vec<TxStatement>>,
    /// When set, the statement with this index fails and the whole transaction is rolled back.
    pub fail_at: Option<usize>,
}

impl MockConnection {
    pub fn new(tables: Vec<TableInfo>) -> Self {
        Self { tables, committed: Mutex::new(Vec::new()), fail_at: None }
    }
}

impl Default for MockConnection {
    fn default() -> Self {
        Self::new(vec![TableInfo {
            schema: "dbo".to_string(),
            name: "customer".to_string(),
        }])
    }
}

#[async_trait]
impl DbConnection for MockConnection {
    async fn test_connection(&self) -> Result<(), DbError> {
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, DbError> {
        Ok(QueryResult {
            columns: vec!["echo".to_string()],
            rows: vec![vec![DbValue::Text(sql.to_string())]],
        })
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, DbError> {
        Ok(self.tables.clone())
    }

    async fn execute_transaction(&self, statements: &[TxStatement]) -> Result<Vec<u64>, DbError> {
        if let Some(i) = self.fail_at.filter(|i| *i < statements.len()) {
            return Err(DbError::QueryFailed(format!("mock: statement {i} failed")));
        }
        self.committed.lock().unwrap().extend(statements.iter().cloned());
        Ok(vec![1; statements.len()])
    }
}

/// A connection that always fails, for exercising error paths in callers
/// without needing a driver-specific failure scenario.
pub struct AlwaysFailingConnection;

#[async_trait]
impl DbConnection for AlwaysFailingConnection {
    async fn test_connection(&self) -> Result<(), DbError> {
        Err(DbError::ConnectionFailed("mock: connection refused".to_string()))
    }

    async fn execute_query(&self, _sql: &str) -> Result<QueryResult, DbError> {
        Err(DbError::QueryFailed("mock: no connection".to_string()))
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, DbError> {
        Err(DbError::ConnectionFailed("mock: no connection".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_connection_reports_success_and_fixed_tables() {
        let conn = MockConnection::default();
        assert!(conn.test_connection().await.is_ok());

        let tables = conn.list_tables().await.unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "customer");
    }

    #[tokio::test]
    async fn mock_connection_echoes_query_text() {
        let conn = MockConnection::default();
        let result = conn.execute_query("SELECT 1").await.unwrap();
        assert_eq!(result.columns, vec!["echo".to_string()]);
        assert_eq!(result.rows[0][0], DbValue::Text("SELECT 1".to_string()));
    }

    #[tokio::test]
    async fn always_failing_connection_returns_typed_error_not_panic() {
        let conn = AlwaysFailingConnection;
        assert!(matches!(
            conn.test_connection().await,
            Err(DbError::ConnectionFailed(_))
        ));
        assert!(matches!(
            conn.execute_query("SELECT 1").await,
            Err(DbError::QueryFailed(_))
        ));
        assert!(matches!(
            conn.list_tables().await,
            Err(DbError::ConnectionFailed(_))
        ));
    }

    /// `DbConnection` must be usable as a trait object (`Box<dyn
    /// DbConnection>`) since the designer selects the concrete driver at
    /// runtime based on the alias's configured database engine.
    #[tokio::test]
    async fn db_connection_is_object_safe() {
        let conn: Box<dyn DbConnection> = Box::new(MockConnection::default());
        assert!(conn.test_connection().await.is_ok());
    }
}
