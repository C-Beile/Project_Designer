//! Datenbank als Feature-Plugin: Sitzungen, SQL, Schema, Benutzer und Aliase des Systems.
//! Befehlsnamen wie die früheren Tauri-Befehle, Argumente als JSON mit camelCase-Feldern.
//!
//! Der `DbManager` gehört der App und wird als `Arc` auch an Deploy und Liquibase gegeben.
//! Den Fortschritt des Verbindens meldet das Plugin als Event `forge://tunnel-progress`.

use crate::db_session::{DbManager, DbStatus};
use crate::{system_config, system_db};
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{Args, EventSink, FeaturePlugin};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

pub struct DatabasePlugin {
    db: Arc<DbManager>,
}

impl DatabasePlugin {
    /// Setzt die Fortschrittsmeldung des `DbManager` auf `events`.
    pub fn new(db: Arc<DbManager>, events: Arc<dyn EventSink>) -> Self {
        db.set_progress_sink(Arc::new(move |system, phase, finished| {
            if finished && phase.starts_with("Failed") {
                let _ = app_base::crashlog::write_entry("TUNNEL", &format!("{system}: {phase}"));
            }
            events.emit("forge://tunnel-progress", serde_json::json!({ "system": system, "phase": phase, "finished": finished }));
        }));
        Self { db }
    }

    /// Schreibende Befehle am System laufen nur nach Bestätigung in der Oberfläche.
    fn confirmed(a: &Args<'_>, refusal: &str) -> Result<(), String> {
        if a.get::<bool>("confirmed")? {
            Ok(())
        } else {
            Err(refusal.to_string())
        }
    }

    /// Öffnet Tunnel und Systemdatenbank. Schlüsseldatei und Passwort bleiben nur im Speicher.
    fn connect(&self, a: &Args<'_>) -> Result<Value, String> {
        let (key, password) = ssh_tunnel::tunnel_core::clean_tunnel_inputs(a.opt_string("keyFile")?, a.opt_string("tunnelPassword")?);
        let auth = ssh_tunnel::tunnel_core::tunnel_auth(&key, &password);
        let system = a.opt_string("system")?;
        let tunnel_config = PathBuf::from(a.string("tunnelConfig")?);
        let server_config = PathBuf::from(a.string("serverConfig")?);
        json(self.db.connect_system(system.as_deref().unwrap_or(""), &tunnel_config, &server_config, &auth)?)
    }

    fn connect_alias(&self, a: &Args<'_>) -> Result<Value, String> {
        let system = a.string("system")?;
        let alias = a.string("alias")?;
        let tunnel_config = PathBuf::from(a.string("tunnelConfig")?);
        let server_ids: Vec<String> = a.get("serverIds")?;
        if !self.db.activate(&system) {
            return Err("Open the database session of the system first.".to_string());
        }
        let conn = system_db::read_alias_db(&self.db, &alias, &server_ids)?;
        json(self.db.connect_alias(&format!("{system}|alias:{alias}"), &tunnel_config, &conn)?)
    }

    fn systems(&self) -> Result<Value, String> {
        let active = self.db.active_system();
        let list: Vec<SystemDbStatus> =
            self.db.statuses().into_iter().map(|(system, status)| SystemDbStatus { active: active.as_deref() == Some(system.as_str()), system, status }).collect();
        json(list)
    }
}

#[derive(serde::Serialize)]
struct SystemDbStatus {
    system: String,
    status: DbStatus,
    active: bool,
}

impl FeaturePlugin for DatabasePlugin {
    fn id(&self) -> &'static str {
        "database"
    }

    fn name(&self) -> &'static str {
        "Datenbank"
    }

    fn requires(&self) -> &'static [&'static str] {
        &["ssh-tunnel"]
    }

    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        let a = Args(&args);
        let db = &*self.db;
        match command {
            "db_connect" => self.connect(&a),
            "db_connect_alias" => self.connect_alias(&a),
            "db_disconnect" => {
                match a.opt_string("system")? {
                    Some(s) => db.disconnect_system(&s),
                    None => db.disconnect(),
                }
                json(())
            }
            "db_status" => json(match a.opt_string("system")? {
                Some(s) => db.status_for(&s),
                None => db.status(),
            }),
            "db_systems" => self.systems(),
            "db_activate" => json(db.activate(&a.string("system")?)),
            "db_cancel_connect" => {
                db.cancel_connect();
                json(())
            }
            // `allowWrite` ist nur nach Schreib-Schalter und Bestätigung der Anweisung true.
            "db_query" => json(db.query(&a.string("sql")?, a.get("allowWrite")?)?),
            "db_schema" => json(db.schema()?),
            "system_users" => json(system_db::read_users(db)?),
            "system_user_properties" => json(system_db::read_user_properties(db, &a.string("user")?)?),
            "system_assigned_roles" => json(system_db::assigned_roles(db)?),
            "rest_users" => json(system_db::webservice_users(db)?),
            "system_user_set_property" => {
                Self::confirmed(&a, "Changing a user needs your confirmation.")?;
                json(system_db::update_user_property(db, &a.string("id")?, &a.string("value")?)?)
            }
            "system_user_set" => {
                Self::confirmed(&a, "Changing a user needs your confirmation.")?;
                json(system_db::set_user_property(db, &a.string("user")?, &a.string("key")?, &a.string("value")?)?)
            }
            "system_user_set_list" => {
                Self::confirmed(&a, "Changing a user needs your confirmation.")?;
                json(system_db::set_user_list_property(db, &a.string("user")?, &a.string("key")?, &a.get::<Vec<String>>("values")?)?)
            }
            "system_user_create" => {
                Self::confirmed(&a, "Adding a user needs your confirmation.")?;
                json(system_db::create_user(db, &a.string("title")?)?)
            }
            "system_user_delete" => {
                Self::confirmed(&a, "Removing a user needs your confirmation.")?;
                json(system_db::delete_user(db, &a.string("user")?)?)
            }
            "system_alias_list" => json(system_db::read_system_alias_list(db, &a.get::<Vec<String>>("serverIds")?)?),
            "system_alias_configs" => json(system_db::read_alias_configs(db)?),
            "system_tunnel_state" => json(system_config::system_tunnel_state(&a.root()?, &a.string("tunnelRef")?, &a.string("serverRef")?, &db.tunnels)),
            "system_server_ids" => json(system_config::server_id_candidates(&a.string("configReference")?, &a.string("systemName")?)),
            // Lesen der Alias-Konfiguration aus der Server-Config und Import einer Config-Datei (früher in tunnel.rs/files.rs).
            "read_alias_configs" => json(system_config::read_alias_configs(&a.root()?, &a.string("reference")?)?),
            "import_config_file" => json(system_config::import_config_file(&a.root()?, &PathBuf::from(a.string("source")?))?),
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::FeatureRegistry;
    use serde_json::json;

    struct NoEvents;
    impl EventSink for NoEvents {
        fn emit(&self, _event: &str, _payload: Value) {}
    }

    fn registry(with_tunnel: bool) -> FeatureRegistry {
        let mut reg = FeatureRegistry::new();
        reg.register(Box::new(DatabasePlugin::new(Arc::default(), Arc::new(NoEvents))));
        if with_tunnel {
            reg.register(Box::new(ssh_tunnel::TunnelPlugin::new(Arc::default())));
        }
        reg
    }

    #[test]
    fn plugin_needs_the_tunnel_plugin() {
        let plugin = DatabasePlugin::new(Arc::default(), Arc::new(NoEvents));
        assert_eq!((plugin.id(), plugin.name(), plugin.requires()), ("database", "Datenbank", &["ssh-tunnel"][..]));
        assert!(registry(true).is_available("database"));
        let err = registry(false).call("database", "db_status", json!({})).unwrap_err();
        assert!(err.contains("'ssh-tunnel' ist nicht installiert"), "{err}");
    }

    #[test]
    fn unknown_command_is_reported() {
        assert_eq!(registry(true).call("database", "db_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'db_nope' im Plugin 'database'");
    }

    #[test]
    fn missing_and_wrong_arguments_are_reported() {
        let reg = registry(true);
        assert!(reg.call("database", "db_query", json!({ "sql": "select 1" })).unwrap_err().starts_with("Argument 'allowWrite' fehlt"));
        assert!(reg.call("database", "db_activate", json!({})).unwrap_err().starts_with("Argument 'system' fehlt"));
        assert!(reg.call("database", "db_connect", json!({ "tunnelConfig": "t" })).unwrap_err().starts_with("Argument 'serverConfig' fehlt"));
        let err = reg.call("database", "db_query", json!({ "sql": 1, "allowWrite": false })).unwrap_err();
        assert!(err.starts_with("Argument 'sql' ist ungültig"), "{err}");
    }

    #[test]
    fn writing_commands_need_the_confirmation() {
        let reg = registry(true);
        let err = |cmd: &str, args: Value| reg.call("database", cmd, args).unwrap_err();
        assert_eq!(err("system_user_create", json!({ "title": "x", "confirmed": false })), "Adding a user needs your confirmation.");
        assert_eq!(err("system_user_delete", json!({ "user": "x", "confirmed": false })), "Removing a user needs your confirmation.");
        assert_eq!(err("system_user_set", json!({ "user": "x", "key": "k", "value": "v", "confirmed": false })), "Changing a user needs your confirmation.");
        assert_eq!(err("system_user_set_property", json!({ "id": "1", "value": "v", "confirmed": false })), "Changing a user needs your confirmation.");
        assert_eq!(err("system_user_set_list", json!({ "user": "x", "key": "k", "values": [], "confirmed": false })), "Changing a user needs your confirmation.");
        assert!(err("system_user_create", json!({ "title": "x" })).starts_with("Argument 'confirmed' fehlt"));
    }

    #[test]
    fn without_a_session_nothing_is_open_and_queries_fail() {
        let reg = registry(true);
        assert_eq!(reg.call("database", "db_systems", json!({})).unwrap(), json!([]));
        assert_eq!(reg.call("database", "db_activate", json!({ "system": "dev" })).unwrap(), json!(false));
        assert!(reg.call("database", "db_query", json!({ "sql": "select 1", "allowWrite": false })).is_err());
        assert_eq!(
            reg.call("database", "db_connect_alias", json!({ "system": "dev", "alias": "a", "tunnelConfig": "t", "serverIds": [] })).unwrap_err(),
            "Open the database session of the system first."
        );
    }

    #[test]
    fn server_ids_are_derived_without_a_database() {
        let out = registry(true)
            .call("database", "system_server_ids", json!({ "configReference": "x/fz-1.dev.htc1.adito.cloud_serverconfig_system.xml", "systemName": "dev1" }))
            .unwrap();
        assert_eq!(out[0], "dev");
    }
}
