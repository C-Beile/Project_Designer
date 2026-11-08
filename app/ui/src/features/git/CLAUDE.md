# git – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `index.ts` | Öffentliche Seite. Fremdcode importiert nur von hier. Exportiert auch `LazyDiffView` (lädt Monaco erst beim ersten Diff). |
| `gitPlugin.ts` | `registerGitPlugin()`: meldet Plugin, Team-Menü, Options-Seite, vier Toolbar-Knöpfe und Statusfeld an. |
| `GitStatusItem.tsx` | Branch-Knopf der Statusleiste, Branch-Popup. `registerGitStatusItem` meldet ihn an. |
| `GitOptionsPage.tsx` | Options-Seite "Team". |
| `GitDialog.tsx` | Commit-, Verlauf- und Branch-Dialog. |
| `SyncDialog.tsx` | Pull- und Push-Dialog. |
| `CommitDiffDialog.tsx` | Diff einer Datei eines Commits. |
| `DiffView.tsx` | Diff-Ansicht (Monaco). |
| `ScmPanel.tsx` | Source-Control-Panel (auch als eigenes Fenster). |
| `scmStore.ts` | Store für den Git-Stand (`useScm`, `refreshScm`, `decorationFor`, `indexOf`). |
| `commitIcons.tsx` | Kleine Icons der Commit-Dialoge. |
| `diffTitle.ts` | `diffTitle(target)`: Titel eines Diffs. |
<!-- AUTO:END -->

## Zweck
Die Git-Oberfläche. Pilot für das UI-Plugin-Muster: Der Kern kennt Git nicht, das Plugin hängt sich über `core/plugins/registry.ts` ein.

## Einstiegspunkte
- `registerGitPlugin()` wird in `src/App.tsx` aufgerufen (wenn `plugin_list` das Plugin `git` als `available` meldet, oder wenn `plugin_list` fehlschlägt) und in `src/test/setup.ts`.
- Befehle (`team.commit`, `team.pull`, `team.history` ...) meldet `shell/hooks/useShellCommands.ts` unter Plugin `git` an.
- Daten für das Statusfeld liefert `shell/Shell.tsx` als `pluginData.git`.

## Abhängigkeiten
- Rein: `core/plugins/registry`, `ForgeApi`, `wire/types`, `shell/menuModel` und `shell/icons` (nur `gitPlugin.ts`).
- Raus: `App.tsx`, `shell/Shell.tsx`, `shell/hooks/useGit.ts`, `useSave.ts`, `useFloatingWindows.ts`, `tabs/ObjectEditorArea.tsx`, `tabs/TextFileEditor.tsx`, `windows/DialogWindowApp.tsx`, `windows/FloatApp.tsx`.

## Regeln und Fallen
- Die Dialoge (`GitDialog`, `SyncDialog`, `CommitDiffDialog`) gehen heute NICHT über `registerDialog`. `Shell.tsx` und `windows/DialogWindowApp.tsx` importieren sie direkt aus `index.ts`.
- Der Kern importiert `features/git` an mehreren Stellen (Store, Dekorationen, Dialoge). Die UI ist also nicht vollständig vom Kern getrennt.
- Alles Backend läuft über `api.git*`. Kein `invoke` hier.

## Wenn du X ändern willst
So baust du ein neues UI-Plugin (Vorlage: dieser Ordner).
| Aufgabe | Datei |
|---|---|
| Ordner anlegen | `src/features/<name>/` mit `<name>Plugin.ts` und `index.ts` |
| Anmelden | In `<name>Plugin.ts`: `registerPlugin({id, name, requires, switchable})`, dann die `register...`-Aufrufe (`registerMenuContribution`, `registerOptionsPage`, `registerToolbarItem`, `registerStatusBarItem`, `registerTreeContextItem`). Alle Rückgaben sammeln und als eine Abmelde-Funktion liefern. |
| Id | Gleiche Id wie das Rust-Plugin (`plugin_list`) und im Feld `plugin` jedes Beitrags |
| Start | In `src/App.tsx` in `usePluginsReady` aufrufen, wenn `plugin_list` das Plugin meldet |
| Tests | `registerXPlugin()` in `src/test/setup.ts` |
| Befehle | `registerCommand(id, run, '<name>')` dort, wo die Handler bekannt sind (Git: `useShellCommands`) |
| Rust-Seite | `crates/<name>` und Aufruf über `plugin_call` (siehe `app/ui/CLAUDE.md`) |
| Neuer Git-Knopf | `registerToolbarItem` in `gitPlugin.ts` plus Befehl in `useShellCommands.ts` |
| Neuer Menüpunkt | `teamItems` in `gitPlugin.ts` |

## Tests
- `gitPlugin.test.tsx`, `gitMenu.test.tsx`, `scm.test.tsx`, `SyncDialog.test.tsx`. `npx vitest run src/features/git`.
- Tests, die ein leeres Register brauchen, rufen `_resetPluginRegistryForTests()`.
