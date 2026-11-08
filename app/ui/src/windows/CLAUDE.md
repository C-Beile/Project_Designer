# windows – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `protocol.ts` | Was Haupt- und Nebenfenster sich sagen: `EVENTS`, `FloatView`, `MainState`, `FloatAction`, Größen. |
| `windowService.ts` | Der eine Ort, der OS-Fenster öffnet (`openDialogWindow`, `openFloatWindow`). Tauri steckt hinter `WindowBackend`. |
| `WindowRoot.tsx` | Einstieg jedes Nebenfensters: wählt nach `?window=` float, dialog oder editor. |
| `DialogWindowApp.tsx` | Inhalt eines Dialog-Fensters. Tabelle `DIALOG_WINDOWS` (Name zu Dialog). |
| `FloatApp.tsx` | Inhalt eines schwebenden Panels (scm, services, navigator, properties, output). |
| `EditorWindowApp.tsx` | Fenster, in das ein Editor verschoben wurde. |
| `useOsDialog.ts` | Hauptfenster-Hook: Dialog als OS-Fenster öffnen, sonst eingebetteter Dialog. |
| `useFloatBridge.ts` | Hauptfenster-Seite der schwebenden Panels. |
| `useEditorWindows.ts` | Hauptfenster-Seite der Editor-Fenster. |
| `useCloseGuard.ts` | Fragt beim Schließen des Hauptfensters nach ungespeicherten Änderungen. |
| `floatStore.ts` | Welche Panels schweben und wo, je Projekt gemerkt. |
| `editorWindows.ts` | Fenstername eines Dokuments, Anordnung je Projekt gemerkt. |
| `osWindowContext.ts` | Kontext "läuft im OS-Fenster": `Modal` füllt dann das Fenster. |
<!-- AUTO:END -->

## Zweck
Eigene Betriebssystem-Fenster: schwebende Panels, Dialoge, verschobene Editoren. Das Hauptfenster bleibt der einzige Ort, an dem Projekt und Dokumente leben.

## Einstiegspunkte
- `src/main.tsx` lädt bei `?window=<kind>&name=<name>` nur `WindowRoot` (nicht die ganze App).
- Hauptfenster-Seite: `shell/hooks/useFloatingWindows.ts`, `useEditorWindows`, `useDialogWindows.ts`.

## Abhängigkeiten
- Rein: `@tauri-apps/api` (nur `windowService.ts`), `shell/*` (Dialoge), `core/plugins/registry` (Git-Dialoge und -Panels per `getDialog`), `core/scm`, `features/registerFeatures` (meldet die Plugins an), `editors/registry`, `tabs/`, `properties/`, `ForgeApi`.
- Raus: `shell/`, `main.tsx`.

## Regeln und Fallen
- Alles reist als Tauri-Event (`EVENTS` in `protocol.ts`). Ein Fenster hat keinen eigenen Projektzustand. Es bekommt `MainState` und schickt `FloatAction` zurück.
- Ein Dokument ist in genau einem Fenster offen.
- Ohne Tauri (Browser, Tests) gibt `osWindowsAvailable()` false. Dann laufen die eingebetteten Dialoge. Tests setzen ein Fake mit `setWindowBackend` (`src/test/fakeWindowBackend.ts`).
- Jedes OS-Fenster hat sein eigenes Register. `WindowRoot` meldet die Plugins an (`registerFeaturePlugins`), bevor es zeichnet. Git-Fenster (`git`, `sync`, `commitdiff`) und das scm-Panel kommen über `getDialog`/`useDialog`; ohne Plugin bleiben sie leer.
- Das Ergebnis eines Dialog-Fensters wird als JSON-Text übertragen. Es muss serialisierbar sein.
- Neue Fenster brauchen einen passenden Namen in `app/src-tauri/capabilities/default.json` (`float-*`, `dialog-*`, `editor-*` sind erlaubt).

## Wenn du X ändern willst
| Aufgabe | Datei |
|---|---|
| Neuer Dialog als Fenster | Eintrag in `DIALOG_WINDOWS` (`DialogWindowApp.tsx`), Aufruf mit `useOsDialog` oder `openDialogWindow`, Auslöser in `shell/hooks/useDialogWindows.ts` und `ShellDialog` in `shell/hooks/dialogTypes.ts` |
| Neues schwebendes Panel | `FloatView`, `FLOAT_VIEWS`, `FLOAT_TITLES`, `FLOAT_SIZES` in `protocol.ts`, Anzeige in `FloatApp.tsx`, Seite des Hauptfensters in `useFloatBridge.ts` |
| Neues Event | `EVENTS` in `protocol.ts` |
| Was ein Float-Fenster vom Hauptfenster weiß | `MainState` in `protocol.ts` |

## Tests
- `windows.test.tsx`, `dialogWindows.test.tsx`, `editorWindows.test.tsx` mit `src/test/fakeWindowBackend.ts`. `npx vitest run src/windows`.
