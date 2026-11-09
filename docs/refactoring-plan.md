# Plan: Aufteilen in Crates und Plugins

Stand: Planung, noch nichts umgesetzt. Entscheidungen von Lion. Vor dem Umbau mit Clemens abstimmen (Merge-Konflikte, Namen).
Aussagen stammen aus einer Lese-Analyse (nichts gebaut, keine Tests gelaufen). Zeilenzahlen sind ungefähr.

## Umsetzungsstand (2026-11-08)

| Schritt | Status | Anmerkung |
|---|---|---|
| 0 Basislinie | erledigt | Rust: 551 Tests grün, 11 rot (brauchen echte ADITO-Installation/Korpus). UI: 3 Tests rot (round4), 4 Dateien laden nicht (fehlende Dateien unter E:\60_design) |
| 1 workspace.dependencies | erledigt | serde, serde_json, quick-xml, thiserror, tokio |
| 2 errorText | erledigt | core/errorText.ts, 39 Dateien. Umbenennen der Tests rc3/round2/round4 offen |
| 3 lib.rs zerlegen | erledigt | app/src-tauri/src/commands/*, lib.rs 1666 -> 260 Zeilen, Helfer blocking() |
| 4/5 Knoten lösen | erledigt | fs_guard, tunnel_core, object_names, validator_table, designer_paths; Logik aus Befehlen in den Kern |
| 6 Module ordnen | übersprungen | durch Schritt 7 überholt |
| 7 Crates ausziehen | erledigt | aod (aod-io+core-model+refs+qa-corpus-roundtrip), app-base, validators, git, ssh-tunnel, database (inkl. db-layer), deploy, liquibase; umbenannt: native-transpiler, adito-transpiler, npm-modules, plugin-api, designer-core; server-comm gelöscht |
| 7 Umbenennung | erledigt | project (vorher app/core, forge-app-core), designer-app (vorher forge-app), designer-cli (vorher forge); Weiterleitungen aus crates/project/src/lib.rs entfernt |
| 8 Plugin-Mechanismus Backend | in Arbeit | FeaturePlugin, FeatureRegistry, plugin_call, Git als Pilot |
| 9 Frontend core/ | erledigt | Modal, dialogService, notifications, outputBus, shortcuts, uuid, treeIndex, errorHandling |
| 9b UI-Baukasten | in Arbeit | core/ui |
| 10 UI-Register | Pilot erledigt | core/plugins/registry.ts, Git-Menü und Git-Einstellungen über das Register; Befehle, Toolbar, Statusleiste, Baum-Kontextmenü noch nicht umgestellt; Shell.tsx 2787 -> 1492 Zeilen mit Hooks in shell/hooks/ |
| 11 Restliche Plugins | Backend erledigt für ssh-tunnel, database, deploy, liquibase (Cargo-Features, `EventSink`, `plugin_call`); alte Tauri-Befehle entfernt, Frontend noch auf `invoke`; adito-transpiler offen |
| 12 Optional | offen | ts-rs/specta, zustand, CI-Test-Job |

## Ziele

- Isolierte Module wie Assemblies in C#.
- Features (Git, Tunnel, Datenbank, Deploy, Liquibase, offizieller ADITO-Transpiler) sind **abschaltbar**: beim Bauen weglassbar, ohne dass der Kern bricht.
- Features erweitern die Oberfläche selbst (Menü, Einstellungen, Toolbar ...). Der Kern kennt sie nicht.
- Weniger Handcode durch wenige, gezielte Bibliotheken.

## Randbedingungen

- **Themes bleiben intakt.** Die Theme-Presets (Night Owl, Light, "Lion in der City") färben die ganze Oberfläche (`app/ui/src/theme/`, `styles.css`). Neue UI-Bausteine (`core/ui`, Plugin-Masken) nutzen die Theme-Variablen und bringen keine festen Farben mit. Nach jedem UI-Schritt: alle drei Themes ansehen.
- **Recycling vor Neubau.** Plugins sollen fertige Masken (Formular, Liste, Tabelle, Fortschritt, Assistent) benutzen, statt Dialoge neu zu bauen. Die Masken werden zuerst aus vorhandenen Dialogen herausgezogen (Vergleich von 3 bis 4 Dialogen, z. B. `GitDialog`, `SelectDatabaseConnectionDialog`, `DeployOptionsDialog`), nicht frei erfunden.
- **Arbeitsweise (Token sparen).** Umsetzung nicht mit Opus. Kleine Schritte an Sonnet-Subagenten (`code-writer`), reine Fleißarbeit an Haiku (`code-chores`), nur bei echter Architekturfrage Opus. Nur lesen, was der Schritt braucht.

## Ziel-Crates (16)

| Gruppe | Crate (neu) | Heute | Wofür |
|---|---|---|---|
| Kern | `platform` | `platform` | Betriebssystem: Prozesse, Dateien, Dialoge, Anmeldedaten |
| Kern | `aod` | `aod-io` + `core-model` + `refs` + `qa-corpus-roundtrip` | `.aod` lesen/schreiben (byte-genau), Eigenschaften-Baum, Undo/Redo, Verweise, Roundtrip-Prüfung |
| Kern | `app-base` | Teile von `crates/project` | Crashlog, Backup, Schreibschutz, Designer-Pfade |
| Kern | `npm-modules` | `module-graph` | npm-Module, Zyklen, Versionskonflikte |
| Kern | `validators` | 11 `*_validators.rs` in `crates/project` | Prüfer für Objekte |
| Kern | `native-transpiler` | `differential-harness` | Eigener Rust-Transpiler (`own_engine/`), plus Vergleichswerkzeug (compare/harness/report) als Modul/Binary |
| Kern | `project` | `crates/project` (`project`) | Projektmodell: Actor, Baum, Neues Objekt, Umbenennen, Zip, Katalog, Transpile-Aktionen |
| Schnittstelle | `plugin-api` | `plugin-kernel` | Schnittstellen: Validator, Action, Transpiler, Feature-Plugin (siehe unten) |
| Plugin | `git` | `git_actions`, `git_scm`, Teile `lib.rs`/`project_create` | Git komplett |
| Plugin | `ssh-tunnel` | `tunnels`, `tunnel_client`, Teile `db_session` | SSH-Tunnel (plink) |
| Plugin | `database` | `db-layer` + `db_session` + `system_db` (Users/Aliase) + `system_config` | Treiber, Sitzungen, SQL, System-Konfiguration |
| Plugin | `deploy` | `deploy_encode`, Deploy-Teil `system_db` | Deploy-Zeilen für `ASYS_SYSTEM` (braucht `database`) |
| Plugin | `liquibase` | `liquibase` + Befehle aus `lib.rs` | Liquibase-Update (braucht `database`, `ssh-tunnel`) |
| Plugin | `adito-transpiler` | `transpiler` | Ruft den offiziellen ADITO-Transpiler auf (optional) |
| Oberfläche | `designer-core` | `forge-core` | Fassade ohne UI (später evtl. auflösen) |
| Oberfläche | `designer-app` / `designer-cli` | `designer-app` / `designer-cli` | Tauri-App / Kommandozeile |

Gestrichen: `server-comm` (nicht genutzt, nur Platzhalter).
Offen: Transpile-Aktionen (`transpile_action`, `transpile_compare`, `official_transpiler_setup`, `actions`) bleiben vorerst in `project`.

Regel: Abhängigkeit nur nach oben. Der Kern kennt keine Plugins. `designer-app` bindet Plugins per Cargo-Feature ein.
Zu prüfen vor dem Umbau: Nutzt der Kern heute schon Git oder andere Plugins direkt (z. B. `project_create` klont über Git)?

## Plugin-Schnittstelle (`plugin-api`)

Heute (`plugin-kernel`): nur `Validator`, `Action`, `LinkedFileCompiler`, `EditorProvider` (ungenutzt). Genutzt von den 11 Validatoren, `transpile_action`, `forge-core`, CLI `validate`.
Neu dazu:

- `Transpiler`-Schnittstelle: `native-transpiler` immer, `adito-transpiler` optional. Die Aktionen fragen die Registry, nicht die Crates.
- `Plugin`/`Feature`: ID, Name, Abhängigkeiten, Befehle, UI-Beiträge.
- Backend-Weg: **ein** Tauri-Befehl `plugin_call(plugin, befehl, daten)` leitet an das angemeldete Plugin. Grund: Tauri braucht die Liste fester Befehle zur Compile-Zeit. Fehlt das Plugin: Antwort "nicht installiert", die UI blendet es aus.
- Events bekommen die Plugin-ID im Namen.
- Rust lädt keine Plugin-DLLs zur Laufzeit. "Abschaltbar" heißt: beim Bauen per Cargo-Feature weglassen (UI zusätzlich zur Laufzeit ausblendbar).

## UI-Einstiegspunkte (Frontend)

Heute (gesehen):

- `editors/registry.ts`: `registerEditor(typ, Komponente)` – gutes Vorbild, bleibt.
- `shell/menuModel.ts`: Menü als feste Daten. Git steckt hartcodiert drin (`gitActive`, Menü "Team").
- `shell/OptionsDialog.tsx`: Einstellungen als große if/else-Kette nach Kategorie.
- `settings/plugins.ts`: feste Liste, nur Schalter, die Menüs dimmen.
- `windows/DialogWindowApp.tsx`: Tabelle `DialogSpec` für Dialoge in eigenen Fenstern.
- `Shell.tsx`: Befehle als großer Switch (`runCommand`).

Neu: ein Register pro Einstiegspunkt. Ein Plugin ruft beim Start `register...` auf.

| Einstiegspunkt | Zweck | Beispiel Git |
|---|---|---|
| Befehle | `registerCommand(id, run)` statt Switch | `git.commit` |
| Menü | Einträge in vorhandene oder neue Menüs, mit Ort, Reihenfolge, Aktiv-Bedingung | Menü "Team" |
| Einstellungen | Eigene Seiten/Tabs in den Optionen | Seite "Git" |
| Toolbar | Buttons | Commit, Push |
| Kontextmenü Projektbaum | Einträge je Objekttyp | "Show History" |
| Dialoge/Fenster | `registerDialog` (wie `DialogSpec`) | Commit-Fenster |
| Panels/Tabs | Dock-Panels, Editor-Tabs | Git-Log |
| Statusleiste | Anzeigen | Branch-Name |
| Editoren | `registerEditor` (existiert) | – |
| Plugins-Dialog | Liste aus der Registry statt fester Liste | – |

Die UI-Beiträge fragen nie "ist Git aktiv?", sondern: Existiert das Plugin in der Registry? Wenn nicht, gibt es die Einträge nicht.

## Bibliotheken

- Ja, sofort: `[workspace.dependencies]` (Versionen zentral), `AppError` + `blocking()`-Helfer in `designer-app` (ersetzt ca. 67 + 81 wiederholte `map_err`/`spawn_blocking`-Zeilen), TS-Helfer `errorText(e)` (83 Wiederholungen).
- Pilot später: `ts-rs` oder `specta` für `wire/types.ts` (591 Zeilen von Hand). Achtung bei 64-Bit-Zahlen.
- Später/niedrig: `zustand` für die 14 handgebauten Stores.
- Nein: `git2`, `anyhow`, `tauri-specta`, UI-Kit, `sqlparser`.

## Reihenfolge (jeder Schritt ein Commit, `git mv` nutzen)

| # | Schritt | Prüfen |
|---|---|---|
| 0 | Basislinie: `cargo test --workspace`, `npm test`, Ergebnis notieren | – |
| 1 | `[workspace.dependencies]` | `cargo check --workspace` |
| 2 | `errorText()`; Tests `rc3/round2/round4.test.tsx` nach Thema benennen | `npx tsc -b`, `npm test` |
| 3 | `lib.rs` in `commands/<feature>.rs` zerlegen; `AppError`/`blocking()` | `cargo check -p designer-app`, Smoke-Test |
| 4 | Geschäftslogik aus `lib.rs` in den Kern (Liquibase, Tunnel-Auth doppelt, `system_tunnel_state`, Branch/History) | `cargo test`, Smoke-Test |
| 5 | Knoten lösen: `ensure_writable` aus `tree.rs`; Tunnel-Teile aus `db_session`; `valid_object_name`/`MSG_EXISTS` (`new_object` ↔ `tree_ops`); Validator-Tabelle aus `project_actor`; Designer-Pfade aus `tree`/`settings` | `cargo test -p project` |
| 6 | Module in Unterordnern nach Feature gliedern | `cargo test` |
| 7 | Crates ausziehen: `app-base`, `validators`, `aod` (Merge), `git`, `ssh-tunnel`, `database`, `deploy`, `liquibase`, `native-transpiler`, `adito-transpiler`; Umbenennungen als eigener Commit | `cargo test -p <Crate>`, `cargo check -p designer-app` |
| 8 | `plugin-api` erweitern (Transpiler, Feature-Plugin), `plugin_call` einführen, **Pilot: Git** | Smoke-Test, Git ein/aus bauen |
| 9 | Frontend `core/` anlegen (dialogService, notifications, Modal, outputBus, shortcuts, errorText) | `npx tsc -b`, `npm test` |
| 9b | UI-Baukasten `core/ui`: Masken (Formular, Liste, Tabelle, Fortschritt, Assistent) aus vorhandenen Dialogen herausziehen; Themes prüfen | `npm test`, alle 3 Themes ansehen |
| 10 | UI-Register einführen (Befehle, Menü, Einstellungen, Toolbar, Kontextmenü, Dialoge, Statusleiste); `Shell.tsx` in Hooks/Features zerlegen | `npm test` nach jedem Hook |
| 11 | Restliche Plugins umstellen (Tunnel, Database, Deploy, Liquibase, adito-transpiler); `ForgeApi`/`tauriApi`/`mockApi` pro Feature trennen | Tests, Smoke-Test |
| 12 | Optional: `ts-rs`/`specta`-Pilot, `zustand`, Test-Job in CI | – |

## Nicht anfassen

- Byte-Treue und ihre Tests: `aod-io`, `core-model`, `forge-core`, `module-graph`, `refs`, `transpiler`, `differential-harness`, `modification_write.rs` (+ `tests/modification_real.rs`), `transpile_action.rs` (Verhalten).
- Thread-Modell des Actors in `project_actor.rs` (`ProjectHandle` enthält `Rc`, nicht `Send`). Teilen in Module ist erlaubt.
- Sicherheitscode: `scrub`, `redact_text`, `is_read_only`, Zugangsdaten nur im Speicher.
- Befehlsnamen (135), Event-Namen `forge://...`, snake_case-Feldnamen der DTOs, `WireValue`-Tags (bis `plugin_call` bewusst umgestellt ist).
- Generierte Dateien (`*.generated.ts`, `crates/project/assets/*.json`).
- macOS-Pfade (`cfg`-Code): CI baut sie, sie müssen weiter kompilieren.

## Risiken

- Merge-Konflikte mit Clemens (Verschieben, `Shell.tsx`).
- Tests mit privatem Zugriff (`sheet_actor_tests`, `tree_tests`) brauchen beim Crate-Split `pub` oder wandern mit.
- `designer-app` hat keine eigenen Tests: Fehler bei `plugin_call` und Event-Namen zeigen sich erst im Smoke-Test.
- `Shell.tsx`: Hooks teilen State über Refs (`floatApiRef`, `editorWindowsRef`, `removeElementRef`). Falsch geschnittene Hooks erzeugen Render-Schleifen.
- Globale Zustände (`crashlog`, `backup`, Log-Senke in `transpile_action`, Host-Key-Flag in `tunnel_client`) müssen in genau einem Crate leben.
- CI (`release.yml`) führt keine Tests aus.

## Offene Fragen an Clemens

1. Arbeitet er parallel an denselben Dateien? Zeitfenster ohne Änderungen?
2. Wo liegen `architecture.md`, `RISKS.md`, `PROJECT/...`? Sind R13/R22 (GNU-Linkfehler) mit MSVC erledigt? (Toolchain wurde lokal auf MSVC gestellt, noch nicht committet.)
3. Brauchen die `*_real`-Tests ein lokales Korpus oder eine ADITO-Installation?
4. Warum hat `plugin-kernel` eigene Platzhalter-Typen (`ProjectModel`, `PropertyNode`) mit einer Brücke in `forge-core`? Sollen sie durch die echten Typen aus `aod` ersetzt werden?
5. Ist macOS ein aktives Ziel? Soll CI `cargo test`/`npm test` laufen lassen?
6. Dürfen Befehls-, Event- und Feldnamen geändert werden (CLI, andere Fenster)?
7. `server-comm` streichen: einverstanden?
