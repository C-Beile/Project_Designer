# properties – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `PropertySheetPanel.tsx` | Das Properties-Panel: Eigenschaften eines Objekts bearbeiten. Enthält auch `ProjectPropertiesPanel`. |
| `sheetLayout.ts` | `layoutSheet`: ordnet Zeilen in Tabs und Kategorien nach dem Sheet-Modell. |
| `FilePropertiesPanel.tsx` | Eigenschaften einer einfachen Datei. |
| `AliasConfigPanel.tsx` | Sheet einer Alias-Config. |
| `configSections.ts` | Abschnittsbaum der Config `_____CONFIGURATION` und Zeilen je Abschnitt. |
| `IconCombo.tsx` | Auswahlliste für eine Icon-Eigenschaft. |
| `IconPicker.tsx` | Icon-Chooser (Vaadin und Neon). |
| `WildcardPicker.tsx` | Auswahl mit Suchmuster (`*` als Joker). |
| `codeSave.ts` | Speichern des Code-Reiters einer Eigenschaft (Datei plus Verweis). |
| `objectRoot.ts` | `%aditoprj%` einer Objektdatei, Pfad einer verknüpften Datei. |
| `pathVariables.ts` | `$PROJECTHOME` und Co. in `aditoHomePath`/`aditoDataPath` auflösen. |
| `useSheetSplit.ts` | Position des Teilers zwischen Name und Wert, pro Ort gemerkt. |
<!-- AUTO:END -->

## Zweck
Properties-Panel und was dazugehört. Zeilen und Werte kommen vom Backend. Das Sheet-Modell (Tabs, Kategorien, welche Eigenschaft wohin) kommt aus erzeugten Dateien.

## Einstiegspunkte
- `PropertySheetPanel` zeigen `shell/` (Properties-Panel) und `windows/FloatApp.tsx` (schwebendes Panel).
- `layoutSheet(sheet, lang, descriptions)` in `sheetLayout.ts` baut die Ansicht.

## Abhängigkeiten
- Rein: `ForgeApi`, `wire/types`, `core/*`, `tabs/tabModel` (`codeSave`).
- Raus: `shell/`, `windows/`, `editors/` (`pathVariables`, `useSheetSplit`).

## Regeln und Fallen
- `*.generated.ts` NIE von Hand ändern.
  - `sheetModel.generated.ts` und `propertyDescriptions.generated.ts` schreibt `scripts/gen-sheet-model.mjs`.
  - `configDescriptions.generated.ts` (und `editors/preferencesDescriptions.generated.ts`): Erzeuger-Skript nicht im Repo gefunden. `gen-sheet-model.mjs` schreibt sie nicht.
- Das Skript liest `60_design/designer_gui/sheet_model.json` und `properties.json`. Der Pfad ist `../../../60_design` vom Ordner `scripts/` aus, hier also `E:\60_design\designer_gui`. Der Ordner fehlt auf diesem Rechner. Ohne ihn kann man nicht neu erzeugen. Aufruf: `node scripts/gen-sheet-model.mjs`.
- `propertyDescriptions.generated.ts` lädt `PropertySheetPanel` per `import()` nach (groß).
- Module-Objekte werden nie selbst geändert (`codeSave.ts`): Das Skript wird eine Änderung des offenen Projekts.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Sheet-Aufbau (Tabs, Gruppen) für einen Typ | Spezifikation unter `60_design`, dann Skript neu laufen lassen. `sheetLayout.ts` nur für die Logik. |
| Zeilenverhalten, Menü einer Zeile | `PropertySheetPanel.tsx` (`rowMenuEntries`) |
| Config-Abschnitt | `configSections.ts` |
| Pfadvariable | `pathVariables.ts` |
| Neue Wertauswahl | neue Komponente nach Vorbild `IconCombo.tsx` oder `WildcardPicker.tsx` |

## Tests
- `PropertySheetPanel.test.tsx`, `sheetLayout.test.tsx` (kann `60_design` brauchen, laut Root-`CLAUDE.md` fehlt es), `configSections.test.tsx`, `codeSave.test.ts` u. a. `npx vitest run src/properties`.
