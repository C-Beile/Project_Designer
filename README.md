# Dito Designer

Eigenständiger Desktop-Editor für ADITO-Projekte (xRM), gebaut mit Rust und Tauri.
Der Dito Designer folgt Aufbau und Bedienung des ADITO Designers, ist aber ein schneller, dunkel gestalteter Nachbau
mit eigener Oberfläche.

> Internes Werkzeug von 3Hills IT. Kein offizielles Produkt der ADITO Software GmbH.

## Was er kann

- **Projektbaum und Editoren** für Entities, Views, Prozesse, Kontexte, Aliase, Sprachen und Systemkonfigurationen,
  mit Properties-Fenster, Navigator, Output und Statusleiste wie im Original.
- **Git** im Stil des ADITO-Git-Plugins: Commit-Dialog mit Ordnerstruktur, Branches, Log, Diff.
- **Liquibase Update** für Datenbank-Aliase direkt aus dem Projektbaum.
- **SSH-Tunnel** zu Systemen und Datenbank-Browser; der Tunnelstatus ist über Symbolformen erkennbar,
  nicht nur über Farben.
- **Transpiler** über die Installation des offiziellen ADITO Designers.
- **Themes:** Night Owl (blau), Light und „Lion in der City“ (dunkles Grau wie im Original).
- **Updates in der App:** Help > Check for Updates installiert die neueste Version aus diesem Repository.

## Installation

1. Unter [Releases](../../releases) die aktuelle Version öffnen.
2. **Windows:** `…-setup.exe` ausführen. Windows zeigt eine SmartScreen-Meldung, weil die Datei nicht signiert ist:
   „Weitere Informationen“ und „Trotzdem ausführen“.
3. **macOS:** `…universal.dmg` öffnen und die App nach „Programme“ ziehen. Beim ersten Start per Rechtsklick „Öffnen“
   (die App ist nicht notarisiert).

Voraussetzung ist eine installierte ADITO-Designer-Version, wenn transpiliert werden soll
(Tools > Options > ADITO).

## Aktualisieren

Help > Check for Updates. Die App prüft dieses private Repository und installiert neuere Versionen nach Rückfrage.

## Entwickeln

```
app/ui          React-Oberfläche (Vite, Monaco, Vitest)
crates/project  Logik ohne UI (Projektbaum, Git, Liquibase, Datenbank, Tunnel)
app/src-tauri   Tauri-Hülle und Befehle
crates/         Bibliotheken (aod, adito-transpiler, platform)
```

```
cd app/ui && npm install && npm test      # Oberfläche prüfen
cargo test                                # Rust-Teile prüfen
npx --prefix app/ui tauri build           # Installer bauen (in app/)
```

## Release

Ein Tag `vX.Y.Z` löst den Workflow *Release* aus: Er baut Windows und macOS, signiert die Update-Pakete, legt das
Release an und schreibt `latest.json` auf den Branch `updates`. Der Tag muss zur Version in
`app/src-tauri/tauri.conf.json` passen.
