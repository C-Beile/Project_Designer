# shell – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Shell.tsx` | Hauptfenster: ruft alle Hooks auf und verdrahtet sie. |
| `ShellPanels.tsx` | `useShellPanels`: baut Editorbereich und die vier Panels. |
| `hooks/` | Die ausgezogenen Hooks. Siehe `hooks/CLAUDE.md`. |
| `layoutState.ts` | Zustand und Speicherung des Layouts. |
| `menuModel.ts` | Hauptmenü als Daten (`buildMenus`, `TOOL_WINDOWS`, `MenuContext`). Menü "Debug" (vor Help) nur wenn `isDevBuild()`; Tests setzen `ctx.devBuild`. |
| `MenuBar.tsx` | Menüleiste mit Tastaturbedienung. |
| `Toolbar.tsx` | Werkzeugleiste, liest auch `useToolbarItems` aus dem Register. |
| `toolbarPrefs.ts` | Gruppen der Werkzeugleiste, an/aus, gespeichert. |
| `StatusBar.tsx` | Statusleiste, Plätze für Plugin-Felder. |
| `IndexStatusItem.tsx` | Feld der Statusleiste: Fortschritt des Projekt-Index (`Indexing 45%  Datei`), danach kurz `Index ready`. Klick öffnet den IDE-Log. |
| `coreStatusItems.ts` | `registerCoreStatusItems()`: Statusleisten-Beiträge des Kerns (ohne Plugin). Aufruf in `App.tsx` und `tests/support/setup.ts`. |
| `ProjectsPanel.tsx` | Kopf und Inhalt des Projects-Panels. |
| `PropertiesBody.tsx` | Inhalt des Properties-Panels je Auswahl. |
| `OutputPanel.tsx` | Output-Fenster (Unter-Reiter `database`, `build`, `default`, `nodejs`). |
| `RefactoringPanel.tsx` | Refactoring-Reiter (Find Usages, Safely Delete, Rename). |
| `TabSwitcher.tsx` | Ctrl+Tab Liste der offenen Tabs. |
| `QuickFileSearch.tsx` | Doppel-Ctrl: Dateisuche. |
| `Dialogs.tsx` | About-Dialog. |
| `OptionsDialog.tsx` | Tools > Options. |
| `LoopbackSetup.tsx` | Options > ADITO > General (nur macOS): Knopf für die Zusatzadressen 127.0.200.x der Tunnel (einmal Admin-Passwort). |
| `SshKeyPassphrase.tsx` | Options > ADITO > General, unter dem Schlüsselpfad: prüft die Datei, zeigt das Passphrase-Feld nur bei geschütztem Schlüssel, prüft und merkt sie im Schlüsselbund. |
| `PluginsDialog.tsx` | Tools > Plugins. |
| `UpdatesDialog.tsx` | Hilfe > Updates. |
| `LocalDataDialog.tsx` | Hilfe > Local Data. |
| `TableCenterDialog.tsx` | System Table Control Center. |
| `GeneralOptions.tsx` | Tools > Options > General: Abschnitte Start, Interface size, Project folders, Scan Services, Safety, Files. |
| `WorkspaceDialog.tsx` | Datei > Open Projects from Folder: ein Ordner mit allen Projekten, Häkchen bestimmen, welche im Baum stehen. |
| `NewProjectDialog.tsx` | Neues Projekt oder Klon. |
| `NewObjectDialog.tsx` | "Create New Model". |
| `TypeCombo.tsx` | Typ-Auswahl für "Create New Model". |
| `OpenModelDialog.tsx` | Datei > Open (Ctrl+O). |
| `ProjectZipDialog.tsx` | Export/Import Project als Zip. |
| `ConflictDialog.tsx` | Datei von außen geändert. |
| `DeployOptionsDialog.tsx` | Deploy, erster Dialog (Projekt, System, Optionen). |
| `DeployDialog.tsx` | Deploy-Plan mit Bestätigung. |
| `DeployDiffDialog.tsx` | Diff eines Modells beim Deploy. |
| `DeployDiffEditor.tsx` | Der Diff-Editor (Monaco) im Deploy-Diff-Dialog. |
| `SelectDatabaseConnectionDialog.tsx` | Datenbankverbindung für Liquibase wählen. |
| `TranspileProgress.tsx` | Fortschritt eines Builds. |
| `TranspileMatchDialog.tsx` | Übereinstimmung eigener Transpiler mit offiziellem. |
| `nativeGuard.tsx` | Sperrt Browser-Tasten und -Menüs im Release. |
| `icons.tsx` | Eigene Toolbar- und Panel-Icons. |
| `optionIcons.tsx` | Icons der Options-Kategorien. |
| `ThemePicker.tsx` | Options > Appearance > Theme: Galerie der Themes mit Vorschaubild. |
| `CodeFormattingPage.tsx` | Options > Appearance > Code formatting: Schrift, Größe, Zeilenabstand, Ligaturen der Code-Editoren mit Vorschau. |
| `shellHelpers.ts` | Kleine reine Helfer (`findNodeByPath`, `baseName`, `samePath`). |
| `TextAndDensity.tsx` | Options > General > Text and density: Schriftgröße, Schriftart und Dichte. Wirkt sofort über `theme/appearance.ts`. |
| `TextAndSizePage.tsx` | Options > Appearance > Text & size: Interface size (Zoom) und `TextAndDensity`. |
| `UserThemeSection.tsx` | Options > Appearance > Theme: eigene Themes wählen, Knopf für das Theme Studio. |
| `dock/` | `DockHost.tsx` (dockview: Panels andocken, stapeln, verschieben; Anordnung in `layout.dock`), `dockPlan.ts` (reine Funktion: Standard-Anordnung aus `app/config/layout.toml`), `DockHost.css` (dockview auf unsere Tokens). |
| `layouts.ts` | Voreinstellungen (`LAYOUT_PRESETS`: Default, Compact, Editor Focus) und gespeicherte Layouts des Nutzers (`[layouts.<name>]` in `designer.conf`: `saveNamedLayout`, `loadNamedLayout`, `deleteNamedLayout`). Menü: Window > Layouts. |
<!-- AUTO:END -->

## Zweck
Hauptfenster: Layout, Menü, Toolbar, Dialoge und die Hooks, die den Zustand halten. Tests: `tests/shell/*.test.tsx` (`Shell.test.tsx` fährt das ganze Fenster mit `mockApi`).

## Einstiegspunkte
- `Shell({ api, projectRoot })` in `Shell.tsx`. `groupOpenTunnels` ist dort ebenfalls exportiert.
- Befehle laufen über `runCommand` / `onMenuCommand` aus `useShellCommands`.

## Abhängigkeiten
- Rein: `ForgeApi`, `core/plugins/registry`, `tabs/`, `tree/`, `editors/`, `windows/`, `theme/`, `wire/`.
- Raus: `App.tsx` (Aufruf von `Shell`), `windows/DialogWindowApp.tsx` (nutzt Dialoge).

## Regeln und Fallen
- Reihenfolge der Hook-Aufrufe in `Shell.tsx` zählt: spätere Hooks bekommen Werte früherer. Ungefähr: `useOutputLogs`, `useProjects`, `useIndexStatus`, `useSelection`, `useDbStatus`, `useProblemScan`, `useTabs`, `useSave`, `useNavElements`, `useFloatingWindows`, `useTranspile`, `useDeploy`, `useRefactoring`, `useLiquibase`, `useTreeActions`, `useEditorWindows`, `useExternalChanges`, `useShellCommands`, `useDialogWindows`, `useShellPanels`.
- `closeProjects`, `handleTreeSelect`, `openSql`, `openProblem` bleiben in `Shell.tsx` (sie brauchen Zustand aus mehreren Hooks).
- Refs verbinden Hooks, die sich sonst im Kreis brauchen: `saveIdsRef` (Shell legt an, `useSave` setzt), `activateNodeRef` (`useTabs`), `removeElementRef` (Shell legt an, `useNavElements` setzt), `resetNavRef`/`activateNavRef` (`useNavElements`), `editorWindowsRef` (Shell setzt nach `useEditorWindows`).
- `runCommand` nutzt die Befehls-Map der letzten Render-Runde, in der sich die Abhängigkeitsliste geändert hat. Neue Zustände in die Liste eintragen, sonst ruft ein Befehl alte Werte.
- Git steckt als Shell-Beitrag im Register (`<ShellExtensions>` am Ende von `Shell.tsx`, Beitrag `GitShellBridge` des Git-Plugins): Befehle, Branch, Refresh des Standes, Statusfeld, eingebettete Dialoge. Die Shell fragt nicht "ist Git da?" (nur den Schalter `gitActive` aus Tools > Plugins).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Menüpunkt | `menuModel.ts`, Befehl in `hooks/useShellCommands.ts` (oder `commands` des passenden Hooks) |
| Toolbar-Taste | `Toolbar.tsx`, `toolbarPrefs.ts` |
| Neues Panel | `[panel.<id>]` in `app/config/layout.toml`, `PanelId` und Inhalt in `layoutState.ts` und `ShellPanels.tsx` |
| Standard-Anordnung der Panels | `app/config/layout.toml`; die Regeln stehen in `dock/dockPlan.ts` |
| Neuer Dialog des Hauptfensters | neue Datei hier, `ShellDialog` in `hooks/dialogTypes.ts`, `hooks/useDialogWindows.ts` |
| Neue Option-Kategorie | `OptionsDialog.tsx` |
| Neuer Zustand mit Logik | neuer Hook in `hooks/`, Aufruf in `Shell.tsx` |

## Tests
- `npm test` in `app/ui`. Einzeln: `npx vitest run tests/shell/Shell.test.tsx`.
- `tests/support/setup.ts` stellt `import.meta.env.DEV` auf false: Tests sehen das Menü ohne Debug.
