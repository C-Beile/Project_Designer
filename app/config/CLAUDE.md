# config – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `layout.toml` | Standard-Layout des Hauptfensters: Größe der 9 Bereiche (Breite, Höhe, Min, Max in Prozent) und Standardort jedes Panels. |
| `themes/` | Eingebaute Themes als `*.theme.toml` (`lion`, `dark`, `light`; `dark` und `light` tragen die Werte von Night Owl). Format: `app/ui/src/theme/themeSchema.ts`. |
| `style.toml` | Stil der Oberfläche: Rundung, Standard-Schriften, Zeilen- und Icon-Größen, Icon-Stil, Typ-Icons des Baums, Modul-Hinweis im Navigator, Bewegung. Überschreibt nur die Standardwerte aus `theme/tokens-primitives.css`; Nutzer-Einstellungen (`designer.conf`) gewinnen darüber. |
| `limits.toml` | Fenster-Grenzen (Popups, Editor-Fenster, Verhalten bei Überschreitung). Noch nicht in die Fenster verdrahtet. |
<!-- AUTO:END -->

## Zweck
Dev-Konfiguration als TOML: Standards, die der Entwickler ändert, ohne Code anzufassen. Wird mit der App gebaut und zur Laufzeit nur gelesen. Einstellungen der Nutzer stehen in `designer.conf`, nicht hier.

## Regeln
- Hinter jedem Schlüssel steht als Kommentar, was erlaubt ist (`a | b | c`, Bereich, Einheit). `id` und `title` brauchen keinen. Ebenso die Einzel-Icons `[icon.<name>]` in `style.toml`: dort erklärt ein Beispiel am Anfang die Werte. Ein Test (`app/ui/src/config/devConfig.test.ts`) prüft das.
- Flache Schlüssel (`width = 280`), keine Inline-Objekte.
- Jede Datei hat ein Schema im Code (`app/ui/src/config/`). Ein Tippfehler bricht den Test mit Datei, Schlüssel und erlaubten Werten.
- Neue Datei: Schema und Loader unter `app/ui/src/config/`, Eintrag hier.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Größe oder Standardort eines Panels | `layout.toml` |
| Fenster-Limit | `limits.toml` |
| Rundung, Schrift-Standard, Größen, Icon-Stil, Typ-Icons | `style.toml` |
| Farben eines eingebauten Themes | `themes/<name>.theme.toml` |
