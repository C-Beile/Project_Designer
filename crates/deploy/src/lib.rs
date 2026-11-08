//! Deploy nach ASYS_SYSTEM: Kodierung der Zeilen und Abgleich/Schreiben über `database`.

pub mod deploy_encode;
pub mod plugin;
pub use plugin::DeployPlugin;
pub mod system_deploy;
