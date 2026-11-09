# tabs – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `tabModel.ts` | Reiter-Zustand als reine Funktionen (`openTab`, `subTabsFor`, `isFileNode`, `tunnelTabNode` ...). |
| `ObjectEditorArea.tsx` | Inhalt des aktiven Reiters: Unter-Reiter (Editor, Users, Source, History) und die passende Ansicht. |
| `EditorTabBar.tsx` | Reiterleiste mit Überlauf-Menü. |
| `SourceEditor.tsx` | Unter-Reiter Source: rohe `.aod`, Änderungen gehen ans Backend. |
| `HistoryView.tsx` | Unter-Reiter History: Git-Log einer Datei. |
| `TextFileEditor.tsx` | Editor einer einfachen Projektdatei (Entwürfe in `drafts`). |
| `MonacoText.tsx` | Monaco-Textfeld für Source und Dateien. |
| `MarkdownPreview.tsx` | Markdown als HTML (`marked`, bereinigt mit DOMPurify). |
| `AliasConfigTab.tsx` | Reiter einer Alias-Config eines Systems. |
| `DbBrowserTab.tsx` | Reiter "Database" eines DB-Alias (Katalog, Tabellen, Spalten). |
| `dbBrowserSql.ts` | SQL und Texte des DB-Browsers (nur lesend). |
| `TunnelConfigEditor.tsx` | Tabelle der Tunnel einer Tunnel-Config, Connect je Zeile. |
| `TunnelPorts.tsx` | Tunnel-Manager: Ziele nach Dienst gruppiert. |
<!-- AUTO:END -->

## Zweck
Die Reiter des Editorbereichs: Zustand (`tabModel.ts`) und was ein Reiter zeigt.

## Einstiegspunkte
- `ObjectEditorArea` wird in `shell/ShellPanels.tsx` und `windows/EditorWindowApp.tsx` gebaut. Es bekommt den Editor aus `editors/registry`.
- `EditorTabBar` zeigt die Leiste. Der Zustand lebt in `shell/hooks/useTabs.ts`.

## Abhängigkeiten
- Rein: `editors/registry` (Typ), `core/scm` (`useScm`), `core/plugins/registry` (Diff-Ansicht `git.diffView` per `useDialog`), `services/SqlEditor` (lazy), `theme/*` (Monaco), `ForgeApi`.
- Raus: `shell/`, `windows/`, `properties/codeSave.ts` (`tabModel`), `windows/protocol.ts` (`SubTab`).

## Regeln und Fallen
- Ein Reiter je Datei. `EditorTab.id` ist der Dateipfad, auch wenn der Baum die Datei zweimal zeigt.
- Virtuelle Reiter ohne Datei (`kind` `service`, `tunnel`, `aliasconfig`) haben nur den Unter-Reiter `editor`. `node.path` trägt dann den Verweis als Text.
- Nur ein `system` hat den Unter-Reiter `users` (`subTabsFor`).
- Schwere Ansichten (`SourceEditor`, `SqlEditor`, `TextFileEditor`, `TunnelConfigEditor`) lädt `ObjectEditorArea` mit `lazy`. Monaco kommt erst dann.
- `tabModel.ts` bleibt rein (kein React), damit es ohne Rendern testbar ist.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Unter-Reiter | `SubTab` und `SUB_TAB_LABELS` in `tabModel.ts`, `subTabsFor`, Anzeige in `ObjectEditorArea.tsx` |
| Neue Art virtueller Reiter | `isServiceNode` in `tabModel.ts`, Zweig in `ObjectEditorArea.tsx` |
| Reihenfolge, Aktivierung beim Schließen | `tabModel.ts` |
| Editor eines Objekttyps | `src/editors/CLAUDE.md` |

## Tests
- `tabModel.test.ts`, `EditorTabBar.test.tsx`, `DbBrowser.test.tsx`, `Tunnel*.test.tsx`, `CodeTab.test.tsx`. `npx vitest run src/tabs`.
