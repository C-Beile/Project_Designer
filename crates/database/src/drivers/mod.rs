//! `database` — Datenbankzugriff für die Alias-Verwaltung und die Datenmodell-Abfragen des
//! Designers, hinter einem Trait `DbConnection` für MariaDB/MySQL, PostgreSQL und MS SQL.
//!
//! Die Treiber hängen von keiner Fachcrate ab (`aod`, `project`). Sie sprechen nur mit einem
//! Datenbankserver und kennen das Projektmodell nicht.
//!
//! Hinweis: `DbManager` (`db_session.rs`) verbindet heute nur über `mariadb::connect`. Die
//! Postgres- und MSSQL-Treiber sind (noch) nicht angeschlossen. Transaktionen setzen nur
//! `mariadb` und `mock` um. Die anderen Treiber melden `DbError::Unsupported`.

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
