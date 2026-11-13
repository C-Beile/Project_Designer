# git – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `index.ts` | Öffentliche Seite: nur `registerGitPlugin`. |
| `gitPlugin.ts` | `registerGitPlugin()`: meldet Plugin, Team-Menü, Options-Seite, vier Toolbar-Knöpfe, Statusfeld, SCM-Quelle, Dialoge/Panels und den Shell-Beitrag an. |
| `GitShellBridge.tsx` | Shell-Beitrag: hält `useGit`, Branch, Refresh des Standes, meldet `team.*` an, füllt das Statusfeld, zeigt die eingebetteten Dialoge. |
| `useGit.ts` | Team-Menü: Commit-, Sync-, Verlaufs-Dialoge, Pull/Push, Diff-Tab, Branch-Wechsel. |
| `GitWindows.tsx` | Inhalt der Git- und Pull/Push-OS-Fenster (`GitWindow`, `SyncWindow`). |
| `LazyDiffView.ts` | `DiffView` als `lazy` (Monaco erst beim ersten Diff). |
| `GitStatusItem.tsx` | Branch-Knopf der Statusleiste, Branch-Popup. `registerGitStatusItem` meldet ihn an. |
| `GitOptionsPage.tsx` | Options-Seite "Team". |
| `GitDialog.tsx` | Commit-, Verlauf- und Branch-Dialog. |
| `SyncDialog.tsx` | Pull- und Push-Dialog. |
| `PullResultDialog.tsx` | Was ein Pull gebracht hat: neue Commits mit Autor und Zeit, Dateien je Commit. Öffnet über "Show changes" in der Meldung. |
| `RepoLinkDialog.tsx` | Team > Git > Repository...: zeigt `origin`, setzt die URL oder verbindet einen Ordner ohne Repo (init, fetch, Branch übernehmen). Befehl `team.repository`, Dialog-Id `git.repoLink`. |
| `GitLoginDialog.tsx` | Anmelde-Dialog (Benutzer + Token) für https-Remotes; ersetzt das Fenster des Git Credential Managers. Dialog-Id `git.login`, Handler in `gitPlugin.ts` (`setGitAuthHandler`). |
| `CommitDiffDialog.tsx` | Diff einer Datei eines Commits. |
| `DiffView.tsx` | Diff-Ansicht (Monaco). |
| `ScmPanel.tsx` | Source-Control-Panel (auch als eigenes Fenster). |
| `commitIcons.tsx` | Kleine Icons der Commit-Dialoge. |
| `diffTitle.ts` | `diffTitle(target)`: Titel eines Diffs. |
<!-- AUTO:END -->

## Zweck
Die Git-Oberfläche. Pilot für das UI-Plugin-Muster: Der Kern kennt Git nicht, das Plugin hängt sich über `core/plugins/registry.ts` ein.

## Einstiegspunkte
- `registerGitPlugin()` wird in `src/App.tsx` aufgerufen (wenn `plugin_list` das Plugin `git` als `available` meldet, oder wenn `plugin_list` fehlschlägt) und in `src/test/setup.ts`.
- Befehle (`team.commit`, `team.pull`, `team.history`, `git.openDiff` ...) meldet `GitShellBridge` selbst unter Plugin `git` an. Der Kern ruft sie mit `runCommandById`.
- Das Statusfeld bekommt seine Daten von `GitShellBridge` über `setPluginData('git', ...)`.
- Register-Ids: Dialoge `git.window`, `git.syncWindow`, `git.commitDiff`; Panels `git.scmPanel`, `git.diffView`; Shell-Beitrag `git.shell`. Der Kern holt sie mit `getDialog`/`useDialog`.
- Der Store für den Stand liegt im Kern (`core/scm.ts`). `registerGitPlugin` setzt die Quelle (`setScmProvider`: `api.scmStatus`); ohne Plugin bleibt der Store leer.

## Abhängigkeiten
- Rein: `core/plugins/registry`, `core/scm`, `ForgeApi`, `wire/types`, `windows/useOsDialog`, `shell/menuModel`, `shell/icons`, `shell/hooks/commandTypes` und `dialogTypes`.
- Raus: nur über das Register. Von außen importiert `test/setup.ts` den Ordner; `features/registerFeatures.ts` (für `App.tsx` und `windows/WindowRoot.tsx`) ruft `registerGitPlugin` auf.

## Regeln und Fallen
- Kleine Reste im Kern: `gitActive` (Plugin-Schalter) in `Shell.tsx`, Menü-Kontext und Toolbar; die Dialog-Namen `'git'`/`'sync'` in `ShellDialog` (`shell/hooks/dialogTypes.ts`); `styles.css` bindet die Git-CSS ein (Reihenfolge zählt).
- Alles Backend läuft über `api.git*`. Kein `invoke` hier.

## Wenn du X ändern willst
So baust du ein neues UI-Plugin (Vorlage: dieser Ordner).
| Aufgabe | Datei |
|---|---|
| Ordner anlegen | `src/features/<name>/` mit `<name>Plugin.ts` und `index.ts` |
| Anmelden | In `<name>Plugin.ts`: `registerPlugin({id, name, requires, switchable})`, dann die `register...`-Aufrufe (`registerMenuContribution`, `registerOptionsPage`, `registerToolbarItem`, `registerStatusBarItem`, `registerTreeContextItem`). Alle Rückgaben sammeln und als eine Abmelde-Funktion liefern. |
| Id | Gleiche Id wie das Rust-Plugin (`plugin_list`) und im Feld `plugin` jedes Beitrags |
| Start | In `src/features/registerFeatures.ts` in `FEATURES` eintragen (läuft in `App.tsx` und in jedem OS-Fenster) |
| Tests | `registerXPlugin()` in `src/test/setup.ts` |
| Befehle und Zustand | Shell-Beitrag mit `registerShellExtension` (Vorlage: `GitShellBridge.tsx`); dort `registerCommand(id, run, '<name>')`. Statusfeld-Daten mit `setPluginData`. |
| Rust-Seite | `crates/<name>` und Aufruf über `plugin_call` (siehe `app/ui/CLAUDE.md`) |
| Neuer Git-Knopf | `registerToolbarItem` in `gitPlugin.ts` plus Befehl in `useGit.ts` (`commands`) |
| Neuer Menüpunkt | `teamItems` in `gitPlugin.ts` |

## Tests
- `gitPlugin.test.tsx`, `gitMenu.test.tsx`, `scm.test.tsx`, `SyncDialog.test.tsx`, `GitDialog.test.tsx`, `shellWithoutGit.test.tsx` (Shell ohne und mit Plugin). `npx vitest run src/features/git`.
- Tests, die ein leeres Register brauchen, rufen `_resetPluginRegistryForTests()`.
