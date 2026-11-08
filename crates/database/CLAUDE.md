# database – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Cargo.toml` | `sqlx` (MySQL, Postgres), `tiberius` (MSSQL), `tokio`, `quick-xml`. Abhängig von `ssh-tunnel`. |
| `src/` | Quellcode. Einzeldateien folgen. |
| `src/lib.rs` | Modulliste, exportiert `DatabasePlugin`. |
| `src/plugin.rs` | `DatabasePlugin` (id `database`, braucht `ssh-tunnel`): alle Befehle in `call`. |
| `src/db_session.rs` | `DbManager`: Sitzungen je System, Tunnel öffnen, verbinden, `query`, `transaction`, `schema`, `is_read_only`. |
| `src/system_config.rs` | Lesen der Export-Dateien `*_serverconfig_system.xml` und `*_tunnelconfig.xml` (Alias-Konfigurationen, Tunnel-Liste), `import_config_file`. |
| `src/system_db.rs` | Lesen und Ändern der Systemdatenbank: Benutzer, Rollen, Alias-Konfigurationen. Geheimnisse maskieren. |
| `src/drivers/` | Die Treiber hinter einem Trait. Einzeldateien unten. |
| `src/drivers/mod.rs` | Modulliste der Treiber. |
| `src/drivers/connection.rs` | Trait `DbConnection` (`test_connection`, `execute_query`, `list_tables`, `execute_transaction`). |
| `src/drivers/types.rs` | `ConnectionConfig`, `DbValue`, `QueryResult`, `TableInfo`, `TxStatement`. |
| `src/drivers/error.rs` | `DbError` (nicht erreichbar, Abfrage-Fehler, `Unsupported`). |
| `src/drivers/mariadb.rs` | MariaDB/MySQL über `sqlx`. |
| `src/drivers/postgres.rs` | PostgreSQL über `sqlx`. |
| `src/drivers/mssql.rs` | MS SQL über `tiberius` (rustls, kein ODBC). |
| `src/drivers/mock.rs` | `MockConnection` für Tests. |
<!-- AUTO:END -->

## Zweck
Datenbank-Plugin `database`: Verbindung zur Systemdatenbank eines ADITO-Systems (über SSH-Tunnel), SQL-Abfragen, Schema, Benutzer und Alias-Konfigurationen. Die Treiber sind getrennt vom Rest, damit andere Plugins (`deploy`, `liquibase`) denselben `DbManager` nutzen.

## Einstiegspunkte
- `DatabasePlugin::new(Arc<DbManager>, Arc<dyn EventSink>)`, in `build_feature_registry` (`app/src-tauri/src/lib.rs`) angemeldet.
- `DbManager::with_tunnels(Arc<TunnelManager>)`: dieselbe Tunnel-`Arc` wie das Tunnel-Plugin.
- Befehle (`plugin.rs`): `db_connect`, `db_connect_alias`, `db_disconnect`, `db_status`, `db_systems`, `db_activate`, `db_cancel_connect`, `db_query`, `db_schema`, `system_users`, `system_user_*`, `system_assigned_roles`, `system_alias_list`, `system_alias_configs`, `system_tunnel_state`, `system_server_ids`, `read_alias_configs`, `import_config_file`.
- Event `forge://tunnel-progress` meldet den Verbindungsfortschritt.

## Abhängigkeiten
- Rein: `ssh-tunnel`, `app-base`, `platform`, `plugin-api`.
- Raus: `deploy`, `liquibase`, `app/src-tauri`. `project` nutzt es nur in Beispielen und Tests.

## Regeln und Fallen
- Zugangsdaten nur im Speicher. Nie auf die Platte, nie ins Log, nie in Fehlertexte (`scrub` aus `ssh_tunnel::tunnel_core`). Passwort-Spalten werden entfernt, Geheimnisse in Zelltexten maskiert (`system_db.rs`, `system_config.rs`).
- Schreibende Benutzer-Befehle (`system_user_set*`, `_create`, `_delete`) verlangen das Argument `confirmed: true`. Das gilt auch für neue schreibende Befehle.
- `db_query` mit `allowWrite: false` lässt nur lesende SQL zu (`is_read_only`). Die UI setzt `allowWrite` erst nach Schreib-Schalter und Bestätigung.
- `db_session.rs` verbindet die Systemdatenbank und die Alias-Datenbanken heute nur über `mariadb::connect`. Postgres und MSSQL gibt es als Treiber, aber `DbManager` baut sie nicht auf.
- Transaktionen: nur `mariadb.rs` (und `mock.rs`) setzen `execute_transaction` um. Die anderen Treiber melden `DbError::Unsupported`.
- Der Crate-Kommentar in `drivers/mod.rs` heißt noch `db-layer`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Plugin-Befehl | `src/plugin.rs` (`call`), Logik in `system_db.rs` oder `db_session.rs` |
| Neue Abfrage der Systemdatenbank | `src/system_db.rs` |
| Neue Datenbank-Art | `src/drivers/<name>.rs` mit `DbConnection`, in `drivers/mod.rs`, dann in `db_session.rs` aufbauen |
| Export-Dateien (XML) anders lesen | `src/system_config.rs`, `parse_system_alias` in `src/db_session.rs` |
| Was als "nur lesen" gilt | `is_read_only` in `src/db_session.rs` |

## Tests
- `cargo test -p database`. Kein echter Server nötig (`MockConnection`, Plugin-Tests in `plugin.rs`).
- Echte Verbindung: Beispiel `db_live` in `crates/project/examples/` (braucht ein System).
