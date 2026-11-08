//! Datenbank: Treiber (MariaDB/Postgres/MSSQL), Sitzungen, Tunnel-Anbindung, System-Konfiguration
//! und Lesen der Systemdatenbank (Benutzer, Aliase).

pub mod db_session;
pub mod drivers;
pub mod plugin;
pub mod system_config;
pub mod system_db;

pub use plugin::DatabasePlugin;
