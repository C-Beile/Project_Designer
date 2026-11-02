import { useCallback, useEffect, useState } from 'react'
import { isMacPlatform } from '../shell/shortcuts'
import type { ReactNode } from 'react'
import { useSshKeyPath } from '../settings/sshKey'
import { setTunnelError, tunnelConnecting } from './tunnelState'
import type { ForgeApi } from '../api/ForgeApi'
import type { DbStatus, SchemaTable } from '../wire/types'
import { Modal } from '../shell/Dialogs'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'

// Services tab of the left panel (LAYOUT_SPEC section 4.3): the database connection, its tables
// and the tunnel. The two export files are chosen here (also through the Tunnel node's menu or a
// double click) and read by the backend only at connect time; nothing about them is stored, and
// their content (user, password) is never shown.

const NOT_YET = 'Not available yet'

function PathField({ label, value, onChange, onBrowse }: { label: string; value: string; onChange: (v: string) => void; onBrowse: () => void }) {
  return (
    <label className="forge-field">
      <span>{label}</span>
      <span className="forge-field-row">
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <button type="button" onClick={onBrowse}>
          Browse...
        </button>
      </span>
    </label>
  )
}

// Tunnel authentication (manual appendix E): SSH key or basic auth with user (from the tunnel
// config) and password. The password only lives in this component's state until connecting.
function AuthFields({ mode, onMode, password, onPassword, keyField }: { mode: 'key' | 'basic'; onMode: (m: 'key' | 'basic') => void; password: string; onPassword: (p: string) => void; keyField: ReactNode }) {
  return (
    <fieldset className="forge-auth">
      <legend>Tunnel authentication</legend>
      <label className="forge-check">
        <input type="radio" name="tunnel-auth" checked={mode === 'key'} onChange={() => onMode('key')} />
        <span>Key auth</span>
      </label>
      <label className="forge-check">
        <input type="radio" name="tunnel-auth" checked={mode === 'basic'} onChange={() => onMode('basic')} />
        <span>Basic auth</span>
      </label>
      {mode === 'key' ? (
        keyField
      ) : (
        <label className="forge-field">
          <span>Tunnel password</span>
          <input type="password" autoComplete="off" value={password} onChange={(e) => onPassword(e.target.value)} aria-label="Tunnel password" />
        </label>
      )}
    </fieldset>
  )
}

type ConfigFocus = 'tunnel' | 'server'

export function ServicesPanel({
  api,
  db,
  onDbChange,
  onOpenSql,
}: {
  api: ForgeApi
  db: DbStatus
  onDbChange: (status: DbStatus) => void
  onOpenSql: (sql: string) => void
}) {
  const [tunnelConfig, setTunnelConfig] = useState('')
  const [serverConfig, setServerConfig] = useState('')
  const [keyFile, setKeyFile] = useSshKeyPath(api)
  const [authMode, setAuthMode] = useState<'key' | 'basic'>('key')
  const [tunnelPassword, setTunnelPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tables, setTables] = useState<SchemaTable[]>([])
  const [menu, setMenu] = useState<{ kind: 'db' | 'tunnel'; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<ConfigFocus | null>(null)
  const [schemaTick, setSchemaTick] = useState(0)

  useEffect(() => {
    if (!db.connected) {
      setTables([])
      return
    }
    let cancelled = false
    api
      .dbSchema()
      .then((t) => {
        if (!cancelled) setTables(t)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      })
    return () => {
      cancelled = true
    }
  }, [api, db.connected, schemaTick])

  async function browse(title: string, label: string, extensions: string[], set: (v: string) => void) {
    const picked = await api.pickFile(title, label, extensions).catch(() => null)
    if (picked) set(picked)
  }

  const connect = useCallback(async () => {
    setBusy(true)
    setError(null)
    tunnelConnecting(true)
    try {
      const basic = authMode === 'basic' && tunnelPassword !== ''
      onDbChange(await api.dbConnect(tunnelConfig.trim(), serverConfig.trim(), basic ? null : keyFile.trim() || null, basic ? tunnelPassword : null))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setTunnelError(message)
    } finally {
      tunnelConnecting(false)
      setTunnelPassword('')
      setBusy(false)
    }
  }, [api, tunnelConfig, serverConfig, keyFile, authMode, tunnelPassword, onDbChange])

  const disconnect = useCallback(async () => {
    await api.dbDisconnect().catch(() => {})
    setError(null)
    onDbChange(await api.dbStatus().catch(() => ({ connected: false, tunnel_up: false, database: null, host: null })))
  }, [api, onDbChange])

  const canConnect = !busy && tunnelConfig.trim() !== '' && serverConfig.trim() !== '' && (authMode === 'key' || tunnelPassword !== '')

  function entriesFor(kind: 'db' | 'tunnel'): MenuEntry[] {
    if (kind === 'db') {
      return [
        { id: 'open', label: 'Open', enabled: db.connected, hint: 'Not connected' },
        { id: 'refresh', label: 'Refresh Folder', enabled: db.connected, hint: 'Not connected' },
        { id: 'sep', label: '', enabled: false, separator: true },
        { id: 'disconnect', label: 'Close Opened Tunnels', enabled: db.connected, hint: 'Not connected' },
        { id: 'properties', label: 'Properties', enabled: false, hint: NOT_YET },
      ]
    }
    return [
      { id: 'connect', label: 'Open Tunnels', enabled: canConnect && !db.connected, hint: db.connected ? 'The tunnel is already open' : 'Choose the tunnel and server config first' },
      { id: 'disconnect', label: 'Close Opened Tunnels', enabled: db.tunnel_up, hint: 'No tunnel is open' },
      { id: 'sep', label: '', enabled: false, separator: true },
      { id: 'editTunnel', label: 'Edit Tunnel Config...', enabled: !db.connected, hint: 'Close the tunnel first' },
      { id: 'editServer', label: 'Edit Server Config...', enabled: !db.connected, hint: 'Close the tunnel first' },
      { id: 'sep2', label: '', enabled: false, separator: true },
      { id: 'properties', label: 'Properties', enabled: false, hint: NOT_YET },
    ]
  }

  function pick(kind: 'db' | 'tunnel', id: string) {
    if (id === 'open') onOpenSql('')
    else if (id === 'refresh') setSchemaTick((t) => t + 1)
    else if (id === 'connect') void connect()
    else if (id === 'disconnect') void disconnect()
    else if (id === 'editTunnel') setDialog('tunnel')
    else if (id === 'editServer') setDialog('server')
    void kind
  }

  return (
    <div className="forge-services" aria-label="Services">
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="forge-services-tree" role="tree" aria-label="Services tree">
        <li role="treeitem" aria-expanded="true">
          <span className="forge-services-group">Databases</span>
          {db.connected ? (
            <ul role="group">
              <li role="treeitem" aria-expanded="true">
                <button
                  type="button"
                  className="forge-services-db"
                  title="Open SQL editor"
                  onClick={() => onOpenSql('')}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ kind: 'db', x: e.clientX, y: e.clientY })
                  }}
                >
                  {db.database} @ {db.host}
                </button>
                <ul role="group" aria-label="Tables">
                  {tables.map((t) => (
                    <li key={`${t.schema}.${t.name}`} role="treeitem" aria-selected="false">
                      <button type="button" className="forge-services-table" title={`SELECT * FROM ${t.name}`} onClick={() => onOpenSql(`SELECT * FROM \`${t.name}\` LIMIT 100`)}>
                        {t.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          ) : (
            <p className="forge-field-hint">No connection</p>
          )}
        </li>
        <li role="treeitem" aria-expanded="true">
          <button
            type="button"
            className="forge-services-group forge-services-tunnel"
            title="Double-click to choose the tunnel and server config"
            onDoubleClick={() => setDialog('tunnel')}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ kind: 'tunnel', x: e.clientX, y: e.clientY })
            }}
          >
            Tunnel
          </button>
          <p className="forge-field-hint" data-testid="tunnel-state">
            {db.tunnel_up ? 'SSH tunnel is open' : 'SSH tunnel is closed'}
          </p>
        </li>
      </ul>
      {menu ? (
        <TreeContextMenu entries={entriesFor(menu.kind)} x={menu.x} y={menu.y} onPick={(id) => pick(menu.kind, id)} onClose={() => setMenu(null)} />
      ) : null}
      {dialog ? (
        <Modal
          title={dialog === 'tunnel' ? 'Edit Tunnel Config' : 'Edit Server Config'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" onClick={() => setDialog(null)}>
                OK
              </button>
              <button type="button" disabled={!canConnect || db.connected} onClick={() => { setDialog(null); void connect() }}>
                Connect
              </button>
            </>
          }
        >
          <PathField label="Tunnel config (tunnelconfig.xml)" value={tunnelConfig} onChange={setTunnelConfig} onBrowse={() => browse('Choose the tunnel config', 'XML', ['xml'], setTunnelConfig)} />
          <PathField label="Server config (serverconfig_system.xml)" value={serverConfig} onChange={setServerConfig} onBrowse={() => browse('Choose the system server config', 'XML', ['xml'], setServerConfig)} />
          <AuthFields mode={authMode} onMode={setAuthMode} password={tunnelPassword} onPassword={setTunnelPassword} keyField={<PathField label={isMacPlatform() ? 'SSH key (OpenSSH, optional)' : 'SSH key (.ppk, optional)'} value={keyFile} onChange={setKeyFile} onBrowse={() => browse('Choose the SSH key', isMacPlatform() ? 'OpenSSH key' : 'PuTTY key', isMacPlatform() ? [] : ['ppk'], setKeyFile)} />} />
          <p className="forge-field-hint">Only the file locations are kept in memory. The files are read while connecting; user and password are never stored, logged or shown.</p>
        </Modal>
      ) : null}
      {db.connected ? null : (
        <div className="forge-services-form">
          <PathField label="Tunnel config (tunnelconfig.xml)" value={tunnelConfig} onChange={setTunnelConfig} onBrowse={() => browse('Choose the tunnel config', 'XML', ['xml'], setTunnelConfig)} />
          <PathField label="Server config (serverconfig_system.xml)" value={serverConfig} onChange={setServerConfig} onBrowse={() => browse('Choose the system server config', 'XML', ['xml'], setServerConfig)} />
          <AuthFields mode={authMode} onMode={setAuthMode} password={tunnelPassword} onPassword={setTunnelPassword} keyField={<PathField label={isMacPlatform() ? 'SSH key (OpenSSH, optional)' : 'SSH key (.ppk, optional)'} value={keyFile} onChange={setKeyFile} onBrowse={() => browse('Choose the SSH key', isMacPlatform() ? 'OpenSSH key' : 'PuTTY key', isMacPlatform() ? [] : ['ppk'], setKeyFile)} />} />
          <button type="button" onClick={connect} disabled={!canConnect}>
            {busy ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      )}
    </div>
  )
}
