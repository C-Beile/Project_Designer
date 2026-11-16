# icons – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `icons.ts` | `ICONS`: alle Phosphor-Icons der Oberfläche (Deep-Imports, Schlüssel = Phosphor-Name in kebab-case), `IconName`, `isIconName`. Nur was hier steht, kommt ins Bundle. |
| `Icon.tsx` | `Icon` (ein Icon mit Gewicht, Größe `sm/md/lg`, Farbe), `ConfiguredIcon` (Name, Stil und Farbe aus `app/config/style.toml`), `iconColor`. |
<!-- AUTO:END -->

## Zweck
Ein Ort für alle Icons. Phosphor (`@phosphor-icons/react`, MIT). Gewicht und Farbe kommen aus `style.toml` (`config/styleConfig.ts`: `resolveIcon`).

## Regeln und Fallen
- Neues Icon: Datei `node_modules/@phosphor-icons/react/dist/csr/<PascalCase>.es.js` prüfen, Importzeile und Zeile in `ICONS` ergänzen (alphabetisch).
- Jedes Icon bringt alle 6 Gewichte ins Bundle (thin bis duotone). Darum nur benutzte Icons eintragen, nie `import * as`.
- Größe nur über `size` (Tokens `--icon-sm/md/lg`), nie Pixel.
- Farbe `text` erbt die Textfarbe (Hover, Deaktiviert, Auswahl). Feste Farben nur über Hex aus `style.toml` oder CSS-Variablen.
- Bereiche in `style.toml`: `toolbar` (Aktionen), `tree` (Typ-Icons), `control` (Pfeile, Plus, Minus, Schließen).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neues Icon verfügbar machen | `icons.ts` |
| Icon im Baum oder der Toolbar tauschen | `app/config/style.toml` (`[icon.<id>]`, `name`) |
| Alle Toolbar-Icons als Linie | `app/config/style.toml` (`[icons.toolbar]`, `style = "line"`) |
