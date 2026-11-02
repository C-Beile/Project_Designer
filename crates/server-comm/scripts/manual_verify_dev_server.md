# Manual dev-server verification procedure

Not part of `cargo test` on purpose — this talks to a real network server and needs a private
key plus config files that live outside this repository. Run it by hand when you need to
re-verify connectivity or capture real protocol traffic for R15 (see
`PROJECT/20_architecture/p7-server-comm-verify-notes.md`).

No credentials are stored in this file or anywhere in the repository. Every step below reads
them at runtime from the two files under `Downloads\` that Clemens provided for this purpose.

## Prerequisites

- The two config files for the target dev server (tunnel config + system-db serverconfig),
  wherever Clemens has placed them for the current test server.
- An SSH private key registered for that server (PuTTY `.ppk` format has been the case so
  far), plus `plink.exe` (ships with PuTTY) — `plink` reads `.ppk` natively, no conversion
  needed.
- Python 3 with `pymysql` installed (`pip install pymysql`) for the DB check step.

## 1. Open the SSH tunnel

Pick the tunnel entry for the service you need from the tunnel config XML (each entry has
`tunnelHostAddress`/`tunnelHostPort`/`targetServerAddress`/`targetServerPort`/`user`). Example
for the system DB alias:

```
plink -ssh -batch -P 22 -i "<path to the .ppk key>" -l <tunnel user from the config> ^
  -L 33061:<targetServerAddress from the DB tunnel entry>:<targetServerPort> ^
  -N <tunnelHostAddress>
```

Run this in the background. Confirm it is actually listening before moving on
(`netstat -an | findstr 33061` should show `LISTENING` on `127.0.0.1:33061`).

If the forward fails with `Forwarded connection refused by remote: Connect failed [open
failed]`, do not assume the tunnel setup is wrong first — check whether the target dev
environment is actually running. A Kubernetes-based dev/test server that has not been started
yet produces exactly this error.

## 2. Verify the DB connection (read-only)

```python
import xml.etree.ElementTree as ET
import pymysql

cfg_path = r"<path to the *_serverconfig_system.xml file>"
tree = ET.parse(cfg_path)
root = tree.getroot()

alias_map = {}
for node in root.iter("node"):
    if node.attrib.get("name") == "db alias":
        for e in node.find("map").findall("entry"):
            alias_map[e.attrib["key"]] = e.attrib["value"]

conn = pymysql.connect(
    host="127.0.0.1", port=33061,
    user=alias_map["user"], password=alias_map["password"],
    connect_timeout=8,
)
with conn.cursor() as cur:
    cur.execute("SELECT 1")
    print(cur.fetchone())
conn.close()
```

A successful run proves: SSH tunnel up, MariaDB reachable through it, credentials from the
config file valid. It does not touch or modify any data.

## 3. Optional: read-only HTTP probe against the app-server stack

Add further `-L` forwards to the same `plink` invocation (or a second one) for
`adito-web`/`adito-manager`/etc. ports listed in the tunnel config, then send a plain `GET /`
with no auth (Python `http.client` or `curl`). This only confirms the HTTP transport is alive
and identifies which service answers on which port — it is not a substitute for capturing the
actual `ServerComm` REST protocol, which still needs real designer traffic or a proxy capture
against an authenticated session.

## 4. Clean up

```
taskkill /F /IM plink.exe
```

Verify with `netstat` that the forwarded local ports are no longer listening. Delete any
throwaway scripts/log files you created for the session — none of them should contain
credentials if you followed step 2's pattern (read from the config file at runtime, never
hardcode).
