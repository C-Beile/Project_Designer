# shell – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Shell.tsx` | Hauptfenster: ruft alle Hooks auf und verdrahtet sie. |
| `ShellPanels.tsx` | `useShellPanels`: baut Editorbereich und die vier Panels. |
| `hooks/` | Die ausgezogenen Hooks. Siehe `hooks/CLAUDE.md`. |
| `DockLayout.tsx` | Andock-Rahmen (Projects, Properties, Editor, Navigator, Output). |
| `layoutState.ts` | Zustand und Speicherung des Layouts. |
| `menuModel.ts` | Hauptmenü als Daten (`buildMenus`, `TOOL_WINDOWS`, `MenuContext`). |
| `MenuBar.tsx` | Menüleiste mit Tastaturbedienung. |
| `Toolbar.tsx` | Werkzeugleiste, liest auch `useToolbarItems` aus dem Register. |
| `toolbarPrefs.ts` | Gruppen der Werkzeugleiste, an/aus, gespeichert. |
| `StatusBar.tsx` | Statusleiste, Plätze für Plugin-Felder. |
| `ProjectsPanel.tsx` | Kopf und Inhalt des Projects-Panels. |
| `PropertiesBody.tsx` | Inhalt des Properties-Panels je Auswahl. |
| `OutputPanel.tsx` | Output-Fenster (Unter-Reiter `database`, `build`, `default`, `nodejs`). |
| `RefactoringPanel.tsx` | Refactoring-Reiter (Find Usages, Safely Delete, Rename). |
| `TabSwitcher.tsx` | Ctrl+Tab Liste der offenen Tabs. |
| `QuickFileSearch.tsx` | Doppel-Ctrl: Dateisuche. |
| `Dialogs.tsx` | About-Dialog. |
| `OptionsDialog.tsx` | Tools > Options. |
| `PluginsDialog.tsx` | Tools > Plugins. |
| `UpdatesDialog.tsx` | Hilfe > Updates. |
| `LocalDataDialog.tsx` | Hilfe > Local Data. |
| `TableCenterDialog.tsx` | System Table Control Center. |
| `NewProjectDialog.tsx` | Neues Projekt oder Klon. |
| `NewObjectDialog.tsx` | "Create New Model". |
| `TypeCombo.tsx` | Typ-Auswahl für "Create New Model". |
| `OpenModelDialog.tsx` | Datei > Open (Ctrl+O). |
| `ProjectZipDialog.tsx` | Export/Import Project als Zip. |
| `ConflictDialog.tsx` | Datei von außen geändert. |
| `DeployOptionsDialog.tsx` | Deploy, erster Dialog (Projekt, System, Optionen). |
| `DeployDialog.tsx` | Deploy-Plan mit Bestätigung. |
| `DeployDiffDialog.tsx` | Diff eines Modells beim Deploy. |
| `SelectDatabaseConnectionDialog.tsx` | Datenbankverbindung für Liquibase wählen. |
| `TranspileProgress.tsx` | Fortschritt eines Builds. |
| `TranspileMatchDialog.tsx` | Übereinstimmung eigener Transpiler mit offiziellem. |
| `nativeGuard.tsx` | Sperrt Browser-Tasten und -Menüs im Release. |
| `icons.tsx` | Eigene Toolbar- und Panel-Icons. |
| `optionIcons.tsx` | Icons der Options-Kategorien. |
| `shellHelpers.ts` | Kleine reine Helfer (`findNodeByPath`, `baseName`, `samePath`). |
<!-- AUTO:END -->

## Zweck
Hauptfenster: Layout, Menü, Toolbar, Dialoge und die Hooks, die den Zustand halten. Tests: `*.test.tsx` neben den Dateien (`Shell.test.tsx` fährt das ganze Fenster mit `mockApi`).

## Einstiegspunkte
- `Shell({ api, projectRoot })` in `Shell.tsx`. `groupOpenTunnels` ist dort ebenfalls exportiert.
- Befehle laufen über `runCommand` / `onMenuCommand` aus `useShellCommands`.

## Abhängigkeiten
- Rein: `ForgeApi`, `core/plugins/registry`, `tabs/`, `tree/`, `editors/`, `windows/`, `theme/`, `wire/`.
- Raus: `App.tsx` (Aufruf von `Shell`), `windows/DialogWindowApp.tsx` (nutzt Dialoge).

## Regeln und Fallen
- Reihenfolge der Hook-Aufrufe in `Shell.tsx` zählt: spätere Hooks bekommen Werte früherer. Ungefähr: `useOutputLogs`, `useProjects`, `useSelection`, `useDbStatus`, `useProblemScan`, `useTabs`, `useSave`, `useNavElements`, `useGit`, `useFloatingWindows`, `useTranspile`, `useDeploy`, `useRefactoring`, `useLiquibase`, `useTreeActions`, `useEditorWindows`, `useExternalChanges`, `useShellCommands`, `useDialogWindows`, `useShellPanels`.
- `closeProjects`, `handleTreeSelect`, `openSql`, `openProblem` bleiben in `Shell.tsx` (sie brauchen Zustand aus mehreren Hooks).
- Refs verbinden Hooks, die sich sonst im Kreis brauchen: `saveIdsRef` (Shell legt an, `useSave` setzt), `activateNodeRef` (`useTabs`), `removeElementRef` (Shell legt an, `useNavElements` setzt), `resetNavRef`/`activateNavRef` (`useNavElements`), `editorWindowsRef` (Shell setzt nach `useEditorWindows`).
- `runCommand` nutzt die Befehls-Map der letzten Render-Runde, in der sich die Abhängigkeitsliste geändert hat. Neue Zustände in die Liste eintragen, sonst ruft ein Befehl alte Werte.
- Git-Befehle werden im Register unter Plugin `git` angemeldet (siehe `useShellCommands`). Der Kern fragt nicht "ist Git da?".

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Menüpunkt | `menuModel.ts`, Befehl in `hooks/useShellCommands.ts` (oder `commands` des passenden Hooks) |
| Toolbar-Taste | `Toolbar.tsx`, `toolbarPrefs.ts` |
| Neues Panel oder Layout | `layoutState.ts`, `DockLayout.tsx`, `ShellPanels.tsx` |
| Neuer Dialog des Hauptfensters | neue Datei hier, `ShellDialog` in `hooks/dialogTypes.ts`, `hooks/useDialogWindows.ts` |
| Neue Option-Kategorie | `OptionsDialog.tsx` |
| Neuer Zustand mit Logik | neuer Hook in `hooks/`, Aufruf in `Shell.tsx` |

## Tests
- `npm test` in `app/ui`. Einzeln: `npx vitest run src/shell/Shell.test.tsx`.
- `menuSpec.test.ts` und `toolbarSpec.test.tsx` brauchen Spec-Dateien unter `E:\60_design` (laut Root-`CLAUDE.md` fehlen sie).
