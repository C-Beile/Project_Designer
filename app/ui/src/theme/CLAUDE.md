# theme – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `useTheme.ts` | `useTheme()`: setzt `data-theme` auf `<html>`, speichert die Wahl. Typ `ThemeName`: `dark`, `light`, `lion`. |
| `uiTheme.ts` | Macht aus einem importierten VS-Code-Theme CSS-Tokens für die ganze Oberfläche. |
| `vscodeTheme.ts` | Liest eine VS-Code-Theme-Datei in Monaco-Daten. |
| `customThemes.ts` | Importierte Themes, je Nutzer in `localStorage`. |
| `monacoTheme.ts` | Monaco-Themes passend zu den drei Paletten. |
| `editorPrefs.ts` | Ansicht-Schalter der Code-Editoren (Zeilennummern, Leerzeichen ...). |
| `monacoWorkers.ts` | Web-Worker für Monaco (Editor, TypeScript). |
| `monacoJdito.ts` | JDito-Unterstützung: Typen, Hover, Fehler. |
| `monacoAdito.ts` | ADITO-Vervollständigung in Zeichenketten. |
| `aditoIntel.ts` | Reine Regeln dazu, was in welchem Aufruf stehen darf. |
| `monacoImports.ts` | Strg+Klick auf einen Import öffnet die Datei. |
| `monacoLanguages.ts` | Farben für Punkt-Dateien (`.gitignore` ...). |
| `monacoActions.ts` | Menübefehle auf dem fokussierten Code-Editor. |
| `monacoUuid.ts` | Menü "Generate": UUID einfügen. |
| `formatOnSave.ts` | Editoren melden sich an, damit Speichern vorher formatieren kann. |
<!-- AUTO:END -->

## Zweck
Farben der Oberfläche und Einrichtung des Monaco-Editors. Die Paletten stehen in `tokens.css` (in diesem Ordner, hier nicht in der Tabelle).

## Einstiegspunkte
- `tokens.css`: wird als Erstes in `src/styles.css` importiert.
- `useTheme()`: Hauptfenster und `windows/WindowRoot.tsx` (liest dieselbe Speicherung).
- Monaco: `monacoWorkers.ts` und `monacoTheme.ts` laden die Editoren beim ersten Gebrauch.

## Abhängigkeiten
- Rein: `monaco-editor`, `settings/options` (Farbthema), `wire/types`.
- Raus: `editors/`, `tabs/`, `shell/`, `windows/`.

## Regeln und Fallen
- Themes: Night Owl (`dark`, Standard), Light (`light`), "Lion in der City" (`lion`). In `tokens.css`: `:root` ist dunkel, dazu `:root[data-theme='light']` und `:root[data-theme='lion']`. Eine neue Variable muss in allen drei Blöcken sinnvoll sein.
- Neue UI nutzt nur CSS-Variablen, keine festen Farben. Neue Farbe: Variable in `tokens.css` anlegen und in jedem Theme setzen.
- Monaco hat eine eigene Theme-Engine. Sie liest `tokens.css` nicht. Farben für Code stehen in `monacoTheme.ts`.
- Light ist laut Kommentar in `useTheme.ts` noch nicht endgültig bestätigt.
- Speicher (`localStorage`) kann fehlen. Alle Module fangen das ab.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Farbe | `tokens.css` (alle Themes) |
| Neues Theme | `ThemeName` und `THEME_LABELS` in `useTheme.ts`, Block `:root[data-theme='…']` in `tokens.css`, Monaco-Theme in `monacoTheme.ts` |
| Importierte Themes färben die Oberfläche | `TOKEN_SOURCES` in `uiTheme.ts` |
| Neuer Editor-Schalter | `EditorPrefs` in `editorPrefs.ts`, Anzeige in `shell/OptionsDialog.tsx` |
| JDito- oder ADITO-Vervollständigung | `monacoJdito.ts`, `monacoAdito.ts`, `aditoIntel.ts` |

## Tests
- `uiTheme.test.ts`, `vscodeTheme.test.ts`, `aditoIntel.test.ts`, `monacoImports.test.ts`, `monacoWorkers.test.ts`. Monaco-Ersatz: `src/test/monacoMock.ts`. `npx vitest run src/theme`.
