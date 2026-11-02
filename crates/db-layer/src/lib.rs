//! `db-layer` — database access for the Forge designer's alias management
//! and data-model introspection, behind one `DbConnection` trait shared by
//! MariaDB/MySQL, PostgreSQL and MS SQL.
//!
//! This crate is pure infrastructure with no dependency on the other P3
//! crates (`core-model`, `aod-io`, ...): it only knows how to talk to a
//! database server, not how the designer's project model is structured.

pub mod connection;
pub mod error;
pub mod mariadb;
pub mod mock;
pub mod mssql;
pub mod postgres;
pub mod types;

pub use connection::{DbConnection, TxStatement};
pub use error::DbError;
pub use types::{ConnectionConfig, DbValue, QueryResult, TableInfo};
