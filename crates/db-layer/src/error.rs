//! Error type shared by all three database drivers.
//!
//! The designer needs to distinguish "could not reach the server" (wrong
//! host/port, server down) from "server reached but the query failed" (bad
//! SQL, permission denied) so the UI can show a useful message instead of a
//! generic failure. Both driver-specific error types (`sqlx::Error`,
//! `tiberius::error::Error`) are mapped into this one enum so the rest of
//! the designer never has to know which driver produced an error.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    /// The connection could not be established (host unreachable, wrong
    /// port, authentication rejected, TLS negotiation failed, ...).
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    /// The connection was established but a query could not be executed.
    #[error("query failed: {0}")]
    QueryFailed(String),

    /// The operation is not supported by this driver (e.g. an alias
    /// feature that only exists for one database engine).
    #[error("unsupported operation: {0}")]
    Unsupported(String),

    /// The connection timed out before the driver could tell us whether it
    /// succeeded or failed (used to bound worst-case wait time when a
    /// server is unreachable and never resets the TCP connection).
    #[error("connection timed out after {0:?}")]
    Timeout(std::time::Duration),
}

impl From<sqlx::Error> for DbError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::Io(_) | sqlx::Error::Tls(_) | sqlx::Error::PoolTimedOut => {
                DbError::ConnectionFailed(err.to_string())
            }
            other => DbError::QueryFailed(other.to_string()),
        }
    }
}

impl From<tiberius::error::Error> for DbError {
    fn from(err: tiberius::error::Error) -> Self {
        match &err {
            tiberius::error::Error::Io { .. } | tiberius::error::Error::Tls(_) => {
                DbError::ConnectionFailed(err.to_string())
            }
            _ => DbError::QueryFailed(err.to_string()),
        }
    }
}

impl From<std::io::Error> for DbError {
    fn from(err: std::io::Error) -> Self {
        DbError::ConnectionFailed(err.to_string())
    }
}
