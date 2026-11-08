# editors – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `registry.ts` | `registerEditor(objectType, Komponente)`, `getEditorFor(objectType)`, Typ `EditorProps`. |
| `registerViewContextDashboardBuiltins.ts` | Meldet `neonView`, `neonContext`, `neonDashboard`, `entity` an. |
| `registerAliasDbBuiltins.ts` | Meldet `aliasDefinition` an. |
| `registerLanguageBuiltins.ts` | Meldet `language` an. |
| `registerSystemBuiltins.ts` | Meldet `system` an. |
| `registerPreferencesBuiltins.ts` | Meldet `preferences` an. |
| `registerApplicationBuiltins.ts` | Meldet `application` an. |
| `registerWebserviceBuiltins.ts` | Meldet `entityWebservice` an. |
| `registerReportBuiltins.ts` | Meldet `report` an. |
| `EntityEditor.tsx` | Entity: Provider und Consumer als Kasten, Feldtabelle. |
| `ViewCanvasEditor.tsx` | `neonView`: Layout-Liste plus Vorschau. |
| `ViewPreview.tsx` | Vorschau einer View, wie der ADITO-Client sie legt. |
| `ViewAddDialog.tsx` | "Add..." der Vorschau: Feld oder View-Verweis einfügen. |
| `ContextEditor.tsx` | `neonContext`: Titel, Entity, Views. |
| `DashboardEditor.tsx` | `neonDashboard`: Dashlets im Raster. |
| `AliasDbEditor.tsx` | `aliasDefinition`: DB-Alias mit Tabellenmodell. |
| `SystemEditor.tsx` | `system`: Liste der Alias-Configs. |
| `ApplicationEditor.tsx` | `application`: Menübaum des Web Clients. |
| `LanguageEditor.tsx` | `language`: Tabelle Modul, Key, Value. |
| `PreferencesEditor.tsx` | `preferences`: Gruppen mit Name und Wert. |
| `WebserviceEditor.tsx` | `entityWebservice`. |
| `ReportEditor.tsx` | `report`. |
| `JDitoCodeField.tsx` | Monaco-Feld für eine verknüpfte `.js`-Datei. |
| `EditableText.tsx` | Text-Zelle: Enter speichert, Escape verwirft. |
| `AppKindIcon.tsx` | Typ-Icons des Application-Editors. |
| `aliasIcons.tsx` | Icons der Alias-Config-Liste. |
| `viewSketches.tsx` | Kleine Zeichnungen der ViewTemplates. |
| `applicationFilter.ts` | Objekttypen, die der Application-Editor anbietet. |
| `applicationTree.ts` | Textbearbeitung des Menübaums (byte-treu). |
| `languageEntries.ts` | Einträge einer Sprachdatei lesen und ändern (Text). |
| `languageOps.ts` | Aktionen über ganze Sprachdateien. |
| `preferencesOps.ts` | Preferences-Änderungen am Modelltext. |
| `viewChildren.ts` | Reihenfolge der `children` einer View aus dem Text. |
| `viewFields.ts` | Text-Einfügen von Feldern und View-Verweisen. |
| `projectIndex.ts` | `ProjectIndexContext`: Namen im offenen Projekt auflösen. |
| `useIconSvgs.ts` | Lädt die Icons einer `iconId` einmal je Fenster. |
<!-- AUTO:END -->

## Zweck
Ein Editor je Objekttyp (`object_type` aus dem Baum). Die Registry ordnet Typ und Komponente zu. `tabs/ObjectEditorArea.tsx` zeigt sie im Reiter "Editor".

## Einstiegspunkte
- `registry.ts`: `getEditorFor` wird in `shell/ShellPanels.tsx` und `windows/EditorWindowApp.tsx` gelesen.
- `register*Builtins.ts`: werden einmal in `src/App.tsx` importiert (Seiteneffekt-Import). Fenster-Einstieg: `windows/EditorWindowApp.tsx`.

## Abhängigkeiten
- Rein: `ForgeApi` (nur über `EditorProps.api`), `wire/types`, `core/*`, `theme/*` (Monaco), `properties/pathVariables` und `properties/useSheetSplit`.
- Raus: `shell/ShellPanels.tsx`, `tabs/ObjectEditorArea.tsx`, `windows/EditorWindowApp.tsx`, `App.tsx`.

## Regeln und Fallen
- Typ ohne Editor ist erlaubt: `ObjectEditorArea` zeigt dann einen Hinweis. Properties und Source gehen weiter.
- Ein Editor schreibt Änderungen über `api` und gibt den neuen Baum mit `onTreeChange` zurück. Er hält keinen eigenen Projektzustand.
- Text-Ops (`languageEntries`, `applicationTree`, `viewFields` ...) ändern nur die betroffenen Zeilen. Alle anderen Bytes der `.aod` müssen gleich bleiben.
- `preferencesDescriptions.generated.ts` nie von Hand ändern. Ein Erzeuger-Skript dafür liegt in `scripts/` nicht vor (nur `gen-sheet-model.mjs`, das schreibt andere Dateien).
- Einige Kommentare nennen tote Namen (`registerBuiltins.ts`, `EntityFieldsEditor.tsx`). Es gibt sie nicht mehr.
- Jede Registrierung ist ein eigenes Modul. Vergisst man den Import in `App.tsx`, bleibt der Editor stumm.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Objekttyp, Schritt 1 | Komponente `src/editors/<Name>Editor.tsx` mit Props `EditorProps` |
| Schritt 2 | `src/editors/register<Name>Builtins.ts`: `registerEditor('<object_type>', <Name>Editor)` (oder Zeile in ein vorhandenes Modul) |
| Schritt 3 | `import './editors/register<Name>Builtins'` in `src/App.tsx` |
| Schritt 4 | Baum-Icon: Fall in `objectIcon` in `src/tree/treeIcons.tsx` (sonst Standard-Blatt), Icon-Farbe als `--icon-<typ>` in `src/theme/tokens.css` |
| Schritt 5 | Kontextmenü-Regeln des Typs in `src/tree/contextMenu.ts` (`COPY_BLOCKED_TYPES`, `USAGE_TYPES`, `RENAME_TYPES`) |
| Schritt 6 | Properties-Blatt: kommt aus `sheetModel.generated.ts` (`src/properties/CLAUDE.md`) |
| Schritt 7 | Test `src/editors/<Name>Editor.test.tsx` mit `createMockForgeApi` |
| Hilfsfunktion für Namen im Projekt | `ProjectIndexContext` in `projectIndex.ts` |
| Neue Editor-CSS | neben die `.tsx` legen und in `src/styles.css` eintragen |

## Tests
- Je Editor eine `*.test.tsx`, Text-Ops als `*.test.ts`. Backend-Ersatz: `src/test/mockApi.ts`, Beispiel-Baum `src/test/fixtures/activity_entity.tree.json`.
- Echte Dateien liest z. B. `applicationTree.test.ts` aus `crates/aod/tests/fixtures`.
- `npx vitest run src/editors`.
