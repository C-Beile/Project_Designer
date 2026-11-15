# UI-Refactor Plan (app/ui)

Stand: 2026-11-14. Phasen 0 bis 7 sind in der Grundform umgesetzt, Phase 8 als Pilot. Was offen ist, steht unten im Fortschritt.

## Fortschritt

- Phase 0 umgesetzt (2026-11-14): `scripts/check-encoding.mjs`, `.editorconfig`, ESLint und Stylelint mit `lint-baseline.json` (in CI), Golden-Test fürs Hauptmenü, Spec-Tests überspringen sich ohne `E:\60_design`, rote Tests repariert, Karten korrigiert. Mess-Basislinie für Performance fehlt noch (braucht den "Perf Snapshot" aus Phase 6).

- Phase 1 teilweise (2026-11-14): `theme/tokens-primitives.css` (Skalen), `theme/appearance.ts` (Schriftgröße, Schriftart, Dichte aus `[appearance]`, Options > General > Text and density). Bestehendes CSS nutzt noch feste px, nur Basistext und neue Bausteine folgen der Größe.
- Phase 1b teilweise: TOML-Theme-Format (`themeSchema.ts`, `themeToml.ts`), Lion als `lion.theme.toml` und Standard-Theme der Umbauzeit. Offen: interne Tokens als TOML, VS-Code-Konverter, Monaco-Teil (`[editor]`), Theme-Ordner mit Live-Neuladen, Farben-Editor aus dem Schema, Night Owl und Light.
- Dev-Config: `app/config/layout.toml` und `limits.toml` mit Schema, Test und Kommentar-Regel. `defaultLayout()` liest die Größen aus `layout.toml`. `limits.toml` ist noch nicht verdrahtet (Phase 7).
- Phase 2 Anfang: React Aria (`react-aria-components`), Controls `Button`, `TextField`, `Checkbox`, `Select` in `core/ui/controls/`, Debug > UI Gallery.
- Theme Studio (2026-11-14): Tools > Theme Studio, eigenes Fenster. Links Farbfelder oder TOML-Text, rechts Vorschau-Tabs (Colours, Scales, Controls, Elements, Icons), jede Änderung wirkt sofort. Reload, Ordner öffnen, Speichern, Kopie, Löschen, "Use as my theme". Rust: `commands/themes.rs` (Nutzer-Ordner `themes`). Options > Appearance hat die Seiten Theme (mit "Your themes"), Text & size, Colours, Fonts (nur Editor-Schrift). Lion ist das Standard-Theme. Offen: Monaco-Editor mit TOML-Sprache und Fehlerzeilen, Config-Tab für `layout.toml`/`limits.toml`, `[editor]`-Teil, VS-Code-Konverter, Colours-Seite auf Schema-Namen, Datei-Watcher statt Reload beim Fokus.
- Theme Studio (2026-11-14): Tools > Theme Studio, eigenes Fenster. Links Farbfelder oder TOML-Text, rechts Vorschau-Tabs (Colours, Scales, Controls, Elements, Icons), jede Änderung wirkt sofort. Reload, Ordner öffnen, Speichern, Kopie, Löschen, "Use as my theme". Rust: `commands/themes.rs` (Nutzer-Ordner `themes`). Options > Appearance hat die Seiten Theme (mit "Your themes"), Text & size, Colours, Fonts (nur Editor-Schrift). Lion ist das Standard-Theme. Offen: Monaco-Editor mit TOML-Sprache und Fehlerzeilen, Config-Tab für `layout.toml`/`limits.toml`, `[editor]`-Teil, VS-Code-Konverter, Colours-Seite auf Schema-Namen, Datei-Watcher statt Reload beim Fokus.
- Options > Appearance aufgeräumt (2026-11-14): nur noch Theme (Auswahl und eigene Themes), Text & size und Code formatting. Die alte Seite Colours und die Farb-Überschreibungen (`colorOverrides`) sind entfernt, das Studio ersetzt sie. Gespeicherte `[appearance.colors]` werden ignoriert.
- Code-Farben (2026-11-14): Das Theme-Format hat `[editor]` (7 Farben) und `[editor.syntax]` (11 Token-Farben). Lion trägt sie. Das Studio hat die Ansicht Code (Farbfelder) und den Tab Code (JavaScript und SQL in Monaco, live). Der TOML-Text ist im Studio nicht sichtbar. Offen: weitere Sprachen.
- Phase 3a (2026-11-14): `core/store.ts` (`createStore`), `core/contrib/contextKeys.ts` (Kontext-Schlüssel mit `when`), `core/contrib/keybindings.ts` (`registerKeybinding`, `commandForKey`). `useShellCommands` führt eingetragene Kürzel aus, wenn kein Menüpunkt passt, und setzt `hasProject` und `dialogOpen`. Das alte Menü (`menuModel.ts`) blieb unverändert (Golden-Test); Phase 3b (Menü auf `useMenu`) ist offen.
- Phase 4 Teil (2026-11-14): `core/contrib/settings.ts` (`registerSetting`: bool, text, int, enum; Wert in `designer.conf`, Standard wird nie gespeichert), `core/ui/blocks/SchemaForm.tsx`, neue Control `Slider`. Pilot: Options > Appearance > Text & size ist jetzt ein `SchemaForm` (`theme/appearanceSettings.ts`). Offen: `PropertyGrid` für `PropertySheetPanel` (762 Zeilen, Spec-Tests brauchen `E:/60_design`), `PreferencesEditor`, restliche Options-Seiten.
- Phase 4b (2026-11-14): dockview (`dockview-react` 8.9.0, fest gepinnt) ersetzt `DockLayout.tsx`. `shell/dock/dockPlan.ts` (reine Funktion, getestet) leitet die Standard-Anordnung aus `layout.toml` ab, `DockHost.tsx` ist die Hülle, das Gitter steht in `layout.dock` (gespeichert in `[layout]`). Panels andocken, stapeln und verschieben per Drag and Drop, Schließen über das X des Reiters, Menü "Window" öffnet wieder. Entfallen: Minimieren-Streifen (alter Modus `minimized` gilt als zu), Tastatur-Splitter. Offen: benannte Layouts und Voreinstellungen (Kompakt, Editor-Fokus), `reopen = last-position` (Panel kommt heute an den Standardplatz), `registerPanel` für Plugins, Tastaturbedienung der Trennlinien (WCAG 2.5.7 Alternative: Menübefehle), Prüfen von Ziehen und Docken in der laufenden App (im Test nicht möglich, der Drag im Browser-Tool löst kein HTML5-Dragging aus).
- Phase 5 (2026-11-14): `core/hooks/useResource.ts` (`useResource(load, deps, tags)`, `invalidateResources(tag)`). `useExternalChanges` ruft `invalidateResources('project')` bei `forge://project-changed`. Umgestellt: `DiffView`, `CommitDiffDialog`, `PreferencesEditor` (Alias-Namen). Noch ca. 50 Stellen mit `let cancelled = false` (ESLint zählt sie in der Basislinie).
- Phase 6 Teil (2026-11-14): `WindowRoot` und `DialogWindowApp` laden Fenster und Dialoge per `lazyNamed`; die Einstiegsdatei ist 281 kB groß (89,8 kB gzip), jeder Dialog ein eigener Chunk (z. B. Options 45 kB). Editoren melden sich nur im Editor-Fenster an (`registerAllBuiltins.ts`). Debug > Perf Snapshot (`core/perf/`) kopiert Marken, JS-Speicher, DOM-Größe als JSON. Offen: Messreihe vorher/nachher (Basislinie fehlt), React Compiler, Virtualisierung des Baums, Monaco-Vorladen nach Messung.
- Phase 7 (2026-11-14): `limits.toml` ist verdrahtet. Rust `window_open` zählt (`maxPopups` für float und dialog, `maxEditors` für Editor-Fenster) und meldet `window-limit`. Die UI öffnet Dialoge eingebettet, wenn `osPopupsAvailable()` false ist, und blendet "Move to New Window" aus, wenn `osEditorWindowAvailable()` false ist. Der Schlüssel `over-limit` entfiel (nur "embed" ist umgesetzt). Schwebende Panels zählt Rust mit, die UI weiß davon nicht voraus (Toast "Too many windows").
- Phase 8 (2026-11-14, fertig): tauri-specta 2.0.0-rc.29 (specta rc.28, specta-typescript 0.0.15, alle fest gepinnt). **Alle** Tauri-Befehle (106) stehen in `bindings.rs` (`collect_commands!`); der zweite Handler (`generate_handler!`, Weiche `TYPED_COMMANDS`) ist weg. Der Debug-Start schreibt `app/ui/src/api/bindings.ts`, `api/tauriApi.ts` ruft nur noch `commands.*` auf. Fallen: specta verbietet `usize`/`u64`/`i64` (Feld mit `#[specta(type = u32)]` oder `i32` auf `number` setzen) und kann `serde_json::Value` nicht schreiben (Hülle `commands::Json`, wird `any`). Beim Umstellen fiel auf: `maxPopups`/`maxEditors` kamen in camelCase an, Rust erwartet aber `max_popups`/`max_editors`, die Fenster-Grenze wirkte also nie; jetzt behoben. `plugin_call` bleibt ein loser Befehl (E9), typisiert wird in TypeScript je Plugin (`pluginCall`, `gitCall`).
- Nachtrag (2026-11-14, später): Window > Reset Panel Layout (neuer Wert `layout.reset` baut das Gitter neu) und Window > Layouts (Voreinstellungen Default, Compact, Editor Focus; eigene Layouts speichern, laden, löschen). `reopen = "last-position"` gilt für Panels, die mit anderen im selben Reiterstapel lagen (nur solange das Fenster läuft). Night Owl und Light sind jetzt TOML-Themes (`dark.theme.toml`, `light.theme.toml`, Werte aus `tokens.css` und den Monaco-Themes); das Studio zeigt alle drei gleich. tauri-specta: 13 Befehle typisiert (Themes, Datei-Dialoge, Log, Ordner öffnen). Noch ca. 45 Stellen mit `let cancelled = false`.
- Abschluss-Runde (2026-11-14, spät):
  - **PropertyGrid (4):** `core/ui/blocks/PropertyGrid.tsx` ist die Tabelle (Gruppen, Zeilen, Einklappen, Auswahl, Menü, Trenner). Was in der Wertspalte steht, kommt aus dem Register `core/contrib/fieldEditors.ts` (`registerFieldEditor`, `registerFieldAction`); die eingebauten Editoren stehen in `properties/fieldEditors.tsx`. `PropertySheetPanel` schrumpfte um rund 300 Zeilen, `ProjectPropertiesPanel` nutzt dieselbe Tabelle. Neue Property-Darstellung = 1 Aufruf.
  - **registerPanel (4b):** `core/contrib/panels.ts`. Plugin-Panels erscheinen im Dock-Gitter, lassen sich verschieben wie die eingebauten und haben einen Menüpunkt in Window. Ihr Zustand bleibt gespeichert.
  - **Tastatur (4b):** Window > Configure Window > Make Active Panel Wider/Narrower/Taller/Shorter ersetzt das Ziehen der Trennlinie (WCAG 2.5.7).
  - **Menü als Daten (3b):** `registerMainMenu({ id, label, mnemonic, order, items, when })` in `shell/menuModel.ts`. Alle Hauptmenüs und das Debug-Menü sind Einträge dieser Tabelle; der Golden-Test blieb unverändert.
  - **useResource:** weitere Stellen umgestellt (`FilePropertiesPanel`, `IconCombo`, `IconPicker`, `HistoryView`, `UsersTable`, `ServicesTree`, `PullResultDialog`, `GitShellBridge`). (Alle weiteren Stellen folgten später mit `useAbortableEffect`.)
  - **ESLint-Regeln gegen Rückfall:** rohe `button`, `input`, `select`, `textarea`, `table` und Importe von `react-aria-components` oder `dockview-react` außerhalb ihrer Ordner sind Warnungen mit Basislinie (rund 580). Die Basislinie wurde für die neuen Regeln einmal neu gesetzt; sie darf nicht wachsen.
  - **Messung:** `scripts/measure-bundle.mjs` (Einstieg 278,7 kB roh, 88,6 kB gzip; `App` 568 kB; `ThemeStudio` 230 kB; `OptionsDialog` 44 kB). Laufzeitwerte: Debug > Perf Snapshot.
  - **E9 entschieden (und umgesetzt):** `plugin_call` bleibt ein loser Befehl. Typisiert wird auf der TypeScript-Seite je Plugin (Vorlage `gitCall` in `api/tauriApi.ts`); ein Enum je Plugin lohnt den Aufwand nicht.
- **Umstellung auf die Controls (2026-11-14, fertig):** Alle rohen `button`, `input`, `textarea`, `select` und `table` in den Features sind ersetzt (ESLint meldet 0). Neue Controls: `Input`, `TextArea`, `Dropdown` (Ersatz für `select`), `Table` mit `TableHeader/Column/Body/Row/Cell`; `Button` hat die Variante `bare` und reicht `title`, `role`, `aria-*` durch, Klicks laufen wie bei `<button>` nach oben weiter. Bei der Tabelle fiel auf: React Aria liest Tippen in einem Feld als Buchstabensuche (Typeahead) und springt weg, darum ignoriert `Table` Tasten aus Eingabefeldern; ein Kopf mit Zustand zeichnet sich verzögert neu (`DataTable`: Schlüssel am Kästchen). Alle `let cancelled = false` sind weg: `useResource` oder neu `useAbortableEffect` (`core/hooks`, Signal statt Flag). Zwischenablage nur über `core/clipboard.ts`. Tests: `test/dropdown.ts` (`choose`, `selected`) für die Auswahllisten, Tabellen haben die Rolle `grid`. **Nicht gemacht, bewusst später:** `ProjectTree` auf RAC `Tree` (eigene Virtualisierung für tausende Zeilen, Tipp-Suche und Lazy-Laden; der Umbau braucht einen Test in der laufenden App) und die Aufteilung der großen Dateien (ESLint `max-lines`, Basislinie). Nichts davon ist in der laufenden App geprüft.

## Ziele

1. Weniger Code, keine Duplikate.
2. Data-driven: Menüs, Toolbar, Properties, Formulare, Einstellungen und Tasten kommen aus Registern. Pakete hängen sich per Einstiegspunkt ein.
3. Ein Design-System: Tokens, feste Skalen, Schrift und Größe einstellbar, Standards (WCAG 2.2 AA).
4. Von Hand gut änderbar (siehe "Handarbeit").
5. Performance, RAM, Reload: Pflicht, mit Messpunkten.

## Festgelegt

- Verhalten kommt von **React Aria Components**. Nur in `core/ui/controls/` importieren.
- Bestehendes Design bleibt grob. Keine Designs von AditoHub.
- **tauri-specta** wird eingeplant und genutzt. Keine Abstimmung mit Clemens nötig (Lion hat freie Hand).
- Popups als eigene Fenster sind erlaubt, **maximal 3 gleichzeitig**.
- Eigener Lade-Hook statt TanStack Query.
- Farb-Token-Namen bleiben (Vertrag mit `uiTheme.ts` und `colorOverrides.ts`).

## Befunde (belegt)

- Umlaute: Dateien sind gültiges UTF-8. Nur PowerShell 5.1 zeigt sie falsch an. Gefahr: Agenten, die mit `Set-Content` schreiben.
- `core/plugins/registry.ts`: gute Basis, aber verdrehte Schichten (Kern importiert aus `shell/`), Git im Kern-Kontext, Befehle ohne Titel/Kürzel, zwei `CommandRun`-Typen, Kürzel hängen am Menü.
- Debug-Menü des Kerns ist fest in `buildMenus` verdrahtet, nicht über das Register.
- 217 `font-size` in px, feste Zeilenhöhe 19 px in `ProjectTree` und `NavigatorPanel`, z-index ohne Ordnung (1 bis 3000).
- 54 mal `let cancelled = false` in 43 Dateien. Ca. 13 handgebaute Stores.
- `WindowRoot` und `DialogWindowApp` importieren alles statisch. Jedes Popup lädt fast die ganze UI.
- Kein ESLint, Stylelint oder `.editorconfig`.
- Kein Fenster-Limit. Rust fokussiert nur doppelte Fenster.

## Architektur

Schichten, Importe nur nach unten:

1. Tokens (`theme/tokens/*.css`)
2. Controls (`core/ui/controls/*`)
3. Data-driven (`core/contrib/*` Register, `core/ui/blocks/*` Renderer)
4. Hooks (`core/hooks/*`)
5. Features (`shell`, `editors`, `properties`, `services`, `features/*`)

Neue Ordner: `theme/tokens/`, `core/store.ts`, `core/ui/controls/`, `core/ui/blocks/`, `core/contrib/`, `core/hooks/`, `core/icons/`. Jeder bekommt eine `CLAUDE.md`-Karte.

### Einstiegspunkte

- `ContextKeys` (erweiterbar per declaration merging), `setContextKey`, `useContextKey`.
- `registerCommand(CommandSpec)`: id, title, icon, `enabled(k)`, `checked(k)`, `run`.
- `registerKeybinding(KeybindingSpec)`: command, key, `when(k)`, `native`.
- `registerSubmenu`, `registerMenuItem` auf einer `MenuId` (Hauptmenü, Toolbar, Kontextmenüs, Zeilenmenü sind nur andere Ids). `useMenu(id)`.
- `registerSetting`, `registerSettingsPage`, `useSetting(path, fallback)`.
- `registerFieldEditor('kind' | 'name:<id>', Component)`, `registerFieldAction`, `registerSchemaExtension`.
- Neuer Menüpunkt = 2 Aufrufe. Neue Einstellung = 1 Aufruf. Neue Property = 1 `FieldSpec`.
- Plugin-Abschaltung bleibt: ohne `registerPlugin` fallen alle Beiträge mit `plugin: 'x'` weg.

### Schemas

- `SchemaSpec`: Gruppen und `FieldSpec[]` (kind, label, group, options, readOnly mit Grund, validate, actions).
- `FieldSource`: `get`, `isSet`, `set`, `reset`. Die Schreib-Logik (Modification, byte-treue Text-Ops) bleibt unverändert hier.
- Ein Renderer, zwei Layouts: `PropertyGrid` (Name | Wert) und `SchemaForm` (Label + Feld).
- Sonderfälle (Icon, Bild, Config-Pfad, Tunnel-Stift) werden Register-Einträge, der Tunnel-Stift gehört dem Plugin `ssh-tunnel`.

### Tokens

- 4px-Raster, rem-basiert. Wurzel `calc(16px * var(--ui-font-size) / 12)`, Standard 12 = 16px.
- Schrift: 10, 11, 12, 13, 14, 18 (xs bis 2xl). Zeilenhöhe 16/20/24. Radius 2/4/6 px. Icons 12/16/20.
- z-Ebenen: base 0, sticky 10, dropdown 100, overlay 200, modal 300, menu 400, toast 500, tooltip 600, drag 700.
- Dichte normal/kompakt: `--control-h` 24/20, `--row-h` 24/20.
- Einstellung in `designer.conf` `[appearance]`: `fontFamily`, `fontSize`, `density`, `zoom`. Angewendet in `theme/appearance.ts` vor dem ersten Render, in allen Fenstern.
- `useRowHeight()` liest `--row-h` für Virtualisierung.
- Motion mit `prefers-reduced-motion`. Fokusring nur `:focus-visible`.

### Theme-Format (Phase 1b)

- Ein Theme ist eine TOML-Datei (`*.theme.toml`) mit unseren Kategorien: `[theme]`, `[surface]`, `[text]`, `[border]`, `[accent]`, `[state]`, `[selection]`, `[button.primary]`, `[editor]`, `[editor.syntax]`, `[type]`. `kind = "dark" | "light"`. Light und Dark sind getrennte Themes.
- Schlüssel `kategorie.name` ergibt genau ein CSS-Token (`surface.raised` wird `--surface-raised`). Optional `extends = "builtin:dark"`, Verweise mit `"@accent.primary"` (Zyklen verboten). Kontrast-Warnungen nach WCAG AA beim Laden.
- **Zwei Ebenen:**
  - *Theme-Schema* (`themeSchema.ts`): die Tokens, die ein Nutzer in einem Theme setzen darf. Jeder Eintrag hat Kategorie, Name, Beschreibung, Pflicht/Optional.
  - *Interne Tokens* (`theme/tokens/internal.toml`, vom Entwickler gepflegt): Ordnerfarben, Objekt-Icon-Farben, Diagramm- und Markenfarben, Grundelemente. Nicht in Themes setzbar. Sie sind pro `kind` (dark/light) definiert und dürfen sich per `color-mix` von Theme-Tokens ableiten.
- **Reihenfolge der Themes (entschieden):** Während des Umbaus gibt es nur ein Theme, "Lion in der City" als Standard und Orientierung. Es wird als erstes `.theme.toml` gebaut. Night Owl, Night Owl Light und der Rest folgen **am Schluss**. Bis dahin bleiben die alten `tokens.css`-Blöcke für die anderen Themes unangetastet oder werden ausgeblendet. Der Token-Test (jeder Schlüssel in allen Themes) läuft erst, wenn alle drei fertig sind.
- **Startregel (entschieden):** Alles ist zuerst intern. Nutzer-frei sind nur `surface`, `text`, `border`, `accent`, `state`, `selection`, `button`, `editor`, `type`. Einzelne Schlüssel werden später bei Bedarf freigegeben (Freigeben ist leicht, Sperren bricht fremde Themes).
- Ein Theme, das einen internen Schlüssel setzt, bekommt eine Warnung und der Wert wird ignoriert.
- Der Loader erzeugt aus Theme plus internen Tokens die CSS-Variablen und das Monaco-Theme. Eingebaute Themes (`night-owl`, `night-owl-light`, `lion`) sind `.theme.toml` im Programm.
- Nutzer-Themes: `%LOCALAPPDATA%\DitoDesigner\themes\*.theme.toml`, Ordner wird beobachtet (Live-Neuladen). Auswahl: `[appearance] theme`. Feinanpassungen: `[appearance.overrides]` mit denselben Namen, nur erlaubte (Theme-)Schlüssel.
- VS-Code-Importer: Einweg-Konverter VS-Code-JSON zu `.theme.toml`, mit einer Zuordnungstabelle (ersetzt `TOKEN_SOURCES`). Ergebnis wird danach von Hand gepflegt.
- Keine Migration alter Daten (`localStorage`, alte Farb-Overrides werden ignoriert).
- Brand-Farben bleiben feste Konstanten im Code.

### Layout-Engine (Docking, 9-Slice)

- Das Hauptfenster ist ein **Docking-Layout** wie im Unity-Editor und im ADITO Designer: 9 Bereiche (oben-links, oben, oben-rechts, links, Mitte, rechts, unten-links, unten, unten-rechts). Die Mitte ist der Editor-Bereich. Jeder Bereich kann mehrere Panels als Tabs enthalten und beliebig geteilt werden.
- Panels lassen sich frei verschieben, per Drag and Drop an jeden Bereich andocken, als Tab stapeln, schwebend lösen und per Splitter in der Größe ändern.
- **Panel-Register** (neuer Einstiegspunkt): `registerPanel({ id, title, icon, defaultArea, defaultSize, when, component, plugin })`. Plugins melden eigene Panels an, wie bei Menüs. Standard-Belegung: Projects links-oben, Properties links-unten, Editor Mitte, Navigator rechts-oben, Output unten.
- **Layout ist Daten**: ein JSON-Baum (Bereiche, Gruppen, Größen, aktive Tabs, schwebende Panels). Gespeichert in `designer.conf` `[layout]`. Es gibt Voreinstellungen (Default, Kompakt, Editor-Fokus), "Layout zurücksetzen" und benannte Layouts des Nutzers.
- **Bibliothek statt Eigenbau (Empfehlung):** `dockview` (React, ohne Abhängigkeiten, Docking, schwebende Gruppen, Serialisierung nach JSON) hinter einer eigenen Hülle `core/ui/blocks/DockHost`. Vor dem Festlegen in Phase 4b prüfen: Drag-Verhalten, Tastatur-Bedienung, Gestaltbarkeit mit unseren Tokens, RAM, Wartungsstand. Alternative: FlexLayout. Der heutige `shell/DockLayout.tsx` (269 Zeilen, feste Anordnung) wird dadurch ersetzt.
- **Verhältnis zum Fenster-Limit:** Schwebende Panels innerhalb des Fensters (Docking-Bibliothek) kosten kein OS-Fenster und zählen nicht. Herausgelöste OS-Fenster laufen weiter über `windowService` und zählen zum Limit 3. Die Bibliothek darf selbst keine Fenster öffnen.
- Panel-Zustand (Scroll, Auswahl) liegt im View-State-Store je Panel-Id, damit Verschieben nichts verliert.

#### Größen und Bildschirmauflösung

- Die Werte in `layout.toml` sind **CSS-Pixel** (geräteunabhängig). Windows-Skalierung (125 %, 150 %, 200 %) rechnet WebView2 selbst um. 280 px sind auf 4K mit 200 % physisch gleich groß wie auf Full-HD mit 100 %.
- Das eigentliche Risiko sind verschieden große **Fenster und logische Bildschirme** (z. B. 1366×768 gegen 3440×1440) und die einstellbare UI-Schrift.
- Regeln:
  1. Config-Pixel gelten bei Standard-Schriftgröße. Zur Laufzeit werden sie mit dem UI-Faktor (`fontSize / 12`) multipliziert. Größere UI-Schrift gibt größere Panels.
  2. Jeder Bereich hat zusätzlich eine Obergrenze in Prozent des Fensters (`max-width-percent`, `max-height-percent`, Standard z. B. 40). Ein Panel wird nie größer als das.
  3. Das **gespeicherte Nutzer-Layout** hält Anteile (Bruchteile der Fensterbreite/-höhe), nicht feste Pixel. Beim Laden wird auf das aktuelle Fenster umgerechnet und an Min und Max geklemmt.
  4. Beim Verkleinern des Fensters schrumpft zuerst die Mitte (Editor). Seitenpanels bleiben bis zu ihrem Minimum stehen, danach klappen sie zu (nicht überlappen).
  5. Wechsel auf einen Monitor mit anderer Skalierung: neu klemmen. Die Fensterlage merkt sich pro Bildschirm schon `window_state.rs`.
- Test: Layout-Berechnung als reine Funktion mit Tests für 1366×768, 1920×1080 und 3440×1440, jeweils mit UI-Faktor 0.8, 1 und 1.5. Dazu Sichtprüfung auf dem echten Monitor.
- Offen: ob dockview Anteile selbst speichert oder Pixel. Wenn Pixel, rechnet unsere Hülle `DockHost` beim Speichern und Laden um. Das prüfen wir am Anfang von Phase 4b.

### Dev-Konfiguration (TOML statt Code)

- Prinzip: Dinge, die man als Entwickler ändern will, stehen in TOML-Dateien und nicht im Code. Das Projekt ist stark KI-gebaut, niemand lernt Rust. Config ist der sichere Weg.
- **Ein Ordner `app/config/`** für alle Dev-Konfigurationen. Wird mit der App ausgeliefert (zur Bauzeit eingelesen, zur Laufzeit nur lesbar). Neues Potenzial = neue Datei dort, mit eigenem Schema.
- Abgrenzung: `app/config/*.toml` = Standard des Entwicklers. `designer.conf` = Einstellungen des Nutzers. Reihenfolge beim Laden: Dev-Standard, dann Nutzer darüber.
- Jede Datei hat ein Schema im Code. Ein Test lädt alle Dateien und schlägt bei Tippfehlern, unbekannten Schlüsseln oder fehlenden Pflichtwerten fehl. Fehlermeldung nennt Datei, Schlüssel und erlaubte Werte.
- Der Ordner bekommt eine `CLAUDE.md`-Karte (Datei, Zweck, Beispiel, "Wenn du X ändern willst").
- Erste Dateien:
  - `layout.toml`: Standard-Panels und ihre Bereiche (siehe unten).
  - `theme-internal.toml`: interne Tokens (ersetzt `theme/tokens/internal.toml` im Theme-Format).
  - `limits.toml`: Fenster-Limit (Popups 3, Editor-Fenster 3), Cache-Größen u. Ä.
  - Später bei Bedarf: `shortcuts.toml` (Standard-Kürzel), `menus.toml` (Reihenfolge und Gruppen), `defaults.toml` (Standardwerte der Einstellungen).

#### `layout.toml` (Panel-Standards)

```toml
[areas]                          # Bereichsnamen: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right

[area.left]
width              = 280   # Pixel bei Standard-Schrift, 0 = automatisch
min-width          = 160   # Pixel
max-width-percent  = 40    # Prozent der Fensterbreite, 10 bis 80
height             = 0     # Pixel, 0 = volle Höhe
min-height         = 100   # Pixel
max-height-percent = 100   # Prozent der Fensterhöhe, 10 bis 100

[area.bottom]
width      = 0             # Pixel, 0 = volle Breite
height     = 220           # Pixel, 0 = automatisch
min-height = 100           # Pixel

# top-left, top, top-right, right, bottom-left, bottom-right: gleiche Schlüssel,
# 0 = automatisch (Ecken übernehmen Breite der Spalte und Höhe der Zeile)

[panel.projects]
title    = "Projects"
area     = "left"          # top-left | top | top-right | left | center | right | bottom-left | bottom | bottom-right
group    = "left-top"      # gleiche Gruppe = Tabs
opens    = "startup"       # startup | on-demand
closable = true            # true | false

[panel.properties]
title    = "Properties"
area     = "left"
group    = "left-bottom"
height   = 320             # optional, überschreibt die Bereichshöhe; Schlüssel weglassen = Bereich übernehmen
opens    = "startup"
closable = true
```

- Größen gehören den **9 Bereichen** (`[area.*]`). Ein Panel übernimmt die Größe seines Bereichs. `width` oder `height` am Panel sind optional und überschreiben nur, wenn sie gesetzt sind. Fehlt der Schlüssel, gilt der Bereich (TOML kennt kein `null`, darum wird er weggelassen).

#### Regeln für alle Config-Dateien

- **Zulässige Werte stehen als Kommentar hinter jedem Schlüssel** (Aufzählung `a | b | c`, Bereich `1 bis 10`, Einheit). Wer die Datei öffnet, sieht sofort, was erlaubt ist. Ein Test prüft, dass jeder Schlüssel einer Datei einen solchen Kommentar hat (Schema liefert den Text).
- **Kurzer Zusatz, wenn der Wert nicht selbsterklärend ist:** `group = "left-top"   # gleiche Gruppe = Tabs`. Selbsterklärende Werte bekommen nur die Aufzählung.
- **Flache Schlüssel statt Inline-Objekte.** `width = 280` und `height = 320` statt `size = { width = 280, height = 320 }`. Verschachtelt wird nur über Abschnitte (`[a.b]`), wenn eine Gruppe wirklich dazugehört. Ausnahme nur, wenn es ein echter Wert ist (z. B. eine Farbe mit Stil in `editor.syntax`, dort ebenfalls zu prüfen und wenn möglich in `keyword = "#c792ea"` und `keyword-style = "italic"` aufteilen).

- Das Panel-Register im Code kennt nur Komponente und Id. Titel, Bereich, Größe und `opens` kommen aus `layout.toml`. Plugin-Panels tragen ihre Standardwerte in einem eigenen Abschnitt `[panel.<id>]` ein.
- **Wann gilt der Standard-Bereich:** erster Start, "Layout zurücksetzen", Panel war noch nie da. Schließt der Nutzer ein Panel und öffnet es wieder (View-Menü), kommt es an die **zuletzt benutzte Stelle**, sonst an den Standard. Das Verhalten steht als Schalter in `layout.toml` (`[behavior] reopen = "last-position" | "default"`).

### Fenster-Limit

- Grenzwerte stehen in `app/config/limits.toml`, nicht im Code.
- `float-*` und `dialog-*` zusammen max. 3. Editor-Fenster getrennt (Standard 3, `[windows] maxEditorWindows`).
- Rust `window_open` zählt und meldet Fehlercode `window-limit`. Die UI öffnet dann **eingebettet** im Hauptfenster plus Toast. Nie automatisch schließen.

## Handarbeit und Lesbarkeit

Lion will Komponenten von Hand anpassen. Darum gelten diese Regeln für allen neuen und umgebauten Code.

### Findbarkeit und Isolation

- Eine Komponente pro Datei. Dateiname = Komponentenname.
- Stil neben der Komponente: `Name.tsx`, `Name.css`, `Name.test.tsx`. Die CSS-Datei enthält nur Regeln dieser Komponente und nutzt nur Tokens.
- Jede Control-Hülle trägt eine feste, sprechende Klasse (`ui-Button`, `ui-TextField`). So findet man im DevTools-Inspektor sofort die Datei.
- Reusable Teile liegen in `core/ui/controls` oder `core/ui/blocks`. Wer eine Maske ändern will, ändert genau eine Stelle.
- **UI-Galerie** im Debug-Menü ("UI Gallery"): zeigt jede Control und jeden Block in allen Zuständen, 3 Themes und beiden Dichten. Zum Anpassen von Hand und als Sichtprüfung nach jeder Token-Änderung.
- Die Ordner-Karten (`CLAUDE.md`) bleiben Pflicht und zeigen "Wenn du X ändern willst".

### Lesbarkeit

- Dateigröße: Ziel unter 200 Zeilen, ESLint `max-lines` warnt ab 250. Komponenten-Funktion ESLint `max-lines-per-function` warnt ab 80.
- Kein Magic Number: Maße über Tokens, Grenzwerte über benannte Konstanten.
- Props typisiert und benannt nach Wirkung (`isDisabled`, nicht `d`). Keine Boolean-Ketten: Varianten als Union (`variant: 'primary' | 'quiet'`).
- Logik raus aus der Darstellung: Hooks (`useX`) für Zustand und Laden, die Komponente rendert nur.
- Namen sagen, was etwas tut. Funktionen klein, eine Aufgabe.

### Kommentare

- **Self-documenting code.** Keine Kommentarblöcke, kein JSDoc-Zwang.
- Kommentar nur für ein "Warum", das der Code nicht zeigen kann (Workaround, Plattform-Eigenheit, Verweis auf Fehler).
- Wer eine Datei umbaut, löscht veralteten und erklärenden Kommentar, den ein besserer Name ersetzt.
- Deutsch in Projekt-Code, wie bisher.
- Prüfung im Review (kein Lint dafür). Vorhandene lange Kommentare werden nur beim Anfassen entfernt, nicht in einem Massen-Durchlauf.

## Phasen

| Phase | Inhalt | Größe |
|---|---|---|
| 0 | Sicherheitsnetz: UTF-8-Check, `.editorconfig`, ESLint + Stylelint (zuerst Warnung, Basislinie), Golden-Tests für `buildMenus`/Toolbar/Keymap, stabile Test-Basislinie, Mess-Basislinie, Karten reparieren | S |
| 1 | Tokens, Typo-Skala, Schrift/Größe/Dichte, `useRowHeight`, feste Farben und px ersetzen (1:1, dann Raster) | M–L |
| 1b | TOML-Theme-Format: Schema, Loader, interne Tokens, VS-Code-Importer, Farben-Editor aus dem Schema | M |
| 2 | React-Aria-Controls (Button, Icon, TextField, NumberField, Checkbox, Select, ComboBox, Dialog, Menu, Tabs, Tooltip, Table/ListBox), UI-Galerie, Ordner für Ordner umziehen | L |
| 3 | 3a Register-Logik (Kontext, Befehle, Tasten, Menüs) mit Adaptern für alte API, parallel zu 1 und 2. 3b Darstellung auf `useMenu` | L |
| 4 | Settings-/Schema-Register, `PropertyGrid`, `SchemaForm`. Pilot: `PropertySheetPanel` und `PreferencesEditor`, danach Options und Formulare | L |
| 4b | Layout-Engine: Panel-Register, `DockHost` (9-Slice, Docking, schwebend, Layout in `[layout]`), Layouts speichern und zurücksetzen. Ersetzt `DockLayout.tsx` | L |
| 5 | `createStore`, `useResource` mit Tag-Invalidierung über `forge://project-changed` und `index-progress` | M |
| 6 | Performance: lazy Fenster/Dialog/Editor, Monaco, Virtualisierung, React Compiler, View-State je Tab | M |
| 6b | Große Editoren (`ViewPreview`, `SqlEditor`, `LanguageEditor`) auf Controls und Blöcke | M–L |
| 7 | Fenster-Limit (Rust + UI) | S–M |
| 8 | **tauri-specta**, siehe unten | L |

Vorgehen: erst dünne Fundamente (0 bis 3a), dann Bereich für Bereich als vertikale Scheibe. Jeder Schritt bleibt lauffähig.

### Phase 8: tauri-specta

- Alle Tauri-Befehle bekommen `#[specta::specta]`, Typen leiten `specta::Type` ab. Ein Build-Schritt schreibt `bindings.ts` (Typen, Befehle, Events).
- Ersetzt `wire/types.ts`, den Großteil von `tauriApi.ts` und `ForgeApi.ts`. Das Fehler-Logging (Aufrufer Datei:Zeile) kommt in eine dünne Hülle um die erzeugten Funktionen.
- `mockApi.ts` bleibt von Hand, wird aber gegen die erzeugten Typen geprüft.
- **Offen: `plugin_call`.** Alle Plugin-Befehle laufen durch einen Befehl mit losen Argumenten. Lösung zuerst klären: je Plugin ein typisiertes Enum aus Befehlsname + Argumenten, das specta exportiert, oder Plugin-Befehle als eigene Tauri-Befehle mit gemeinsamem Guard. Entscheidung am Anfang von Phase 8.
- tauri-specta für Tauri 2 ist Release Candidate: Version fest pinnen.
- Kann ab Phase 1 parallel laufen, weil es die Backend-Seite betrifft. Je früher, desto weniger Umzug auf alte Typen.

## Alt und neu nebeneinander

- Alte `register*`-Funktionen werden Adapter und `@deprecated`. Git-Plugin läuft unverändert weiter.
- Golden-Tests sind die Abnahme jedes Menü-Umbaus.
- Controls rendern zuerst die alten Klassen, bis die CSS auf Tokens ist.
- Ein Ordner ist alt oder neu, nie lange gemischt. Kleine PRs je Ordner.

## Regeln gegen Rückfall

| Regel | Werkzeug | Ab |
|---|---|---|
| Keine festen Farben außer `theme/tokens*.css` | Stylelint | 1 |
| font-size, z-index, Abstände nur über `var(--…)` | Stylelint `declaration-strict-value` | 1 |
| `react-aria-components` nur in `core/ui/controls` | ESLint `no-restricted-imports` | 2 |
| Keine rohen `<button>`, `<input>`, `<select>`, `<table>` in Features | ESLint `no-restricted-syntax` | 2 |
| Kein `let cancelled = false`, kein `navigator.clipboard` | ESLint | 5 / 0 |
| Keine Importe aufwärts zwischen Schichten | ESLint `import/no-restricted-paths` | 3 |
| Dateigröße und Funktionslänge | ESLint `max-lines`, `max-lines-per-function` (Warnung) | 0 |
| Hooks- und Compiler-Regeln | `eslint-plugin-react-hooks` | 0 / 6 |
| Jeder Token in allen Themes | Vitest | 1 |
| Karten vollständig | `scripts/check-maps.ps1` in CI | 0 |
| UTF-8 gültig | Skript in CI | 0 |

Jede Regel startet als Warnung mit gespeicherter Anzahl. CI bricht nur bei Zuwachs ab. Ist ein Ordner sauber, wird sie dort Fehler.

## Einsparung (Schätzung)

| Phase | Zeilen weniger |
|---|---|
| 1 Tokens | 300–800 |
| 2 Controls | 500–1 600 |
| 3 Register | 400–1 000 |
| 4 Schema | 1 200–2 200 |
| 5 Laden/Stores | 500–900 |
| 6 / 6b | 0–200 / 800–2 000 |
| 7 Fenster-Limit | −150 |
| 8 specta | 1 200–1 700 |
| Tests | 300–800 |
| **Summe** | **ca. 5 000–11 000** |

## Messpunkte

Start bis erstes Bild (`performance.mark`), Projekt öffnen (`PERF` gibt es), Fenster öffnen, RAM je Fenster (`usedJSHeapSize` und `msedgewebview2`-Prozesse), Render-Zeit Baum (`<Profiler>`), Bundle-Größen, Tastenreaktion. Neuer Debug-Menüpunkt "Perf Snapshot" schreibt JSON in den Log-Ordner. Festes Szenario, 3 Läufe, Median. Basislinie in Phase 0. Mehr als 10 % schlechter: Phase nicht fertig.

## Offene Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| E1 | Offenen SSH-Tunnel-Stand zuerst committen und in der App prüfen | Ja |
| E2 | Zeilenhöhe: Standard 24 px (WCAG 2.5.8), kompakt 20 px als Wahl | Ja, nach Screenshot-Vergleich |
| E3 | Editor-Fenster-Limit getrennt vom Popup-Limit (Standard 3) | Ja |
| E5 | UI-Zoom und Schriftgröße beide behalten | Ja |
| E8 | ESLint und Stylelint einführen | Ja |
| E9 | `plugin_call` unter specta: Enum oder eigene Befehle | Offen. Empfehlung: loser Befehl bleibt, je Plugin eine typisierte TypeScript-Hülle |

Später: eigene Tasten in `designer.conf`, gemeinsames Icon-Set, Light-Theme final, Monaco-Vorladen nach Messung, `ProjectTree` auf RAC `Tree`, Monaco-Schrift folgt der UI-Schrift. Zu prüfen: ob React Aria eine fertige Menubar hat (Anfang Phase 2).

## Risiken

1. Optik in 3 Themes ohne CSS-Tests: Screenshot-Liste je Phase, Tokens zuerst 1:1.
2. Token-Namen ändern bricht gespeicherte Nutzerfarben: Namen sind tabu.
3. rem gegen Virtualisierung: `useRowHeight` schon in Phase 1.
4. React-Aria-Portale und Fokus gegen Monaco und globalen Tasten-Listener.
5. Veraltete Werte in Befehlen: Befehle lesen Stores und Refs, Golden-Test.
6. Schreib-Pfade im Property-Sheet bleiben fachlich unverändert.
7. Wackelige Test-Basislinie: Phase 0.
8. Bundle-Größe von React Aria: nur einzelne Komponenten importieren, messen.
9. `plugin_call` unter specta (siehe Phase 8).
10. Agenten schreiben mit PowerShell 5.1 Dateien kaputt: Regel und CI-Check.
