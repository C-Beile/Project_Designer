//! MS SQL driver, built on `tiberius` — the risk point of this crate (see
//! RISKS.md R6). `tiberius` implements the TDS wire protocol itself in
//! pure Rust; with the `rustls` feature (used here instead of the default
//! `native-tls`) it has no dependency on a platform TLS library or a
//! proprietary Microsoft ODBC driver, which is what makes it viable on
//! `aarch64-apple-darwin`. See `p3-db-layer-notes.md` for the full
//! research writeup behind that conclusion.
//!
//! `tiberius::Client` requires `&mut self` for queries, so the connection
//! is wrapped in a `tokio::sync::Mutex` to fit the shared-reference
//! `DbConnection` trait (the designer only needs one in-flight query per
//! alias connection at a time, so serializing here is not a bottleneck).

use async_trait::async_trait;
use tiberius::{AuthMethod, Client, Config};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::drivers::connection::DbConnection;
use crate::drivers::error::DbError;
use crate::drivers::types::{ConnectionConfig, DbValue, QueryResult, TableInfo};

pub struct MssqlConnection {
    client: Mutex<Client<Compat<TcpStream>>>,
}

/// Opens a connection against an MS SQL server. Returns
/// `DbError::ConnectionFailed` (never panics) if the server is
/// unreachable or authentication fails, and `DbError::Timeout` if the
/// attempt exceeds `config.connect_timeout` without the OS ever
/// confirming or refusing the TCP connection.
pub async fn connect(config: &ConnectionConfig) -> Result<MssqlConnection, DbError> {
    let mut tiberius_config = Config::new();
    tiberius_config.host(&config.host);
    tiberius_config.port(config.port);
    tiberius_config.database(&config.database);
    tiberius_config.authentication(AuthMethod::sql_server(&config.username, &config.password));
    // Designer alias configs typically point at servers with self-signed
    // or internal-CA certs; certificate pinning is a later concern, not
    // part of this minimal driver wrapper.
    tiberius_config.trust_cert();

    let attempt = async {
        let tcp = TcpStream::connect((config.host.as_str(), config.port)).await?;
        tcp.set_nodelay(true)?;
        let client = Client::connect(tiberius_config, tcp.compat_write()).await?;
        Ok::<_, DbError>(client)
    };

    let client = tokio::time::timeout(config.connect_timeout, attempt)
        .await
        .map_err(|_| DbError::Timeout(config.connect_timeout))??;

    Ok(MssqlConnection {
        client: Mutex::new(client),
    })
}

/// See `mariadb::decode_column` for the rationale. Tiberius decodes are
/// stricter about the exact Rust type matching the TDS column type than
/// sqlx, so integer width is tried narrow-to-wide before falling back.
fn decode_column(row: &tiberius::Row, idx: usize) -> DbValue {
    if let Ok(Some(v)) = row.try_get::<i32, _>(idx) {
        return DbValue::Int(v as i64);
    }
    if let Ok(Some(v)) = row.try_get::<i64, _>(idx) {
        return DbValue::Int(v);
    }
    if let Ok(Some(v)) = row.try_get::<f64, _>(idx) {
        return DbValue::Float(v);
    }
    if let Ok(Some(v)) = row.try_get::<f32, _>(idx) {
        return DbValue::Float(v as f64);
    }
    if let Ok(Some(v)) = row.try_get::<bool, _>(idx) {
        return DbValue::Bool(v);
    }
    if let Ok(Some(v)) = row.try_get::<&str, _>(idx) {
        return DbValue::Text(v.to_string());
    }
    if let Ok(Some(v)) = row.try_get::<&[u8], _>(idx) {
        return DbValue::Bytes(v.to_vec());
    }
    DbValue::Null
}

#[async_trait]
impl DbConnection for MssqlConnection {
    async fn test_connection(&self) -> Result<(), DbError> {
        let mut client = self.client.lock().await;
        client.simple_query("SELECT 1").await?.into_results().await?;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, DbError> {
        let mut client = self.client.lock().await;
        let results = client.simple_query(sql).await?.into_results().await?;
        let first_result = results.into_iter().next().unwrap_or_default();

        let columns = first_result
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();

        let values = first_result
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
        let mut client = self.client.lock().await;
        let results = client
            .simple_query(
                "SELECT table_schema, table_name FROM information_schema.tables",
            )
            .await?
            .into_results()
            .await?;
        let rows = results.into_iter().next().unwrap_or_default();

        Ok(rows
            .iter()
            .map(|row| TableInfo {
                schema: row.try_get::<&str, _>(0).ok().flatten().unwrap_or_default().to_string(),
                name: row.try_get::<&str, _>(1).ok().flatten().unwrap_or_default().to_string(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Same contract as the other two drivers: an unreachable server must
    /// fail cleanly and quickly, never panic or hang. Also exercises the
    /// `DbError::Timeout` path indirectly (the outer test timeout is the
    /// safety net; the connect timeout is expected to fire first).
    #[tokio::test]
    async fn connect_to_closed_port_returns_typed_error() {
        let config = ConnectionConfig {
            connect_timeout: Duration::from_secs(3),
            ..ConnectionConfig::new("127.0.0.1", 1, "test", "sa", "not-a-real-password")
        };

        let result = tokio::time::timeout(Duration::from_secs(10), connect(&config)).await;

        match result {
            Ok(Err(DbError::ConnectionFailed(_))) | Ok(Err(DbError::Timeout(_))) => {}
            Ok(Err(other)) => panic!("expected ConnectionFailed/Timeout, got {other:?}"),
            Ok(Ok(_)) => panic!("unexpectedly connected to a port nothing listens on"),
            Err(_) => panic!("connect() did not return within the outer test timeout"),
        }
    }
}
