# controls – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `Button.tsx` | `Button` mit `variant` default, primary, quiet oder bare (bare: nur die eigene `className`). Reicht `title`, `role`, `aria-*` durch und lässt Klicks nach oben weiterlaufen wie `<button>`. |
| `Checkbox.tsx` | `Checkbox` mit eigenem Kästchen. |
| `Dropdown.tsx` | `Dropdown`: Auswahlliste ohne sichtbares Label (Ersatz für `<select>`), Optionen als `{ id, label }`, `onChange(value)`. |
| `Input.tsx` | `Input`: Eingabefeld ohne Label (Text, Zahl, Kästchen), nimmt alle `<input>`-Eigenschaften. |
| `TextArea.tsx` | `TextArea`: mehrzeiliges Eingabefeld. |
| `Table.tsx` | `Table`, `TableHeader`, `TableColumn`, `TableBody`, `TableRow`, `TableCell`: Tabelle auf React Aria (echte `<table>`-Elemente, Rolle `grid`). Genau eine Spalte je Tabelle ist `isRowHeader`. |
| `index.ts` | Sammel-Export der Controls. |
| `Select.tsx` | `Select` mit Popover und Liste, Optionen als `{ id, label }`. |
| `TextField.tsx` | `TextField` mit Label, Hinweis und Fehlertext. |
| `Tabs.tsx` | `Tabs` mit Tab-Leiste und Inhalten, übergeben als `tabs: { id, label, content }[]`. |
| `Slider.tsx` | `Slider` mit Label, Wert und Einheit (`unit`), Bereich über `minValue`/`maxValue`. |
<!-- AUTO:END -->

## Zweck
Basis-Bausteine auf React Aria Components, gestylt nur mit Tokens. Einziger Ort, an dem `react-aria-components` importiert wird.

## Regeln
- Eine Komponente pro Datei, feste Klasse `ui-Name` (im DevTools-Inspektor findest du so die Datei).
- Varianten als Union (`variant: 'primary'`), keine Boolean-Ketten.
- Stil in `controls.css`: nur `var(--…)` aus `theme/tokens*.css`.
- Neue Control: Datei, Export in `index.ts`, Zeile in `core/ui/gallery/ControlsTab.tsx` (Theme Studio).

## Tests
- `studio/ThemeStudio.test.tsx` fährt die Controls durch.
