# ui – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `package.json` | Skripte: `dev`, `build`, `test` (vitest). Abhängigkeiten laut Root-`CLAUDE.md`. |
| `package-lock.json` | Gesperrte npm-Versionen. |
| `index.html` | Einstiegsseite von Vite. |
| `vite.config.ts` | Vite und Vitest (jsdom, `src/test/setup.ts`), Port 5173. |
| `tsconfig.json` | Nur Verweise (`files: []`). Prüft selbst nichts. |
| `tsconfig.app.json` | Echte TS-Regeln für `src`. |
| `tsconfig.node.json` | TS-Regeln für die Vite-Konfiguration. |
| `src/` | Der ganze Quellcode. Einstieg: `src/main.tsx`, dann `src/App.tsx`. |
| `src/api/` | `ForgeApi.ts` (Schnittstelle), `tauriApi.ts` (echte `invoke`-Aufrufe), `sqlLog.ts`. |
| `src/assets/` | Schriften und Marken-Bilder. |
| `src/chrome/` | Eigene Titelleiste und Fenster-Aufrufe. |
| `src/core/` | Gemeinsame Bausteine: Modal, dialogService, notifications, outputBus, shortcuts, errorText. |
| `src/core/plugins/` | `registry.ts`: UI-Register für Plugins (Befehle, Menü, Optionen, Toolbar, Statusleiste, Baum-Menü, Dialoge). |
| `src/core/ui/` | Masken-Baukasten: FormDialog, ListDialog, DataTable, ProgressBar, `uiDialogs`. |
| `src/diagnostics/` | Panels für Diagnosen, Probleme und Scan-Dienste. |
| `src/editors/` | Ein Editor je Objekttyp, `registry.ts` und `register*Builtins.ts`. |
| `src/features/` | Plugin-UI. Heute nur `git/` (Vorlage). `registerFeatures.ts` meldet die Plugins an. |
| `src/navigator/` | Navigator-Panel. |
| `src/platform/` | `pathKey.ts`: Pfade vergleichen. |
| `src/problems/` | `problemStore.ts`: eine Liste aller Probleme. |
| `src/properties/` | Properties-Panel, Sheet-Modell, Icon- und Wildcard-Auswahl. |
| `src/services/` | Services-Baum, SQL-Editor, Benutzer-Tabelle, Tunnel-Zustand. |
| `src/settings/` | Optionen, Plugin-Einstellungen, Zoom, Wahl der Transpiler-Engine. |
| `src/shell/` | Hauptfenster, Dialoge, Menü, Toolbar. Siehe `src/shell/CLAUDE.md`. |
| `src/styles/` | Geteilte CSS (`styles/shell/` für die Shell). |
| `src/tabs/` | Editor-Tabs (`tabModel.ts`), Text-/Code-/Markdown-Tabs, DB-Browser. |
| `src/test/` | Test-Hilfen: `mockApi.ts`, `setup.ts`, Monaco-Mock, Fixtures. |
| `src/theme/` | Themes, `tokens.css`, Monaco-Einrichtung. |
| `src/tree/` | Projektbaum und sein Kontextmenü. |
| `src/windows/` | Eigene OS-Fenster (Editor, Panel, Dialog) und ihre Brücke. |
| `src/wire/` | Typen der Daten vom Backend (`types.ts`) und Pfad-Helfer. |
| `eslint.config.js` | ESLint-Regeln (zuerst als Warnung): Hooks, Datei- und Funktionslänge, `cancelled`-Flag, `navigator.clipboard`. |
| `.stylelintrc.json` | Stylelint: keine festen Farben, keine `font-size` in px (außer `theme/tokens.css`). |
| `lint-baseline.json` | Anzahl Lint-Warnungen je Regel. `npm run lint` bricht ab, wenn es mehr werden; `node ../../scripts/lint-baseline.mjs --update` schreibt neu. |
<!-- AUTO:END -->

## Zweck
React-19-Oberfläche des Designers. Läuft in Tauri. Spricht nur über `ForgeApi` mit Rust.

## Einstiegspunkte
- `src/main.tsx` wählt Hauptfenster oder Fenster mit `?window=`. `src/App.tsx` meldet Editoren (`register*Builtins`) und die Plugins an (`features/registerFeatures.ts`, wenn `plugin_list` sie meldet).
- `src/shell/Shell.tsx` ist das Hauptfenster.

## Abhängigkeiten
- Rein: `@tauri-apps/api` nur in `src/api/`, `src/windows/`, `src/chrome/`, `src/core/errorHandling.tsx`, `src/settings/zoom.ts`, `src/shell/Dialogs.tsx`. Sonst immer `ForgeApi`.
- Raus: Rust-Befehle in `app/src-tauri/src/commands/*` und `plugin_call`.

## Regeln und Fallen
- Typ-Check: `npx tsc -p tsconfig.app.json --noEmit`. Nacktes `npx tsc --noEmit` prüft nichts (`tsconfig.json` hat `files: []`).
- `*.generated.ts` nie von Hand ändern. `sheetModel.generated.ts` und `propertyDescriptions.generated.ts` kommen aus `scripts/gen-sheet-model.mjs`.
- CSS: `src/styles.css` ist nur eine `@import`-Liste, die Reihenfolge zählt (spätere gewinnen). Komponenten-CSS liegt neben der `.tsx`. Geteilte CSS in `src/styles/` und `src/styles/shell/`. Neue Datei in `styles.css` eintragen.
- Nur CSS-Variablen aus `src/theme/tokens.css`, keine festen Farben.
- Kein State-Manager. Stores im Register nutzen `useSyncExternalStore`.
- Neue Plugin-UI: `src/features/git/` als Vorlage, Anmeldung mit `registerPlugin` und `register...` aus `src/core/plugins/registry.ts`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Tauri-Befehl | Rust: `app/src-tauri/src/commands/*.rs` + `collect_commands!` in `app/src-tauri/src/bindings.rs`; UI: `src/api/ForgeApi.ts`, `src/api/tauriApi.ts`, `src/test/mockApi.ts` |
| Neuer Toolbar-Knopf eines Plugins | `registerToolbarItem` in `src/features/<plugin>/<plugin>Plugin.ts` (Vorlage: `features/git/gitPlugin.ts`). Der Befehl (`command`) wird als `registerCommand(id, run, plugin)` angemeldet (`core/plugins/registry.ts`); für Git in `features/git/GitShellBridge.tsx` aus den Handlern von `features/git/useGit.ts`. `shell/Toolbar.tsx` und `toolbarPrefs.ts` sind nur für Kern-Knöpfe. |
| Neuer Plugin-Befehl | Rust: `crates/<plugin>/src/plugin.rs` (Arm in `call`) + Logik im Crate; UI: Aufruf über `plugin_call` in `src/api/tauriApi.ts` (Git: `gitCall`), Signatur in `src/api/ForgeApi.ts`, Mock in `src/test/mockApi.ts` |
| Neuer Editor-Typ | `src/editors/<Name>Editor.tsx`, `registerEditor(typ, Komponente)` in einer `src/editors/register*Builtins.ts` (in `src/App.tsx` importiert) |
| Neuer Menüpunkt | `src/shell/menuModel.ts` plus Befehl in `src/shell/hooks/useShellCommands.ts`; für Plugins `registerMenuContribution` |
| Neue Toolbar-Taste | Plugin: `registerToolbarItem`; Kern: `src/shell/Toolbar.tsx`, `src/shell/toolbarPrefs.ts` |
| Neue Option-Seite | Plugin: `registerOptionsPage`; Kern: `src/shell/OptionsDialog.tsx` |
| Neue Maske (Dialog) | `src/core/ui/` (`defineFormDialog`, `defineListDialog`, `registerUiDialog`) |
| Neues Statusleisten-Feld | Plugin: `registerStatusBarItem`; Kern: `src/shell/coreStatusItems.ts` (Beispiel `IndexStatusItem`), Anzeige in `src/shell/StatusBar.tsx` |
| Farbe oder Theme | `src/theme/tokens.css`, `src/theme/uiTheme.ts` |

## Tests
- `npm test` (vitest run). Tests liegen als `*.test.tsx` neben den Dateien. Backend-Ersatz: `src/test/mockApi.ts`.
- Basislinie (2026-11-14): alles grün, 10 Tests übersprungen. Die vier Spec-Tests (`sheetLayout`, `menuSpec`, `toolbarSpec`, `popupSpec`) überspringen sich, wenn `E:\60_design` fehlt.
- Prüfungen: `node ../../scripts/check-encoding.mjs` (gültiges UTF-8, keine kaputten Umlaute), `npm run lint`. Quelldateien nie mit PowerShell 5.1 `Set-Content`/`Out-File` schreiben (ANSI statt UTF-8).
