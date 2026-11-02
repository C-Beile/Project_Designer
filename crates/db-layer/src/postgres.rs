//! PostgreSQL driver, built on `sqlx` (postgres feature, rustls TLS —
//! same rationale as `mariadb.rs`).

use async_trait::async_trait;
use sqlx::postgres::PgPoolOptions;
use sqlx::{Column, Pool, Postgres, Row};

use crate::connection::DbConnection;
use crate::error::DbError;
use crate::types::{ConnectionConfig, DbValue, QueryResult, TableInfo};

pub struct PostgresConnection {
    pool: Pool<Postgres>,
}

/// Opens a connection pool against a PostgreSQL server. Returns
/// `DbError::ConnectionFailed` (never panics) if the server is
/// unreachable, refuses the credentials, or the connection attempt exceeds
/// `config.connect_timeout`.
pub async fn connect(config: &ConnectionConfig) -> Result<PostgresConnection, DbError> {
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        config.username, config.password, config.host, config.port, config.database
    );

    let pool = PgPoolOptions::new()
        .acquire_timeout(config.connect_timeout)
        .max_connections(5)
        .connect(&url)
        .await?;

    Ok(PostgresConnection { pool })
}

/// See `mariadb::decode_column` for the rationale (progressive decode
/// attempts, never panics on a type mismatch).
fn decode_column(row: &sqlx::postgres::PgRow, idx: usize) -> DbValue {
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
impl DbConnection for PostgresConnection {
    async fn test_connection(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1").execute(&self.pool).await?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, DbError> {
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

        Ok(QueryResult { columns, rows: values })
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, DbError> {
        let rows = sqlx::query(
            "SELECT table_schema, table_name FROM information_schema.tables \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
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

    /// Same contract as the MariaDB driver: an unreachable server must
    /// fail cleanly and quickly, never panic or hang.
    #[tokio::test]
    async fn connect_to_closed_port_returns_typed_error() {
        let config = ConnectionConfig {
            connect_timeout: Duration::from_secs(3),
            ..ConnectionConfig::new("127.0.0.1", 1, "test", "postgres", "postgres")
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
