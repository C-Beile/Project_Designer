//! SSH-Tunnel als Feature-Plugin: bildet die Befehle (Namen wie die früheren Tauri-Befehle) ab.
//! Argumente sind ein JSON-Objekt mit camelCase-Feldern (`projectRoot`, `keyFile` ...).
//! Der `TunnelManager` gehört der App; sie gibt dieselbe `Arc` auch an das Datenbank-Plugin.

use crate::{ssh_keys, ssh_session, tunnel_config};
use crate::tunnel_core::{clean_tunnel_inputs, tunnel_auth, TunnelEntry};
use crate::tunnels::{TunnelManager, TunnelRequest};
use plugin_api::feature::{to_json as json, unknown_command};
use plugin_api::{Args, FeaturePlugin};
use serde_json::Value;
use std::sync::Arc;

pub struct TunnelPlugin {
    tunnels: Arc<TunnelManager>,
}

impl TunnelPlugin {
    pub fn new(tunnels: Arc<TunnelManager>) -> Self {
        Self { tunnels }
    }

    /// Öffnet die Weiterleitung einer Zeile. Schlüsseldatei oder Passwort bleiben nur im Speicher.
    fn connect(&self, a: &Args<'_>) -> Result<Value, String> {
        let row: TunnelRequest = a.get("row")?;
        let (key, password) = clean_tunnel_inputs(a.opt_string("keyFile")?, a.opt_string("tunnelPassword")?);
        let auth = tunnel_auth(&key, &password);
        let entry: TunnelEntry = row.into();
        let target = format!("{}:{}", entry.target_host, entry.target_port);
        let result = self.tunnels.connect(&entry, &auth);
        if let Err(e) = &result {
            let _ = app_base::crashlog::write_entry("TUNNEL", &format!("forward to {target} failed: {e}"));
        }
        json(result?)
    }
}

impl FeaturePlugin for TunnelPlugin {
    fn id(&self) -> &'static str {
        "ssh-tunnel"
    }

    fn name(&self) -> &'static str {
        "SSH-Tunnel"
    }

    fn call(&self, command: &str, args: Value) -> Result<Value, String> {
        let a = Args(&args);
        match command {
            "read_tunnel_config" => json(tunnel_config::read_tunnel_rows(&a.root()?, &a.string("reference")?)?),
            "add_tunnel_row" => json(tunnel_config::add_tunnel_row(&a.root()?, &a.string("reference")?, &a.get("row")?)?),
            "delete_tunnel_row" => json(tunnel_config::delete_tunnel_row(&a.root()?, &a.string("reference")?, a.get("index")?)?),
            "tunnel_connect" => self.connect(&a),
            "tunnel_disconnect" => {
                // `true`: der Tunnel gehört einem anderen Programm, dessen Besitzer wurde gebeten ihn zu schließen.
                json(self.tunnels.disconnect_any(&a.string("targetHost")?, a.get("targetPort")?))
            }
            "tunnel_disconnect_all" => {
                self.tunnels.disconnect_all();
                json(())
            }
            "tunnel_list" => json(self.tunnels.list()),
            // Zusatzadressen 127.0.200.x: vorhanden? Auf macOS einmal einrichten (Admin-Passwort).
            "loopback_status" => json(crate::loopback::status()),
            "loopback_setup" => {
                crate::loopback::setup()?;
                json(crate::loopback::status())
            }
            // Schlüssel prüfen: vorhanden, Format, braucht er eine Passphrase?
            "key_inspect" => json(ssh_keys::inspect_key(&a.string("path")?)),
            // Passphrase prüfen (die mitgegebene, sonst die im Schlüsselbund). `Err` ist der Text für die Oberfläche.
            "key_unlock" => {
                let path = a.string("path")?;
                let given = a.opt_string("passphrase")?.filter(|p| !p.is_empty());
                let passphrase = given.or_else(|| ssh_keys::stored_passphrase(&path));
                ssh_keys::unlock_check(&path, passphrase.as_deref())?;
                json(())
            }
            "key_passphrase_save" => {
                let path = a.string("path")?;
                let passphrase = a.string("passphrase")?;
                ssh_keys::unlock_check(&path, Some(&passphrase))?;
                ssh_keys::save_passphrase(&path, &passphrase)?;
                json(())
            }
            "key_passphrase_forget" => {
                ssh_keys::forget_passphrase(&a.string("path")?)?;
                json(())
            }
            "key_passphrase_stored" => json(ssh_keys::stored_passphrase(&a.string("path")?).is_some()),
            "host_key_forget" => {
                ssh_session::forget_host(&ssh_session::host_id(&a.string("host")?, a.get("port")?));
                json(())
            }
            _ => Err(unknown_command(self.id(), command)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plugin_api::FeatureRegistry;
    use serde_json::json;

    fn registry() -> FeatureRegistry {
        let mut reg = FeatureRegistry::new();
        reg.register(Box::new(TunnelPlugin::new(Arc::default())));
        reg
    }

    #[test]
    fn plugin_has_id_and_needs_nothing() {
        let plugin = TunnelPlugin::new(Arc::default());
        assert_eq!((plugin.id(), plugin.name()), ("ssh-tunnel", "SSH-Tunnel"));
        assert!(plugin.requires().is_empty());
        assert!(registry().is_available("ssh-tunnel"));
    }

    #[test]
    fn unknown_command_is_reported() {
        assert_eq!(registry().call("ssh-tunnel", "tunnel_nope", json!({})).unwrap_err(), "Unbekannter Befehl 'tunnel_nope' im Plugin 'ssh-tunnel'");
    }

    #[test]
    fn missing_and_wrong_arguments_are_reported() {
        let reg = registry();
        assert!(reg.call("ssh-tunnel", "tunnel_disconnect", json!({ "targetHost": "h" })).unwrap_err().starts_with("Argument 'targetPort' fehlt"));
        let err = reg.call("ssh-tunnel", "tunnel_disconnect", json!({ "targetHost": "h", "targetPort": "x" })).unwrap_err();
        assert!(err.starts_with("Argument 'targetPort' ist ungültig"), "{err}");
        assert!(reg.call("ssh-tunnel", "tunnel_connect", json!({})).unwrap_err().starts_with("Argument 'row' fehlt"));
        assert!(reg.call("ssh-tunnel", "read_tunnel_config", json!({ "projectRoot": "x" })).unwrap_err().starts_with("Argument 'reference' fehlt"));
    }

    #[test]
    fn list_of_a_fresh_manager_is_empty() {
        assert_eq!(registry().call("ssh-tunnel", "tunnel_list", json!({})).unwrap(), json!([]));
    }

    #[test]
    fn tunnel_config_path_outside_the_project_is_refused() {
        let err = registry().call("ssh-tunnel", "read_tunnel_config", json!({ "projectRoot": "x", "reference": "../a.xml" })).unwrap_err();
        assert_eq!(err, "Config path must stay inside the project folder.");
    }
}
