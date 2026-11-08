# styles – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `shell/` | CSS der Shell (Dock, Menü, Tabs, Modal, Output, Status, Toast ...). Nur `.css`-Dateien. |
<!-- AUTO:END -->

## Zweck
Geteilte CSS-Dateien, die zu keiner einzelnen Komponente passen (Basis, Layout, Editor-Gruppen, Dialog-Gruppen). Die Datei, die alles zusammenbindet, ist `../styles.css`. Sie liegt eine Ebene höher.

## Einstiegspunkte
- `src/main.tsx` importiert `./styles.css`. Das ist eine reine `@import`-Liste.
- Die ersten Zeilen: `theme/tokens.css`, `styles/base.css`, `shell/Shell.css`, `chrome/TitleBar.css`, dann der Rest.

## Abhängigkeiten
- Rein: Variablen aus `src/theme/tokens.css`.
- Raus: nur `src/styles.css`.

## Regeln und Fallen
- Die Reihenfolge der `@import` in `styles.css` ist kritisch. Spätere Regeln gewinnen bei gleicher Stärke. Viele `styles/*.css` überschreiben bewusst frühere Regeln. Wer eine Datei verschiebt, ändert die Optik.
- Eine CSS-Datei, die nicht in `styles.css` steht, wird nie geladen.
- Komponenten-CSS liegt neben der `.tsx` (z. B. `editors/EntityEditor.css`) und steht ebenfalls in `styles.css`.
- Keine festen Farben. Nur Variablen aus `tokens.css`.
- Die Namen (`commit-dialog-v1.css`, `application-editor-v2.css`) zeigen Überlagerungen. Die jüngere Datei steht später in der Liste.

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neue Regel für eine Komponente | CSS neben die `.tsx` (vorhandene Datei erweitern). Neue Datei: `@import` in `src/styles.css` ans Ende der passenden Gruppe |
| Regel, die eine ältere Regel ändern soll | Nach der älteren Datei eintragen oder die ältere Regel direkt ändern (besser) |
| Regel für Dock, Menü, Tabs, Modal, Output, Status | passende Datei in `styles/shell/` |
| Allgemeine Basis (Reset, Schrift, Buttons) | `styles/base.css`, `styles/buttons.css` |
| Farbe | `src/theme/tokens.css` |
| Prüfen, ob eine CSS vergessen wurde | Jede `*.css` unter `src` muss in `src/styles.css` vorkommen |

## Tests
- Kein Test für CSS. Optik im laufenden Fenster prüfen (`cd app && npx --prefix ui tauri dev`).
