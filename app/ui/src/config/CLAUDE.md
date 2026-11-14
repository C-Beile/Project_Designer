# config (UI) – Karte
<!-- AUTO:START -->
## Dateien
| Datei | Wofür |
|---|---|
| `configSchema.ts` | Gemeinsame Prüfung für Dev-Config-Dateien (`checkSection`, `ConfigError`). |
| `layoutConfig.ts` | Liest `app/config/layout.toml`. `defaultLayout()` in `shell/layoutState.ts` nimmt die Größen von dort. |
| `limitsConfig.ts` | Liest `app/config/limits.toml`. |
<!-- AUTO:END -->

## Zweck
Liest die Dev-Konfiguration aus `app/config/*.toml` (per `?raw` eingebunden) und prüft sie gegen ein Schema.

## Regeln
- `configSchema.ts` ist die gemeinsame Prüfung (`checkSection`). Fehler (`ConfigError`) nennen Datei, Schlüssel und erlaubte Werte.
- Neue Datei: Schema und Loader hier, Datei in `app/config/`, Eintrag in `app/config/CLAUDE.md`.
- `vite.config.ts` erlaubt `server.fs.allow: ['..']`, damit der Dev-Server `app/config` liefert.

## Tests
- `devConfig.test.ts`: Kommentare vorhanden, Fehlermeldungen, Standard-Layout aus `layout.toml`.
