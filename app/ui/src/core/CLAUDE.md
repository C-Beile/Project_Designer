# core – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Modal.tsx` | Rahmen für jeden Dialog (Titel, Inhalt, Fußzeile, Enter). Im OS-Fenster füllt er das Fenster. |
| `dialogService.tsx` | `confirmDialog`, `promptDialog`, `choiceDialog` als Promise. `DialogHost` zeigt sie und die Masken. |
| `notifications.tsx` | `notify(text, opts)`: Toast ohne Fokusraub. `ToastHost` zeigt ihn. Liste für den Notifications-Reiter. |
| `openFileBus.ts` | `openFileInDesigner(path)`: "Open File" aus einem eigenen Fenster (Commit-Fenster) öffnet die Datei im Hauptfenster. |
| `outputBus.ts` | `logOutput(sub, text)` schreibt ins Output-Fenster. `requestShell` für kleine Bitten an die Shell. SQL-Maskierung. |
| `shortcuts.ts` | Kürzel als `Mod+Shift+S` schreiben, anzeigen (`formatShortcut`) und prüfen (`matchesShortcut`). |
| `errorText.ts` | `errorText(e)`: Fehler als Text. |
| `clipboard.ts` | `copyText(text)`: kopiert in die Zwischenablage (mit Rückfall). Für alles, was kopiert. |
| `errorLog.ts` | `logError(text)` schreibt ins Protokoll; `main.tsx` setzt die Senke. `notify(kind:'error')` ruft es auf. |
| `errorHandling.tsx` | `ErrorBoundary` (Absturz eines Editors), `CrashListener` (schreibt ins Logfile). |
| `treeIndex.ts` | Suchen im Projektbaum: `collectByType`, `findObject`, `entityOfView`, `collectIcons`. |
| `revealApp.ts` | `revealApp()`: blendet die Seite erst nach zwei Frames ein (setzt `data-ready` auf `<html>`), damit kein ungestyltes Zwischenbild aufblitzt. |
| `uuid.ts` | `newUuid`, `copyNewUuid`. |
| `indexStatus.ts` | Store für den Stand des Projekt-Index je Projekt (`useIndexStatus`, `applyIndexProgress`, `summarizeIndex`). Ignoriert alte Generationen. Nicht `projectIndex` nennen: `editors/projectIndex.ts` meint etwas anderes. |
| `scm.ts` | Neutraler Store für den Source-Control-Stand: `useScm`, `refreshScm`, `decorationFor`, `indexOf`, `setScmProvider`. Ohne Plugin leer. |
| `plugins/` | `registry.ts`: UI-Register für Plugins. `ShellExtensions.tsx` rendert die Shell-Beiträge. |
| `ui/` | Masken-Baukasten: FormDialog, ListDialog, DataTable, ProgressBar, `CopyButton` (Kopieren-Knopf mit grünem Haken), `uiDialogs`. |
<!-- AUTO:END -->

## Zweck
Gemeinsame Bausteine ohne Fachlogik. Hauptfenster und alle OS-Fenster nutzen sie.

## Einstiegspunkte
- `DialogHost` und `ToastHost` hängen in `shell/Shell.tsx`, `windows/EditorWindowApp.tsx`, `windows/FloatApp.tsx`. `windows/DialogWindowApp.tsx` hat nur `DialogHost`.
- `plugins/registry.ts` (Plugin-Beiträge) und `ui/index.ts` (Masken).

## Abhängigkeiten
- Rein: fast nichts. Ausnahmen: `errorHandling` (`ForgeApi`, `chrome/tauriWindow`), `outputBus` (Typen aus `shell/OutputPanel`), `plugins/registry` (Typen aus `shell/menuModel`, `shell/hooks/dialogTypes`, `tree/contextMenu`), `scm` (`ForgeApi`, Typen).
- Raus: fast jeder Ordner.

## Regeln und Fallen
- Plugin-Beiträge sind abgesichert: wirft `items(ctx)` eines Menübeitrags oder `state(ctx)` eines Toolbar-Knopfs, fällt nur dieser Beitrag weg bzw. wird abgeblendet (`readMenu`, `toolbarItemState` in `plugins/registry.ts`), einmal im Protokoll. Fehlerschirm und Absturz-Dialog haben "Copy details" (`errorHandling.tsx`).
- Module halten Zustand auf Modulebene (Listener-Sets, `useSyncExternalStore`). Jedes Fenster hat sein eigenes Modul. Ein Toast im Hauptfenster erscheint nicht in einem Editor-Fenster.
- Kein `window.confirm`. Nimm `confirmDialog`. Gleicher Text, solange offen, ergibt nur einen Dialog.
- Tests leeren den Zustand mit `_reset...ForTests()`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Ja/Nein-Frage, Texteingabe, Auswahl aus Knöpfen | `dialogService.tsx` (`confirmDialog`, `promptDialog`, `choiceDialog`) |
| Meldung ohne Unterbrechung | `notify` in `notifications.tsx` |
| Zeile ins Output-Fenster | `logOutput` in `outputBus.ts` |
| Neues Kürzel formatieren | `shortcuts.ts` |
| Plugin-Beitrag, Maske | siehe unten |

### plugins/registry.ts
Alle Register sind Stores. `register*` gibt eine Abmelde-Funktion zurück. Ein Beitrag mit `plugin` zählt nur, wenn das Plugin und seine `requires` angemeldet sind.
- `registerPlugin(info)`: Plugin anmelden. `isPluginAvailable(id)` fragt, `usePlugins()` liest.
- `registerCommand(id, run, plugin?)`: Befehl. `hasCommand`, `runCommandById`, `runCommandAsync` führen ihn aus.
- `registerMenuContribution({menu, items, order})`: Einträge im Hauptmenü. Lesen: `useMenuContributions`, `getMenuContributions`.
- Debug-Menü (nur Dev-Build, `isDevBuild()` in `shell/menuModel.ts`): ein Plugin hängt sich mit `registerMenuContribution({ menu: 'debug', order, items })` ein und meldet den Befehl mit `registerCommand`. Der Kern bringt `debug.rebuildIndex` und `debug.dumpIndex` mit.
- `registerOptionsPage({id, category, title, component})`: Seite in Tools > Options. Lesen: `useOptionsPages`.
- `registerToolbarItem({id, group, command, state})`: Knopf der Werkzeugleiste. Lesen: `useToolbarItems(group)`.
- `registerStatusBarItem({id, align, component})`: Feld der Statusleiste. Lesen: `useStatusBarItems(align)`.
- `registerTreeContextItem({objectTypes, label, command})`: Eintrag im Baum-Kontextmenü. Lesen: `useTreeContextItems(objectType)`.
- `registerDialog({id, plugin, component})`: Dialog oder Panel per Id (Props sind Sache des Plugins). Lesen: `getDialog(id)`, reaktiv `useDialog(id)`.
- `registerShellExtension({id, plugin, order, component})`: unsichtbare Komponente, die `ShellExtensions` in der Shell rendert. Sie bekommt `ShellExtensionContext` (`api`, `root`, `dialog`, `setDialog`, `setReloadToken`, `handleOpen`, `isPluginActive` ...). Lesen: `useShellExtensions()`.
- `setPluginData(plugin, data)`: Daten für das Statusleisten-Feld des Plugins. Lesen: `usePluginData()`.

### scm.ts
Der Kern liest den Stand (Baum-Farben, Tabs, Speichern). Das SCM-Plugin sagt mit `setScmProvider`, woher er kommt. Ohne Provider tut `refreshScm` nichts.

### ui/ – welche Maske wann
- `FormDialog`: wenige Felder (text, number, select, checkbox) mit Prüfung. Wirft `onSubmit`, bleibt er offen.
- `ListDialog`: aus einer Liste wählen, einzeln oder mehrfach, mit Suche.
- `DataTable`: Tabelle mit Sortierung und Auswahl, ohne eigenen Dialog.
- `ProgressBar`: Fortschritt, mit oder ohne Prozent.
- `CopyButton`: überall, wo ein Text kopiert wird (`text` als String oder Funktion, `label`). Zeigt nach dem Klick einen grünen Haken mit Animation. Nicht selbst `navigator.clipboard` aufrufen: `copyText` aus `core/clipboard.ts` nutzen.
- `uiDialogs.tsx`: Masken als Daten. `defineFormDialog`/`defineListDialog` beschreiben, `registerUiDialog(id, spec, plugin)` meldet an, `openUiDialog(spec oder id)` öffnet. `UiDialogHost` hängt in `DialogHost`.
- Große Dialoge mit eigenem Layout bleiben normale Komponenten mit `Modal` (siehe `shell/`).

## Tests
- `*.test.tsx` neben den Dateien, z. B. `plugins/registry.test.tsx`. `npx vitest run src/core`.
