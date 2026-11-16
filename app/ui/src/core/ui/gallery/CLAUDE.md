# gallery – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `ColorsTab.tsx` | Alle Variablen der Stylesheets mit Farbfeld und Wert im gewählten Theme. |
| `ControlsTab.tsx` | Die neuen Controls (`core/ui/controls`) in allen Zuständen. |
| `ElementsTab.tsx` | Elemente, wie die App sie heute zeichnet: native HTML-Elemente, Fortschritt, Kopieren-Knopf, Tabelle, Toasts. |
| `GalleryRow.tsx` | Zeile mit Überschrift und Elementen. |
| `IconsTab.tsx` | Toolbar-Icons, Baum-Icons je Objekttyp und Ordner (zu und offen), Projekt- und Datei-Icons. |
| `ScalesTab.tsx` | Schriftgrößen, Abstände, Radien, Icongrößen, Höhen und z-Ebenen aus den Variablen. |
| `themePreview.ts` | Themes zur Vorschau (`previewTheme`, `previewTomlTheme`), Wiederherstellen (`snapshotTheme`, `restoreTheme`) und der Sammler `collectTokens`. |
<!-- AUTO:END -->

## Zweck
Vorschau-Tabs des Theme Studios (`studio/`). Zeigen alle Elemente der App im gewählten Theme.

## Regeln
- Jeder Tab ist eine Datei. Neues Element der App: in den passenden Tab (`ElementsTab`, `ControlsTab`, `IconsTab`).
- Farben und Skalen werden aus den geladenen Stylesheets gelesen (`collectTokens`): eine neue Variable in `theme/tokens*.css` erscheint von selbst.
- Die Theme-Vorschau legt Farben nur auf `<html>`. Beim Schließen stellt `restoreTheme` den vorigen Stand her.

## Tests
- `themePreview.test.ts` (entfernt: keine), dazu `studio/ThemeStudio.test.tsx`.
