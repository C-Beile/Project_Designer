# hooks – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `useProjects.ts` | Offene Projekte, aktives Projekt, Bäume, Icons, Systeme. Bekommt `{ api, projectRoot, setStatus }`, liefert `projects, trees, tree, root, activeTree, objectsByType, openProjectAt, removeProjects, reloadToken, ...`. |
| `useSelection.ts` | Was Properties, Navigator und Speichern gerade betrifft. Bekommt `tree`, liefert `selected, treeSelection, navSel, inspected, editNode, ...`. |
| `useTabs.ts` | Offene Editor-Tabs, Entwürfe, Flusher, Ungespeichert-Zustand. Liefert `tabState, handleOpen, activateNode, activateNodeRef, closeTabNow, unsaved, markUnsaved, drafts, flushers, ...`. |
| `useSave.ts` | Speichern, Undo/Redo-Ergebnis übernehmen. Liefert `applyOutcome, saveIds, registerFlush`. Setzt `saveIdsRef.current`. |
| `useNavElements.ts` | Navigator: Element zurücksetzen/aktivieren. Liefert `resetNavElement, activateNavElement, resetNavRef, activateNavRef`. Setzt `removeElementRef.current`. |
| `useExternalChanges.ts` | Änderungen von außen erkennen, Konflikt-Dialog. Liefert `resolveConflict`. |
| `useProblemScan.ts` | Projektweiter Problem-Scan. Liefert `scanning`. |
| `useOutputLogs.ts` | Zeilen der Output-Reiter (auch "IDE Log": live aus dem Event `forge://log-entry`, farbig nach Art und Bereich). Liefert `logs, appendLog, clearLog`. |
| `useDbStatus.ts` | Datenbank- und Tunnel-Status des aktiven Projekts. Liefert `db, changeDb, clearDb, tunnelState, nowTick`. |
| `useTranspile.ts` | Transpile: Engine, Fortschritt, Ergebnis, Vergleich, Abbruch. Liefert u. a. `transpile, engine, cancelBuild, commands`. |
| `useDeploy.ts` | Deploy und Build-and-Deploy. Braucht `transpile`. Liefert `startDeploy, deployOptions, deployRun, commands`. |
| `useLiquibase.ts` | Liquibase-Update mit Wahl der Verbindung. Braucht `transpile`. Liefert `runLiquibaseUpdate, connectionPick`. |
| `useRefactoring.ts` | Find Usages, Safely Delete, Rename. Liefert `startRefactoring, startRename, doRefactoring, commands`. |
| `useTreeActions.ts` | Kontextmenü des Baums, Zwischenablage, Bestätigungen, Dateioperationen, npm. Liefert `runTreeAction, ctxMenu, commands, ...`. |
| `useFloatingWindows.ts` | Panels als eigene Fenster und die Brücke dahin. Liefert `bridge, floatingViews, effectiveLayout, commands`. |
| `useDialogWindows.ts` | Dialoge des Hauptfensters als OS-Fenster (modal). Liefert nichts. Exportiert auch `keymapEntries`. |
| `useShellCommands.ts` | Befehls-Map, Menüs, Tastenkürzel. Liefert `menus, runCommand, onMenuCommand`. |
| `commandTypes.ts` | `CommandRun`, `CommandMap`, `findCommand`. |
| `backendEvent.ts` | `listenBackend(event, handler)`: Event des Backends hören, gibt die Abmeldung zurück. |
| `dialogTypes.ts` | Typ `ShellDialog` (welcher Dialog offen ist). |
| `timestamp.ts` | `timestamp()`: ISO-Zeit als Text. |
<!-- AUTO:END -->

## Zweck
Zustand und Logik des Hauptfensters, aus `Shell.tsx` ausgezogen. Jeder Hook hat ein Thema.

## Einstiegspunkte
- Alle werden in `../Shell.tsx` aufgerufen. Die Reihenfolge dort steht in `../CLAUDE.md`.
- `commands` (Typ `CommandMap`): Hooks mit Menübefehlen (`useTranspile`, `useDeploy`, `useRefactoring`, `useTreeActions`, `useFloatingWindows`) liefern ihre Map. `Shell.tsx` reicht sie als `extraCommands` an `useShellCommands`. Git-Befehle (`team.*`) gehören dem Git-Plugin (`GitShellBridge`); `useTreeActions` und `useFloatingWindows` rufen sie mit `runCommandById`.
- `backendEvent.listenBackend` wird genutzt für `forge://tunnel-progress` (`useDbStatus`), `forge://build-output` und `forge://transpile-progress` (`useTranspile`), `forge://npm-output` (`useTreeActions`), `forge://native-menu` (`Shell.tsx`).

## Abhängigkeiten
- Rein: `ForgeApi`, `core/plugins/registry`, `tabs/tabModel`, `windows/*`, `wire/types`. Die Werte anderer Hooks kommen als Parameter aus `Shell.tsx`.
- Raus: nur `../Shell.tsx`.
- Hook-zu-Hook nur über Typen: `import type { useTranspile }` (in `useShellCommands`), `import type { NavSelection }` (in `useFloatingWindows`). Kein Hook ruft einen anderen Hook direkt auf.

## Regeln und Fallen
- Zirkel vermeiden: Wenn A etwas von B braucht und B von A, lege in `Shell.tsx` ein `useRef` an und gib es beiden (Muster: `saveIdsRef`, `removeElementRef`, `activateNodeRef`, `editorWindowsRef`). Der Besitzer setzt `ref.current` in jedem Render.
- Alle Befehle stehen in `commands` ohne eigene Registrierung. Plugin-Befehle meldet das Plugin selbst im Register an.
- Neue Zustände, die ein Befehl liest, in die Abhängigkeitsliste von `runCommand` (`useShellCommands`) aufnehmen.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Hook | Datei `useXyz.ts` hier, `export interface XyzDeps` + `export function useXyz(deps)`, Aufruf in `../Shell.tsx` nach den Hooks, deren Werte er braucht |
| Neuer Menübefehl in einem Hook | `commands: CommandMap` im Hook, Eintrag in `extraCommands` in `../Shell.tsx`, Menüpunkt in `../menuModel.ts` |
| Neues Backend-Event hören | `listenBackend` in einem `useEffect` des passenden Hooks |
| Neuer Dialog-Wert | `dialogTypes.ts` |

## Tests
- Kein Test pro Hook. Sie laufen mit in `../Shell.test.tsx` und den Tests neben `../` (z. B. `newObjectRenameZip.test.tsx`).
- `npm test` in `app/ui`.
