# theme – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `useTheme.ts` | `useTheme()`: setzt `data-theme` auf `<html>`, speichert die Wahl. Typ `ThemeName`: `dark`, `light`, `lion`. |
| `uiTheme.ts` | Macht aus einem importierten VS-Code-Theme CSS-Tokens für die ganze Oberfläche. |
| `vscodeTheme.ts` | Liest eine VS-Code-Theme-Datei in Monaco-Daten. |
| `customThemes.ts` | Importierte Themes, gespeichert in `designer.conf` (`configGet`/`configSet`). |
| `workbenchColors.ts` | Leitet fehlende Fensterfarben aus den Editorfarben ab (für TextMate-Themes). |
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
| `appearance.ts` | Wendet `[appearance]` aus `designer.conf` an: `fontSize` (setzt die Wurzelgröße, 1rem = 16px bei 12), `fontFamily`, `density`. Aufruf in `main.tsx`. |
| `builtinThemes.ts` | Eingebaute TOML-Themes aus `app/config/themes/` als Text (`BUILTIN_THEME_TEXTS`) und geparst (`BUILTIN_TOML_THEMES`). |
| `themeSchema.ts` | Liste aller Theme-Schlüssel (`surface.base` usw.) mit CSS-Variable. Was hier fehlt, ist intern und im Theme nicht setzbar. |
| `editorTheme.ts` | Code-Farben des aktiven TOML-Themes (, ): Store,  legt sie über ein eingebautes Monaco-Theme.  liest sie. |
| `themeToml.ts` | `parseTheme`: liest eine `.theme.toml` (Verweise mit `@`, Warnungen, WCAG-Kontrast). `applyThemeTokens` setzt die Farben auf `<html>`. |
| `themeStore.ts` | Themes des Nutzers: Liste, `loadUserThemes` (liest den Ordner über `ForgeApi`), Neu-Lesen beim Fokus, `subscribeThemes`. |
| `editorTheme.ts` | Code-Farben des aktiven TOML-Themes (`[editor]`, `[editor.syntax]`): Store und `mergeEditorTheme`, das sie über ein eingebautes Monaco-Theme legt. `monacoTheme.ts` liest sie. |
| `appearanceSettings.ts` | `registerAppearanceSettings()`: Textgröße, Schrift und Dichte als Einstellungen (Seite `appearance.text`) für `SchemaForm`. Aufruf in `main.tsx`. |
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
- Neues Theme-Format: `*.theme.toml` mit eigenen Namen (`surface`, `text`, `border`, `accent`, `state`, `selection`, `button.primary`). Plan: `docs/ui-refactor-plan.md`, Abschnitt Theme-Format. Heute kommt nur Lion aus TOML; `useTheme` legt die Farben über `data-theme`. Night Owl und Light folgen am Schluss. Ein Test hält die TOML-Farben von Lion gleich mit `tokens.css`.
- `tokens-primitives.css`: Skalen für Abstand, Schrift, Radius, Icons, z-Ebenen, Dichte (alles rem). Neue UI nutzt diese Variablen.
- Standard-Theme ist während des Umbaus Lion (`useTheme.ts`). Ein eigenes Theme des Nutzers (`[appearance] userTheme`, Datei aus `themeStore`) liegt über der Wahl.
- Themes: Night Owl (`dark`), Light (`light`), "Lion in der City" (`lion`). In `tokens.css`: `:root` ist dunkel, dazu `:root[data-theme='light']` und `:root[data-theme='lion']`. Eine neue Variable muss in allen drei Blöcken sinnvoll sein.
- Neue UI nutzt nur CSS-Variablen, keine festen Farben. Neue Farbe: Variable in `tokens.css` anlegen und in jedem Theme setzen.
- Monaco hat eine eigene Theme-Engine. Sie liest `tokens.css` nicht. Farben für Code stehen in `monacoTheme.ts`.
- Light ist laut Kommentar in `useTheme.ts` noch nicht endgültig bestätigt.
- Gespeichert wird über `settings/appConfig.ts` (`designer.conf`), kein `localStorage`.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Farbe | `tokens.css` (alle Themes) |
| Neues Theme | `ThemeName` und `THEME_LABELS` in `useTheme.ts`, Block `:root[data-theme='…']` in `tokens.css`, Monaco-Theme in `monacoTheme.ts` |
| Importierte Themes färben die Oberfläche | `TOKEN_SOURCES` in `uiTheme.ts` |
| Neuer Editor-Schalter | `EditorPrefs` in `editorPrefs.ts`, Anzeige in `shell/OptionsDialog.tsx` |
| JDito- oder ADITO-Vervollständigung | `monacoJdito.ts`, `monacoAdito.ts`, `aditoIntel.ts` |

## Tests
- `uiTheme.test.ts`, `vscodeTheme.test.ts`, `lion.test.tsx`, `aditoIntel.test.ts`, `monacoImports.test.ts`, `monacoWorkers.test.ts`, `themeToml.test.ts`, `appearance.test.ts`. Monaco-Ersatz: `src/test/monacoMock.ts`. `npx vitest run src/theme`.
