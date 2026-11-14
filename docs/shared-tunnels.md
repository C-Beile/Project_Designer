# Gemeinsame Tunnel-Liste (`tunnels.json`)

Zweck: Dito Designer und AditoHub (und spätere Werkzeuge) sehen gegenseitig ihre offenen SSH-Tunnel und nutzen sie mit.
Statt zweimal zu verbinden, nimmt das zweite Programm den Tunnel des ersten.

## Ort

Ein neutraler Ordner pro Benutzer, nicht nach einer Firma oder einem Programm benannt:

| System | Ordner |
|---|---|
| Windows | `%LOCALAPPDATA%\AditoTunnels` |
| macOS | `~/Library/Application Support/AditoTunnels` |
| Linux | `$XDG_DATA_HOME/aditotunnels`, sonst `~/.local/share/aditotunnels` |

Die Umgebungsvariable `ADITO_TUNNELS_DIR` überschreibt den Ordner (Tests).

## Datei `tunnels.json`

```json
{
  "version": 1,
  "entries": [
    {
      "target": "adito-db.dev-hermes1.svc.cluster.local:3306",
      "ip": "127.0.2.1",
      "port": 3306,
      "owner": "hub",
      "pid": 4242,
      "since": 1763000000
    }
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `target` | Das Ziel, `host:port`, Host in Kleinschreibung. Beim Hub ist das `domain:port` einer Weiterleitung. |
| `ip`, `port` | Hier ist das Ziel lokal erreichbar. |
| `owner` | Wer den Tunnel geöffnet hat: `designer` oder `hub`. |
| `pid` | Prozess des Besitzers. Eigene Einträge erkennt ein Programm daran. |
| `since` | Sekunden seit 1970. Nur zur Anzeige. |

JSON-Namen in camelCase. Unbekannte Felder werden ignoriert (neue Felder sind erlaubt).

## Regeln

1. **Eintragen:** Wer einen Tunnel öffnet, trägt ihn ein, sobald der Listener lauscht. **Austragen:** beim Schließen.
2. **Lesen:** Ein Eintrag zählt nur, wenn `ip:port` auf eine Verbindung antwortet (kurzer Verbindungsversuch, 300 ms). Tote Einträge (Absturz) entfernt der Leser aus der Datei. Eigene Einträge (`pid` gleich) werden nicht geprüft.
3. **Mitnutzen:** Vor dem Öffnen eines Tunnels zu einem Ziel schaut ein Programm in die Liste. Gibt es einen lebenden Eintrag eines anderen Prozesses, nutzt es dessen `ip:port` und öffnet nichts. Es schließt diesen Tunnel nie.
4. **Schreiben:** Lesen, ändern, schreiben unter der Sperrdatei `tunnels.lock` (`create_new`, bis 1 s wiederholen, eine Sperre über 5 s Alter gilt als verwaist). Die Datei wird atomar ersetzt (Temp-Datei, dann umbenennen). Ist die Sperre nicht zu bekommen, ist die Änderung verloren: das ist unkritisch, jeder Eintrag wird beim Lesen geprüft.
5. **Adressen:** Der Designer nutzt `127.0.200.x` mit dem echten Port des Ziels. Der Hub nutzt `127.0.2.x` aufwärts. Wer eine Adresse wählt, bindet sie wirklich: ist `ip:port` belegt, nimmt er die nächste.
6. Eine fehlende oder kaputte Datei heißt: keine Einträge.

## Umsetzung

- Designer: `crates/ssh-tunnel/src/shared_tunnels.rs`, eingebunden in `tunnels.rs`.
- Hub: `HillsIT.Ssh/SharedTunnelList.cs`, eingebunden in `TunnelManager.cs` (`StartListener` trägt ein, `RemoveServiceAsync` und `CleanupAsync` tragen aus, `ConnectAsync` und `StartForwardAsync` nutzen fremde Tunnel mit).
- Grenze im Hub: Er baut seine SSH-Verbindung weiter auf, auch wenn alle Tunnel eines Systems schon von jemand anderem offen sind. Er startet dann nur keinen eigenen Listener.
