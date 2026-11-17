# studio – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `ColorEditor.tsx` | Ein Farbfeld je Schlüssel (`ColorField`), gruppiert, mit wirksamem oder geerbtem Wert. |
| `importedTheme.ts` | Importierte VS-Code-Themes als Liste für das Theme Studio (Art `imported`). |
| `registerThemeStudio.tsx` | Meldet Tools > Theme Studio an (Befehl, Menü, Shell-Beitrag) und öffnet das Fenster (`openThemeStudioWindow`). |
| `ThemeStudio.tsx` | Das Studio: Zustand (Auswahl, Text, Vorschau), Editor links, Vorschau-Tabs rechts. |
| `StudioToolbar.tsx` | Kopf mit Theme-Auswahl, Reload und Ordner, dazu die Knopfleiste (Speichern, Kopie, Löschen, Use as my theme). |
| `useThemeActions.ts` | `createThemeActions`: die Aktionen des Studios (speichern, Kopie, löschen, neu lesen, aktiv setzen) und `currentSourceId`. |
| `themeText.ts` | Reine Helfer: `setKeyInText`, `themeFileName`, `retitleTheme`, `groupKeys`, `toColorInput`. |
| `CodePreview.tsx` | Tab Code: JavaScript und SQL in echten Monaco-Editoren mit den Code-Farben des Themes. |
| `StudioDiagnostics.tsx` | Meldung, wenn eine Theme-Datei nicht lesbar ist, und Warnungen des Parsers. Der Text selbst bleibt unsichtbar. |
| `studioFields.ts` | Baut die Farbfelder: `interfaceFields` (Oberfläche) und `codeFields` (Editor und Syntax) mit eigenem und geerbtem Wert. |
<!-- AUTO:END -->

## Zweck
Theme Studio (Tools > Theme Studio, eigenes Fenster `themestudio`): Themes ansehen, bearbeiten, speichern und mit allen Elementen der App vergleichen. Links die Farbfelder in zwei Ansichten (Interface und Code), rechts die Vorschau-Tabs aus `core/ui/gallery` plus ein Tab mit echten Code-Editoren. Der TOML-Text bleibt unsichtbar. Jede Änderung wirkt sofort auf die Seite, gespeichert wird erst mit Save.

## Regeln
- Eingebaute Themes (`app/config/themes`) sind nur als Kopie speicherbar. `dark` und `light` sind noch CSS und nur zum Ansehen.
- Nutzer-Themes liegen als `*.theme.toml` im Ordner `themes` des App-Datenordners (Rust: `commands/themes.rs`). Aktiv wird eines mit "Use as my theme" (`[appearance] userTheme`).
- `setKeyInText` ändert nur den Wert und lässt Kommentare stehen.
- Beim Schließen stellt `restoreTheme` den vorigen Stand her.
- Die Ansicht Code ändert `[editor]` und `[editor.syntax]` der Datei. Der Tab Code zeigt JavaScript und SQL in Monaco mit diesen Farben (`theme/editorTheme.ts`).
- Offen: Config-Tab für `layout.toml`/`limits.toml`, Farben für weitere Sprachen (JSON, Markdown, Git-Dateien).

## Tests
- `themeText.test.ts`, `ThemeStudio.test.tsx`. `npx vitest run tests/studio`.
