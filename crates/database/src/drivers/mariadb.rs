//! MariaDB/MySQL driver, built on `sqlx` (mysql feature, rustls TLS so no
//! system TLS library dependency — keeps the macOS-arm64 cross-compile
//! story simple alongside the MS SQL driver, see `mssql.rs`).

use async_trait::async_trait;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::{Column, MySql, Pool, Row};

use crate::drivers::connection::{DbConnection, TxStatement};
use crate::drivers::error::DbError;
use crate::drivers::types::{ConnectionConfig, DbValue, QueryResult, TableInfo};

pub struct MariaDbConnection {
    pool: Pool<MySql>,
}

/// Opens a connection pool against a MariaDB/MySQL server. Returns
/// `DbError::ConnectionFailed` (never panics) if the server is
/// unreachable, refuses the credentials, or the connection attempt exceeds
/// `config.connect_timeout`.
pub async fn connect(config: &ConnectionConfig) -> Result<MariaDbConnection, DbError> {
    let url = format!(
        "mysql://{}:{}@{}:{}/{}",
        config.username, config.password, config.host, config.port, config.database
    );

    let pool = MySqlPoolOptions::new()
        .acquire_timeout(config.connect_timeout)
        .max_connections(5)
        .connect(&url)
        .await?;

    Ok(MariaDbConnection { pool })
}

/// Decodes one column of a `sqlx::mysql::MySqlRow` into `DbValue` without
/// knowing its SQL type ahead of time. Tries progressively looser Rust
/// types; a failed decode attempt returns `Err`, never panics, so falling
/// through to the next attempt (and finally `DbValue::Null`) is safe.
fn decode_column(row: &sqlx::mysql::MySqlRow, idx: usize) -> DbValue {
    if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) {
        return DbValue::Int(v);
    }
    if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(idx) {
        return DbValue::Float(v);
    }
    if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
        return DbValue::Bool(v);
    }
    if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
        return DbValue::Text(v);
    }
    if let Ok(Some(v)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return DbValue::Bytes(v);
    }
    DbValue::Null
}

#[async_trait]
impl DbConnection for MariaDbConnection {
    async fn test_connection(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, DbError> {
        if !crate::db_session::is_read_only(sql) {
            let done = sqlx::query(sql).execute(&self.pool).await?;
            return Ok(QueryResult { columns: Vec::new(), rows: Vec::new(), rows_affected: Some(done.rows_affected()) });
        }
        let rows = sqlx::query(sql).fetch_all(&self.pool).await?;

        let columns = rows
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();

        let values = rows
            .iter()
            .map(|row| {
                (0..row.columns().len())
                    .map(|idx| decode_column(row, idx))
                    .collect()
            })
            .collect();

        Ok(QueryResult { columns, rows: values, rows_affected: None })
    }

    async fn execute_transaction(&self, statements: &[TxStatement]) -> Result<Vec<u64>, DbError> {
        let mut tx = self.pool.begin().await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql);
            for p in &statement.params {
                query = match p {
                    DbValue::Null => query.bind(None::<String>),
                    DbValue::Bool(b) => query.bind(*b),
                    DbValue::Int(i) => query.bind(*i),
                    DbValue::Float(f) => query.bind(*f),
                    DbValue::Text(t) => query.bind(t.clone()),
                    DbValue::Bytes(b) => query.bind(b.clone()),
                };
            }
            match query.execute(&mut *tx).await {
                Ok(done) => affected.push(done.rows_affected()),
                Err(e) => {
                    let _ = tx.rollback().await;
                    return Err(e.into());
                }
            }
        }
        tx.commit().await?;
        Ok(affected)
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, DbError> {
        let rows = sqlx::query(
            "SELECT table_schema, table_name FROM information_schema.tables \
             WHERE table_schema = DATABASE()",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| TableInfo {
                schema: row.try_get::<String, _>(0).unwrap_or_default(),
                name: row.try_get::<String, _>(1).unwrap_or_default(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Connecting to a port nothing listens on must fail cleanly with
    /// `DbError::ConnectionFailed`, not panic and not hang. Port 1 is
    /// privileged/unused on every platform this runs on. Wrapped in a
    /// timeout so a misbehaving network stack can't hang the test suite.
    #[tokio::test]
    async fn connect_to_closed_port_returns_typed_error() {
        let config = ConnectionConfig {
            connect_timeout: Duration::from_secs(3),
            ..ConnectionConfig::new("127.0.0.1", 1, "test", "root", "root")
        };

        let result = tokio::time::timeout(Duration::from_secs(10), connect(&config)).await;

        match result {
            Ok(Err(DbError::ConnectionFailed(_))) => {}
            Ok(Err(other)) => panic!("expected ConnectionFailed, got {other:?}"),
            Ok(Ok(_)) => panic!("unexpectedly connected to a port nothing listens on"),
            Err(_) => panic!("connect() did not return within the outer test timeout"),
        }
    }
}
