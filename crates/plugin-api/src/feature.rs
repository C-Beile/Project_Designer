//! Feature-Plugins: abschaltbare Funktionen (z. B. Git), die der Kern nicht kennt.
//! Die App meldet sie beim Start in einer [`FeatureRegistry`] an; Aufrufe laufen als
//! Befehlsname plus JSON-Argumente über [`FeatureRegistry::call`].

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

/// Ein abschaltbares Feature mit eigenen Befehlen.
pub trait FeaturePlugin: Send + Sync {
    /// Kurze, stabile ID (z. B. `git`).
    fn id(&self) -> &'static str;
    /// Anzeigename.
    fn name(&self) -> &'static str;
    /// IDs anderer Plugins, die vorhanden sein müssen.
    fn requires(&self) -> &'static [&'static str] {
        &[]
    }
    /// Führt einen Befehl aus. Unbekannte Befehle melden [`unknown_command`].
    fn call(&self, command: &str, args: Value) -> Result<Value, String>;
}

/// Wie ein Plugin Events an die Oberfläche meldet (die App setzt es z. B. über Tauri um).
/// Der Event-Name bleibt unverändert (z. B. `forge://build-output`).
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

/// Rückgabe eines Befehls als JSON-Wert.
pub fn to_json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

/// Lesezugriff auf die JSON-Argumente (camelCase-Felder) mit klaren Fehlertexten.
pub struct Args<'a>(pub &'a Value);

impl Args<'_> {
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<T, String> {
        let value = self.0.get(key).ok_or_else(|| format!("Argument '{key}' fehlt"))?;
        serde_json::from_value(value.clone()).map_err(|e| format!("Argument '{key}' ist ungültig: {e}"))
    }

    pub fn string(&self, key: &str) -> Result<String, String> {
        self.get(key)
    }

    /// Fehlt das Feld oder ist es `null`, ergibt das `None`.
    pub fn opt<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(_) => self.get(key).map(Some),
        }
    }

    pub fn opt_string(&self, key: &str) -> Result<Option<String>, String> {
        self.opt(key)
    }

    /// `projectRoot` als Pfad.
    pub fn root(&self) -> Result<PathBuf, String> {
        self.string("projectRoot").map(PathBuf::from)
    }
}

/// Fehlertext für einen Befehl, den das Plugin nicht kennt.
pub fn unknown_command(plugin: &str, command: &str) -> String {
    format!("Unbekannter Befehl '{command}' im Plugin '{plugin}'")
}

/// Angemeldete Feature-Plugins in der Reihenfolge der Anmeldung.
#[derive(Default)]
pub struct FeatureRegistry {
    plugins: Vec<Box<dyn FeaturePlugin>>,
}

impl FeatureRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Meldet ein Plugin an. Eine schon vorhandene ID wird ersetzt.
    pub fn register(&mut self, plugin: Box<dyn FeaturePlugin>) {
        self.plugins.retain(|p| p.id() != plugin.id());
        self.plugins.push(plugin);
    }

    pub fn get(&self, id: &str) -> Option<&dyn FeaturePlugin> {
        self.plugins.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.plugins.iter().map(|p| p.id()).collect()
    }

    /// Angemeldet und alle `requires` (rekursiv) verfügbar.
    pub fn is_available(&self, id: &str) -> bool {
        self.missing_dependency(id, &mut Vec::new()).is_none()
    }

    /// Erstes fehlendes Plugin (`id` selbst oder eine Abhängigkeit). Zyklen gelten als fehlend.
    fn missing_dependency(&self, id: &str, path: &mut Vec<String>) -> Option<String> {
        let Some(plugin) = self.get(id) else { return Some(id.to_string()) };
        if path.iter().any(|p| p == id) {
            return Some(id.to_string());
        }
        path.push(id.to_string());
        let missing = plugin.requires().iter().find_map(|dep| self.missing_dependency(dep, path));
        path.pop();
        missing
    }

    /// Ruft einen Befehl eines Plugins auf.
    pub fn call(&self, plugin: &str, command: &str, args: Value) -> Result<Value, String> {
        let Some(found) = self.get(plugin) else {
            return Err(format!("Plugin '{plugin}' ist nicht installiert"));
        };
        if let Some(missing) = self.missing_dependency(plugin, &mut Vec::new()) {
            return Err(format!("Plugin '{plugin}' ist nicht verfügbar: '{missing}' ist nicht installiert"));
        }
        found.call(command, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Fake {
        id: &'static str,
        requires: &'static [&'static str],
    }

    impl FeaturePlugin for Fake {
        fn id(&self) -> &'static str {
            self.id
        }
        fn name(&self) -> &'static str {
            "Fake"
        }
        fn requires(&self) -> &'static [&'static str] {
            self.requires
        }
        fn call(&self, command: &str, args: Value) -> Result<Value, String> {
            match command {
                "echo" => Ok(args),
                _ => Err(unknown_command(self.id, command)),
            }
        }
    }

    fn fake(id: &'static str, requires: &'static [&'static str]) -> Box<dyn FeaturePlugin> {
        Box::new(Fake { id, requires })
    }

    #[test]
    fn registered_plugin_is_found_and_listed() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("a", &[]));
        reg.register(fake("b", &[]));
        assert_eq!(reg.ids(), vec!["a", "b"]);
        assert!(reg.get("a").is_some() && reg.get("x").is_none());
        assert!(reg.is_available("a") && !reg.is_available("x"));
    }

    #[test]
    fn registering_same_id_replaces() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("a", &[]));
        reg.register(fake("a", &[]));
        assert_eq!(reg.ids(), vec!["a"]);
    }

    #[test]
    fn availability_follows_requires() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("db", &[]));
        reg.register(fake("deploy", &["db"]));
        reg.register(fake("lb", &["db", "tunnel"]));
        assert!(reg.is_available("deploy"));
        assert!(!reg.is_available("lb"));
        reg.register(fake("tunnel", &[]));
        assert!(reg.is_available("lb"));
    }

    #[test]
    fn requires_cycle_is_unavailable_not_endless() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("a", &["b"]));
        reg.register(fake("b", &["a"]));
        assert!(!reg.is_available("a"));
    }

    #[test]
    fn call_forwards_to_plugin() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("a", &[]));
        assert_eq!(reg.call("a", "echo", json!({"x": 1})).unwrap(), json!({"x": 1}));
    }

    #[test]
    fn call_reports_missing_plugin_and_unknown_command() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("a", &[]));
        assert_eq!(reg.call("git", "x", json!(null)).unwrap_err(), "Plugin 'git' ist nicht installiert");
        assert_eq!(reg.call("a", "nope", json!(null)).unwrap_err(), "Unbekannter Befehl 'nope' im Plugin 'a'");
    }

    #[test]
    fn call_reports_missing_dependency() {
        let mut reg = FeatureRegistry::new();
        reg.register(fake("deploy", &["db"]));
        let err = reg.call("deploy", "echo", json!(null)).unwrap_err();
        assert!(err.contains("'db' ist nicht installiert"), "{err}");
    }
}
