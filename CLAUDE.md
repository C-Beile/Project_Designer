# Dito Designer

Desktop-Editor für ADITO-Projekte (xRM). Nachbau des ADITO Designers mit Rust und Tauri 2.
Internes Werkzeug von 3Hills IT. Begonnen von Clemens (Kollege). Lion arbeitet im Branch `lion`.
Lion kennt C#/.NET gut, aber kein Rust und kein Tauri. Erkläre einfach und mit C#-Vergleichen.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/ui` | React-19-Oberfläche (TypeScript, Vite, Monaco-Editor, Vitest) |
| `app/src-tauri` | Tauri-Hülle (Paket `designer-app`). `src/commands/*` sind die Tauri-Befehle, `src/lib.rs` hat die Handler-Liste und baut die Plugin-Registry |
| `crates/` | Alle Rust-Bibliotheken (siehe unten) |
| `cli/forge` | Kommandozeilen-Tool (Paket `designer-cli`) |
| `scripts/` | Build-Skripte (Installer) |

Änderungen von außen: `file-watcher` → `project-index` (Stempel-Abgleich) → Events `forge://index-progress` und `forge://project-changed` → UI (`useExternalChanges`, `IndexStatusItem`). Kein Polling mehr.
Datenfluss: React-UI → `invoke('befehl')` (`app/ui/src/api/tauriApi.ts`) → Befehl in `app/src-tauri/src/commands/` → Logik in `crates/project` und den Plugin-Crates.
Plugin-Befehle laufen über den einen Tauri-Befehl `plugin_call(plugin, command, args)`.

### Crates (`crates/`)

| Gruppe | Crate | Wofür |
|---|---|---|
| Kern | `platform` | Betriebssystem: Prozesse, Dateien, Dialoge, Anmeldedaten |
| Kern | `aod` | `.aod` byte-genau lesen/schreiben (`document`), Baum + Undo/Redo (`tree`), Verweise (`refs`) |
| Kern | `app-base` | Crashlog, Backup, Schreibschutz, Designer-Pfade, Text-Maskierung (`scrub`) |
| Kern | `npm-modules` | npm-Module, Zyklen, Versionskonflikte |
| Kern | `validators` | Die Prüfer für Objekte |
| Kern | `file-watcher` | Beobachtet einen Ordner, liefert gebündelte Pakete (`Batch`) |
| Kern | `project-index` | Index über das Projekt: Dateien, Verweise, Probleme; hält sich per Watcher aktuell |
| Kern | `native-transpiler` | Eigener Rust-Transpiler (`own_engine/`) plus Vergleichswerkzeug (Feature `harness`) |
| Kern | `project` | Das offene Projekt: Actor, Baum, Umbenennen, Zip, Katalog, Transpile-Aktionen |
| Schnittstelle | `plugin-api` | `FeaturePlugin`/`FeatureRegistry`, `EventSink`, `Transpiler`/`TranspilerRegistry`, Validator, Action |
| Plugin | `git` | Git (`GitPlugin`, id `git`) |
| Plugin | `ssh-tunnel` | SSH-Tunnel (id `ssh-tunnel`) |
| Plugin | `database` | Treiber, Sitzungen, SQL, Users/Aliase (id `database`, braucht `ssh-tunnel`) |
| Plugin | `deploy` | Deploy-Zeilen (id `deploy`, braucht `database`) |
| Plugin | `liquibase` | Liquibase-Update (id `liquibase`, braucht `database`, `ssh-tunnel`) |
| Plugin | `adito-transpiler` | Ruft den offiziellen ADITO-Transpiler auf (id `adito`) |
| Oberfläche | `designer-core` | Fassade ohne UI |

Plugins sind Cargo-Features in `app/src-tauri/Cargo.toml` (alle standardmäßig an): `git`, `ssh-tunnel`, `database`, `deploy`, `liquibase`, `adito-transpiler`.
Rust lädt keine Plugin-DLLs zur Laufzeit. "Abschaltbar" heißt: beim Bauen weglassen.

### Frontend (`app/ui/src`)

- `core/` gemeinsame Bausteine (Modal, dialogService, notifications, outputBus, shortcuts, errorText, `plugins/registry.ts`, `ui/` Masken: FormDialog, ListDialog, DataTable, ProgressBar).
- `core/plugins/registry.ts`: Einstiegspunkte für Plugins (Befehle, Menü, Einstellungsseiten, Toolbar, Statusleiste, Baum-Kontextmenü, Dialoge/Panels per Id, Shell-Beiträge). `core/scm.ts`: neutraler Store für den Source-Control-Stand.
- `features/git/` Git-UI, meldet sich über `registerGitPlugin()` an (nur wenn das Backend das Plugin hat, siehe `features/registerFeatures.ts` und `plugin_list`). Außerhalb von `features/git` importiert nur `test/setup.ts` den Ordner; der Kern holt Dialoge, Panels und den Git-Zustand über das Register und `core/scm.ts`.
- `shell/Shell.tsx` Hauptfenster (nur noch Verdrahtung, ca. 750 Zeilen), `shell/ShellPanels.tsx` Panels und Editor-Bereich, `shell/hooks/` die ausgezogenen Hooks (`useShellCommands`, `useTabs`, `useSave`, `useProjects`, `useSelection`, `useDeploy`, `useTranspile` ...). `closeProjects`, `handleTreeSelect`, `openSql`, `openProblem` blieben in Shell.tsx, weil sie quer auf viele Hooks zugreifen. `editors/` ein Editor je Objekttyp.
- Themes: Night Owl, Light, "Lion in der City". Neue UI nutzt nur CSS-Variablen, keine festen Farben.

### CSS (`app/ui/src`)

- `styles.css` ist nur eine Liste von `@import`-Zeilen. **Die Reihenfolge zählt** (bei gleicher Stärke gewinnt die spätere Regel). Nicht umsortieren, ohne alle drei Themes anzusehen.
- Regeln, die nur **eine** Komponente nutzt, liegen als `Name.css` neben `Name.tsx` (z. B. `editors/AliasDbEditor.css`, `shell/Toolbar.css`). Eingebunden wird sie in `styles.css`, nicht in der Komponente.
- Alles Geteilte liegt nach Thema in `styles/*.css` (z. B. `statusbar.css`, `property-sheet.css`, `dialog-structure.css`). `styles/shell/` (19 Teile) enthält den früheren großen Shell-Block, in der alten Reihenfolge nach Thema geschnitten.
- Neue Regeln einer Komponente kommen in deren `Name.css`. Hat die Komponente noch keine, dann Datei anlegen und in `styles.css` an passender Stelle importieren (nach den Regeln, die sie überschreibt).
- Nur CSS-Variablen aus `theme/tokens.css`, keine festen Farben. Alte Versionsnamen (rc5, 0.7.0) nicht mehr als Dateinamen nutzen.
- Offen: Teile in `styles/shell/` und andere Themen-Dateien von Hand zu den Komponenten verschieben (jeweils mit Sichtprüfung der Themes).

## Karten pro Ordner (für Agenten)

Wichtige Ordner haben eine eigene `CLAUDE.md` (Karte) mit Dateiliste, Regeln, Fallen und "Wenn du X ändern willst". Claude Code lädt sie, sobald man dort eine Datei liest. Einstieg: `crates/CLAUDE.md` (Rust), `app/ui/CLAUDE.md` (UI). Vorhanden (24): Rust: `crates`, `crates/{project,aod,native-transpiler,plugin-api,database,validators,designer-core,platform,file-watcher,project-index}`, `app/src-tauri`. UI: `app/ui`, `app/ui/src/{shell,shell/hooks,editors,core,features/git,properties,tabs,tree,windows,theme,styles}`. Kleine Crates und kleine UI-Ordner stehen in `crates/CLAUDE.md` und `app/ui/CLAUDE.md`.

- Wer Dateien anlegt, verschiebt oder löscht, passt die Karte des Ordners an (Tabelle zwischen `AUTO:START` und `AUTO:END`).
- Prüfen: `powershell -File scripts/check-maps.ps1` (Exit-Code = Anzahl Fehler). `-Fix` ergänzt neue Dateien mit `TODO`; den Satz dazu von Hand schreiben.
- In Aufträgen an Subagenten steht: "Lies zuerst `<Ordner>/CLAUDE.md`, öffne danach nur die Dateien, die die Karte nennt, und melde falsche Karten-Angaben."
- `docs/refactoring-plan.md` ist Historie, nur bei Bedarf lesen.

## Bibliotheken

- Frontend: react, react-dom, monaco-editor, marked, dompurify, @tauri-apps/api. Kein State-Manager, kein Komponenten-Kit, kein Router. Alles eigenes CSS (`styles.css`).
- Rust: tauri 2 (+ updater, log), serde, quick-xml, tokio, sqlx (MySQL/Postgres), tiberius (MSSQL), zip, notify, rfd (Datei-Dialoge), windows-sys, clap, thiserror.
- Git, SSH-Tunnel und Transpiler laufen über externe Programme, nicht über Bibliotheken.

## Bauen und starten (Windows)

- Toolchain: **MSVC** (`rust-toolchain.toml`, `stable-x86_64-pc-windows-msvc`). Braucht den Workload "Desktopentwicklung mit C++". Die alte GNU-Konfiguration von Clemens (`.cargo/config.toml` mit festen Pfaden) wurde entfernt.
- Einmalig: `cd app/ui && npm install`
- Starten: `cd app && npx --prefix ui tauri dev`
- Rust prüfen: `cargo check --workspace --tests --examples`; App mit weniger Features: `cargo check -p designer-app --no-default-features --features git`
- Tests: `cargo test --workspace --no-fail-fast` und `cd app/ui && npm test`
- UI-Typen prüfen: `cd app/ui && npx tsc -p tsconfig.app.json --noEmit` (ein nacktes `npx tsc --noEmit` prüft nichts, `tsconfig.json` hat nur Verweise).
- Editor ist **VS Code** (nicht Visual Studio). `.vscode/` ist per `.gitignore` lokal. Dort liegt eine F5-Konfiguration "Dito Designer (Debug)" mit `cppvsdbg` (Erweiterung `ms-vscode.cpptools`).
- Logs der App: `%APPDATA%\de.threehillsit.dito-designer\logs` (Menü Help > Open Log Folder). Dort landen Abstürze (`PANIC`), UI-Fehler (`UI-ERROR`, auch Fehler-Popups und fehlgeschlagene Tauri-Befehle), Plugin-Fehler (`ERROR plugin_call plugin.befehl (Argumente): Fehler`, Geheimnisse verdeckt) und Zeiten (`PERF`).

## Stand der Tests (nach Index + File-Watcher, 2026-11-12)

- Rust: 676 grün, 12 rot. Alle 12 brauchen eine echte ADITO-Installation oder ein Korpus (`native-transpiler` lib 2 + `full_harness_run`, `npm-modules` resolve_real_corpus 3 + resolve_synthetic 2, `adito-transpiler` real_transpiler 2, `project` transpile_action_real 2: `official_engine...` und `missing_engine_param...`, weil der offizielle Transpiler Standard ist). `native-transpiler` `incremental_stage` ist manchmal flaky.
- UI: 606 grün, 3 rot (`newObjectRenameZip.test.tsx`), 4 Testdateien laden nicht (fehlende Dateien unter `E:0_design`: sheetLayout, menuSpec, toolbarSpec, popupSpec).
- Bauen mit MSVC: `rust-toolchain.toml` steht auf GNU (braucht MinGW im PATH). Ohne MinGW: `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc` setzen.

## Umbau

Aufteilung in Crates und Plugins nach `docs/refactoring-plan.md` (dort Stand, Namen, Begründungen). Umgesetzt, aber **nicht committet** und **nicht in der laufenden App geprüft**. Umgestellt auf das UI-Register: Git-Toolbar-Knöpfe, Statusleisten-Slots, Baum-Kontextmenü-Slot, Plugins-Dialog (`mergePluginList`). Auch der Git-Branch-Knopf der Statusleiste (`features/git/GitStatusItem.tsx`) und die Git-Befehle (`team.*`) hängen jetzt am Register. Offen: optional `ts-rs`/`specta`. CI: `.github/workflows/ci.yml` (Tests blockieren noch nicht, siehe Basislinie).

## Konfiguration (`designer.conf`)

- Eine Datei für alle Einstellungen: `%APPDATA%\de.threehillsit.dito-designer\designer.conf`, **TOML**, ein Abschnitt je Art (`[general]`, `[ssh]`, `[projects]`, `[window]`, `[popups.<name>]`, `[appearance]`, `[options]`, `[editor]`, `[toolbar]`, `[layout]`, `[plugins]`, `[deploy]`, `[rest]`, `[tree]`, `[windows]` ...).
- Regeln (`crates/app-base/src/config.rs`): leere Werte (`null`, leere Listen/Abschnitte) werden nie gespeichert; Pfade (Werte **und** Schlüssel) immer mit `/`; Lesen nachsichtig; Schreiben atomar und unter einem Schloss (`config::update`).
- Oberfläche: `app/ui/src/settings/appConfig.ts` (`configGet`/`configSet`, Pfad als Liste). Kein `localStorage` mehr. Geladen wird einmal in `main.tsx`, geschrieben gebündelt; andere Fenster folgen über `forge://config-changed` (`onConfigChange`).
- Fenster: Hauptfenster und Dialog-Fenster merken Lage, Größe, Bildschirm (`app/src-tauri/src/window_state.rs`, Regeln in `app_base::window_state`).
- Zugangsdaten stehen nie in der Datei (Windows-Anmeldeinfo bzw. Git Credential Manager).
- Alte `settings.json` und `recent-project.json` werden einmal übernommen, wenn es noch keine `designer.conf` gibt. Alte `localStorage`-Werte werden ignoriert.

## Bekannte Punkte

- Windows meldet bei zu vielen Datei-Änderungen auf einmal nichts (16-KB-Puffer läuft über, `notify` wirft das weg). Darum: `vendor/notify` (Kopie von notify 6.1.1 mit Patch, `[patch.crates-io]`, mit Clemens abstimmen), Verdacht ab 64 Events, Abgleich beim Fokus und bei jedem Neuladen aus der App. Siehe `crates/platform/CLAUDE.md`.
- Offener Fehler: Die App stoppt nach der Projektauswahl (Datei-Dialog, Bibliothek `rfd`) unter dem Debugger. Ursache nicht geklärt.
- `rust-toolchain.toml` betrifft das ganze Team. Änderungen vorher mit Clemens abstimmen.
- Der eigene Code nutzt `unsafe` nur in `crates/platform/src/windows/credentials.rs`.
- Der Kern hängt noch am Setzen des Host-Key-Flags des Tunnels (`set_accept_new_host_keys`, per Feature `ssh-tunnel` geschützt).
- Die Testdateien `rc3`, `round2`, `round4` heißen jetzt `tunnelDialogsAndOutput`, `menusOutputProblemsPlugins`, `newObjectRenameZip`.

## Arbeitsregeln für dieses Projekt

- Antworten auf Deutsch, einfache kurze Sätze.
- Dokumentation im Code auf Deutsch, nur wenn nötig.
- Nichts committen oder pushen ohne Auftrag.- Neue UI-Teile eines Features über das UI-Register (`core/plugins/registry.ts`) anmelden, nicht fest in Shell/Toolbar/StatusBar einbauen. Eigene Masken aus `core/ui/` nutzen (Recycling).
- Neue Befehle eines Plugins über `plugin_call` laufen lassen, nicht als neuer Tauri-Befehl. Jeder Tauri-Befehl packt seinen Rumpf in `commands::guard`/`guard_async` (Panic-Schutz, siehe `app/src-tauri/CLAUDE.md`).
- Einfache, mechanische Aufgaben an Haiku (`code-chores`), nicht an Opus.
