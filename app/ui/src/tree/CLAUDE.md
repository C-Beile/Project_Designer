# tree – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `ProjectTree.tsx` | Projektbaum mit mehreren Wurzeln, Tastatur, Auswahl, Öffnen, Git-Badges. |
| `contextMenu.ts` | `buildTreeMenu(node, ctx)`: Einträge des Kontextmenüs. Nicht ausführbare bleiben abgeblendet mit Grund. |
| `TreeContextMenu.tsx` | Popup des Kontextmenüs (Untermenüs, Pfeiltasten). |
| `TreeDialogs.tsx` | Bestätigungen: Löschen, Einfügen mit Namen, Umbenennen. |
| `nameRules.ts` | Namensregeln des Namensdialogs (ohne Dateizugriff). |
| `treeIcons.tsx` | `NodeIcon`: eigene 16-px-Icons je Knotenart und Objekttyp. |
| `TunnelGlyph.tsx` | Tunnel-Zeichen (öffnet den Tunnel-Manager). |
| `TunnelStateIcon.tsx` | Tunnel-Zustand als Form. |
<!-- AUTO:END -->

## Zweck
Projects-Baum und sein Kontextmenü. Der Baum selbst kommt als `TreeNode` vom Backend (`wire/types`).

## Einstiegspunkte
- `ProjectTree` wird in `shell/ShellPanels.tsx` gebaut. Das Menü baut `shell/Shell.tsx` mit `buildTreeMenu` plus `useTreeContextItems`.
- Die Menü-Aktionen führt `shell/hooks/useTreeActions.ts` aus (`runTreeAction`).

## Abhängigkeiten
- Rein: `wire/types`, `core/*`, `ForgeApi`.
- Raus: `shell/`, `core/plugins/registry.ts` (Typ `MenuEntry`), `tabs/`.

## Regeln und Fallen
- Das Menü ist Daten (`MenuEntry`), die Ausführung liegt in `useTreeActions`. Eine neue Id im Menü ohne Zweig dort tut nichts.
- Das Backend wiederholt die Namensregeln und prüft zusätzlich gegen das Projekt. `nameRules.ts` ist nur die schnelle Vorprüfung.
- Farben nur aus `tokens.css` (Icon-Farben `--icon-<typ>`, `--folder-*`).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Menüeintrag für den Kern | `contextMenu.ts` plus Zweig in `shell/hooks/useTreeActions.ts` |
| Eintrag durch ein Plugin | `registerTreeContextItem` (`core/plugins/registry.ts`) |
| Regeln je Objekttyp (kopieren, umbenennen, Verwendungen) | `COPY_BLOCKED_TYPES`, `USAGE_TYPES`, `RENAME_TYPES` in `contextMenu.ts` |
| Icon eines Objekttyps | `objectIcon` in `treeIcons.tsx`, Farbe in `src/theme/tokens.css` |
| Namensregel | `nameRules.ts` und das Gegenstück in Rust |

## Tests
- `ProjectTree.test.tsx`, `contextMenu.test.tsx`. `popupSpec.test.ts` braucht Spec-Dateien unter `E:\60_design` (fehlen laut Root-`CLAUDE.md`). `npx vitest run src/tree`.
