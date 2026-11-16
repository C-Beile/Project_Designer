import { configGet, configSet, onConfigChange } from '../settings/appConfig'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSshKeyPath } from '../settings/sshKey'
import { setForwardsUp, setTunnelError, tunnelConnecting } from '../services/tunnelState'
import type { ForgeApi } from '../api/ForgeApi'
import { logOutput } from '../core/outputBus'
import type { MenuEntry } from '../tree/contextMenu'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { confirmDialog, promptDialog } from '../core/dialogService'
import type { DbStatus, ForwardStatusDto, TunnelRowDto } from '../wire/types'
import { TunnelPorts, pinKey } from './TunnelPorts'
import { TunnelKeyBar } from './TunnelKeyBar'
import { errorText } from '../core/errorText'
import { Button, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'
import { copyText as copyToClipboard } from '../core/clipboard'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'
import { Icon } from '../core/icons/Icon'

function savedView(): 'ports' | 'table' {
  return configGet<string>('tunnels', 'view') === 'table' ? 'table' : 'ports'
}

// Tunnel config editor (original Designer, shot 56): the tunnels of a system's tunnel config as a
// table. Connect opens a local SSH port forward for one row (free local port, plink); the forward
// to the database host is reused by the Services connection instead of a second SSH session.
// The row menu starts with the entries of the original (reference shot 82: Add Tunnel, Delete Tunnel,
// Disconnect/Connect); Add and Delete stay disabled until the config file can be written. The rest is an own choice: the manual (appendix E, chapter 11) only names "Open
// Tunnels" and "Close opened tunnels" on the system node and shows no row menu.
// The file holds no passwords. The key file and its passphrase are set in Options > ADITO > General.

export function isTunnelActive(row: TunnelRowDto, db: DbStatus): boolean {
  return db.tunnel_up && !!db.host && row.target_host.toLowerCase() === db.host.toLowerCase()
}

export function copyText(row: TunnelRowDto): string {
  return `${row.tunnel_host}:${row.tunnel_port} -> ${row.target_host}:${row.target_port}`
}

export function rowKey(row: Pick<TunnelRowDto, 'target_host' | 'target_port'>): string {
  return `${row.target_host.toLowerCase()}:${row.target_port}`
}

export function hostPort(row: TunnelRowDto): string {
  return `${row.target_host}:${row.target_port}`
}

export type RowState = 'idle' | 'busy' | 'up' | 'error'

const STATUS_ICON = { idle: 'plugs', busy: 'circle-notch', up: 'plugs-connected', error: 'warning' } as const

/** Pinned targets (`service:port`), the same for every project. */
function savedPins(): Set<string> {
  const list = configGet<unknown>('tunnels', 'pinned')
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
}

export function buildRowMenu(opts: { rowUp: boolean; rowBusy: boolean; anyUp: boolean; allUp: boolean; hasRow?: boolean }): MenuEntry[] {
  return [
    { id: 'addTunnel', label: 'Add Tunnel', enabled: true },
    { id: 'deleteTunnel', label: 'Delete Tunnel', enabled: !!opts.hasRow && !opts.rowUp && !opts.rowBusy, hint: opts.rowUp ? 'Disconnect the tunnel first' : opts.rowBusy ? 'A connection attempt is running' : 'No tunnel is selected' },
    { id: 'sep0', label: '', enabled: false, separator: true },
    { id: 'connect', label: 'Connect', enabled: !opts.rowUp && !opts.rowBusy, hint: opts.rowUp ? 'The tunnel is already open' : 'A connection attempt is running' },
    { id: 'disconnect', label: 'Disconnect', enabled: opts.rowUp, hint: 'The tunnel is not open' },
    { id: 'sep1', label: '', enabled: false, separator: true },
    { id: 'connectAll', label: 'Connect All', enabled: !opts.allUp && !opts.rowBusy, hint: opts.allUp ? 'All tunnels are already open' : 'A connection attempt is running' },
    { id: 'disconnectAll', label: 'Disconnect All', enabled: opts.anyUp, hint: 'No tunnel is open' },
    { id: 'sep2', label: '', enabled: false, separator: true },
    { id: 'copyAddress', label: 'Copy Target Address', enabled: true },
    { id: 'copyHostPort', label: 'Copy as host:port', enabled: true },
    { id: 'sep3', label: '', enabled: false, separator: true },
    { id: 'refresh', label: 'Refresh', enabled: true },
  ]
}

export function TunnelConfigEditor({
  api,
  projectRoot,
  reference,
  db,
  onDbChange,
}: {
  api: ForgeApi
  projectRoot: string
  reference: string
  db: DbStatus
  onDbChange: (next: DbStatus) => void
}) {
  const [rows, setRows] = useState<TunnelRowDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [reload, setReload] = useState(0)
  const [forwards, setForwards] = useState<ForwardStatusDto[]>([])
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // Key file and passphrase are set once in Options > ADITO > General; no input here.
  const [keyFile, setKeyFile] = useSshKeyPath(api)
  const [pinned, setPinned] = useState<Set<string>>(savedPins)
  useEffect(() => onConfigChange((path) => path[0] === 'tunnels' && setPinned(savedPins())), [])
  const togglePin = useCallback((r: TunnelRowDto) => {
    const next = savedPins()
    const k = pinKey(r)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    configSet(['tunnels', 'pinned'], next.size ? [...next].sort() : undefined)
    setPinned(next)
  }, [])
  const [view, setViewState] = useState<'ports' | 'table'>(savedView)
  const setView = (v: 'ports' | 'table') => {
    setViewState(v)
    // Die Standardansicht (ports) steht nicht in der Datei.
    configSet(['tunnels', 'view'], v === 'table' ? v : undefined)
  }

  const refreshForwards = useCallback(async () => {
    const list = await api.tunnelList().catch(() => [])
    setForwards(list)
    setForwardsUp(list.some((f) => f.up))
  }, [api])

  useAbortableEffect((signal) => {
    api
      .readTunnelConfig(projectRoot, reference)
      .then((r) => {
        if (signal.aborted) return
        setRows(r)
        setError(null)
      })
      .catch((e) => {
        if (!signal.aborted) setError(String(e))
      })
    void refreshForwards()
  }, [api, projectRoot, reference, reload, refreshForwards])

  useEffect(() => {
    const timer = window.setInterval(() => void refreshForwards(), 5000)
    return () => window.clearInterval(timer)
  }, [refreshForwards])

  const upKeys = useMemo(() => new Set(forwards.filter((f) => f.up).map((f) => rowKey(f))), [forwards])
  const foreignOwners = useMemo(() => new Map(forwards.filter((f) => f.owner !== 'designer').map((f) => [rowKey(f), f.owner])), [forwards])
  const localAddrs = useMemo(() => new Map(forwards.map((f) => [rowKey(f), `${f.local_host}:${f.local_port}`])), [forwards])

  const stateOf = useCallback(
    (r: TunnelRowDto): RowState => {
      const k = rowKey(r)
      if (busy.has(k)) return 'busy'
      if (upKeys.has(k) || isTunnelActive(r, db)) return 'up'
      return rowErrors[k] ? 'error' : 'idle'
    },
    [busy, upKeys, db, rowErrors],
  )

  const setBusyFor = (k: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(k)
      else next.delete(k)
      return next
    })

  const connectRow = useCallback(
    async (r: TunnelRowDto) => {
      const k = rowKey(r)
      if (upKeys.has(k) || isTunnelActive(r, db)) return
      setBusyFor(k, true)
      tunnelConnecting(true)
      setRowErrors((prev) => {
        const { [k]: _gone, ...rest } = prev
        return rest
      })
      logOutput('default', `Tunnel ${hostPort(r)}: connecting through ${r.tunnel_host}:${r.tunnel_port} ...`)
      try {
        const status = await api.tunnelConnect(r, keyFile.trim() || null, null)
        logOutput('default', `Tunnel ${hostPort(r)}: open on ${status.local_host}:${status.local_port}`)
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e)
        setRowErrors((prev) => ({ ...prev, [k]: message }))
        setTunnelError(message)
        logOutput('default', `Tunnel ${hostPort(r)}: ${message}`, 'error')
        setError(`Tunnel ${hostPort(r)}: ${message}`)
      } finally {
        tunnelConnecting(false)
        setBusyFor(k, false)
        await refreshForwards()
      }
    },
    [api, db, keyFile, refreshForwards, upKeys],
  )

  const disconnectRow = useCallback(
    async (r: TunnelRowDto) => {
      const k = rowKey(r)
      if (upKeys.has(k)) {
        await api.tunnelDisconnect(r.target_host, r.target_port)
        // Gehört der Tunnel einem anderen Programm (Hub), schließt es ihn selbst: kurz warten, bis er weg ist.
        if (foreignOwners.has(k)) {
          setBusyFor(k, true)
          try {
            for (let i = 0; i < 8; i++) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              if (!(await api.tunnelList().catch(() => [])).some((f) => f.up && rowKey(f) === k)) break
            }
          } finally {
            setBusyFor(k, false)
          }
        }
      } else if (isTunnelActive(r, db)) {
        await api.dbDisconnect()
        onDbChange(await api.dbStatus())
      }
      setRowErrors((prev) => {
        const { [k]: _gone, ...rest } = prev
        return rest
      })
      logOutput('default', `Tunnel ${hostPort(r)}: closed`)
      await refreshForwards()
    },
    [api, db, foreignOwners, onDbChange, refreshForwards, upKeys],
  )

  const toggleRow = (r: TunnelRowDto) => (stateOf(r) === 'up' ? void disconnectRow(r) : void connectRow(r))

  const connectAll = useCallback(async () => {
    setError(null)
    for (const r of rows ?? []) await connectRow(r)
  }, [rows, connectRow])

  const stop = useCallback(async () => {
    await api.tunnelDisconnectAll()
    if (db.tunnel_up) {
      await api.dbDisconnect()
      onDbChange(await api.dbStatus())
    }
    setRowErrors({})
    logOutput('default', 'All tunnels closed')
    await refreshForwards()
  }, [api, db.tunnel_up, onDbChange, refreshForwards])

  const copy = (text: string) => void copyToClipboard(text)

  const refresh = () => {
    setError(null)
    setReload((n) => n + 1)
  }

  const row = rows?.[selected]
  const anyUp = (rows ?? []).some((r) => stateOf(r) === 'up')
  const allUp = (rows ?? []).length > 0 && (rows ?? []).every((r) => stateOf(r) === 'up')
  const anyBusy = busy.size > 0

  const HOST_PORT = /^[^\s:]+:\d{1,5}$/
  const hostPortCheck = (v: string) => (HOST_PORT.test(v.trim()) ? null : 'Enter host:port, for example adito-db:3306')
  const splitHostPort = (v: string): [string, number] => {
    const i = v.trim().lastIndexOf(':')
    return [v.trim().slice(0, i), Number(v.trim().slice(i + 1))]
  }

  async function addTunnel() {
    const target = await promptDialog('Target server of the new tunnel (host:port)', { title: 'Add Tunnel', label: 'Target server', validate: hostPortCheck })
    if (target === null) return
    const [targetHost, targetPort] = splitHostPort(target)
    let base = rows?.[selected] ?? rows?.[0]
    if (!base) {
      const jump = await promptDialog('Tunnel host of the new tunnel (host:port)', { title: 'Add Tunnel', label: 'Tunnel host', validate: hostPortCheck })
      if (jump === null) return
      const user = await promptDialog('User name on the tunnel host', { title: 'Add Tunnel', label: 'User name', validate: (v) => (v.trim() ? null : 'Enter a user name') })
      if (user === null) return
      const [jumpHost, jumpPort] = splitHostPort(jump)
      base = { tunnel_host: jumpHost, tunnel_port: jumpPort, target_host: '', target_port: 0, user: user.trim() }
    }
    try {
      const next = await api.addTunnelRow(projectRoot, reference, { tunnel_host: base.tunnel_host, tunnel_port: base.tunnel_port, target_host: targetHost, target_port: targetPort, user: base.user })
      setRows(next)
      setSelected(next.length - 1)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  async function deleteTunnel() {
    if (!row) return
    if (!(await confirmDialog(`Delete the tunnel to ${hostPort(row)} from the tunnel config file?`, { title: 'Delete Tunnel', okLabel: 'Delete' }))) return
    try {
      const next = await api.deleteTunnelRow(projectRoot, reference, selected)
      setRows(next)
      setSelected(Math.max(0, Math.min(selected, next.length - 1)))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  function pickMenu(id: string) {
    if (id === 'addTunnel') return void addTunnel()
    if (!row) return
    if (id === 'deleteTunnel') return void deleteTunnel()
    if (id === 'connect') void connectRow(row)
    else if (id === 'disconnect') void disconnectRow(row)
    else if (id === 'connectAll') void connectAll()
    else if (id === 'disconnectAll') void stop()
    else if (id === 'copyAddress') copy(row.target_host)
    else if (id === 'copyHostPort') copy(hostPort(row))
    else if (id === 'refresh') refresh()
  }

  return (
    <div className="tunnel-editor">
      <div className="tunnel-toolbar" role="toolbar" aria-label="Tunnel config">
        <Button variant="bare" title="Adds a tunnel to the tunnel config file" aria-label="Add tunnel" onClick={() => void addTunnel()}>
          <Icon name="plus" weight="bold" color="success" />
        </Button>
        <Button variant="bare" aria-label="Stop tunnels" title="Close all open tunnels" isDisabled={!anyUp && !db.tunnel_up} onClick={() => void stop()}>
          <Icon name="stop" weight="fill" color="danger" />
        </Button>
        <Button variant="bare"

          aria-label="Copy tunnel"
          title="Copy the selected tunnel (addresses only)"
          isDisabled={!row}
          onClick={() => row && copy(copyText(row))}
        >
          <Icon name="copy-simple" weight="bold" color="accent" />
        </Button>
        <Button variant="bare" aria-label="Refresh" title="Reload the file and the tunnel states" onClick={refresh}>
          <Icon name="arrows-clockwise" weight="bold" color="cool" />
        </Button>
        <span className="tunnel-view" role="group" aria-label="View">
          <Button variant="bare" aria-pressed={view === 'ports'} className={view === 'ports' ? 'is-active' : undefined} onClick={() => setView('ports')}>
            Ports
          </Button>
          <Button variant="bare" aria-pressed={view === 'table'} className={view === 'table' ? 'is-active' : undefined} onClick={() => setView('table')}>
            Table
          </Button>
        </span>
      </div>
      <TunnelKeyBar api={api} keyFile={keyFile} onKeyFile={setKeyFile} errors={[...(error ? [error] : []), ...Object.values(rowErrors)]} />
      {error ? (
        <p className="forge-field-hint" role="alert">
          {error}
        </p>
      ) : null}
      {rows && view === 'ports' ? (
        <TunnelPorts
          rows={rows}
          stateOf={stateOf}
          localAddrs={localAddrs}
          foreignOwners={foreignOwners}
          errors={rowErrors}
          pinned={pinned}
          onTogglePin={togglePin}
          onConnect={(list) => void (async () => { for (const r of list) await connectRow(r) })()}
          onDisconnect={(list) => void (async () => { for (const r of list) await disconnectRow(r) })()}
          onCopy={copy}
          onBrowser={(url) => void api.openLocalUrl(url).catch((e) => setError(errorText(e)))}
        />
      ) : null}
      {rows && view === 'table' ? (
        <Table className="tunnel-table" aria-label="Tunnels">
          <TableHeader>

              <TableColumn isRowHeader>Status</TableColumn>
              <TableColumn>Tunnel Host Address</TableColumn>
              <TableColumn>Tunnel Host Port</TableColumn>
              <TableColumn>Target Server Address</TableColumn>
              <TableColumn>Target Server Port</TableColumn>
              <TableColumn>Username</TableColumn>

          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const state = stateOf(r)
              const k = rowKey(r)
              const label = { idle: 'Tunnel inactive', busy: 'Tunnel connecting', up: 'Tunnel active', error: 'Tunnel error' }[state]
              const tip = state === 'error' ? rowErrors[k] : state === 'up' ? `Open on ${localAddrs.get(k) ?? '?'}` : label
              return (
                <TableRow
                  key={i}
                  className={i === selected ? 'is-selected' : undefined}
                  aria-selected={i === selected}
                  onClick={() => setSelected(i)}
                  onDoubleClick={() => toggleRow(r)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setSelected(i)
                    setMenu({ x: e.clientX, y: e.clientY })
                  }}
                >
                  <TableCell>
                    <span className={`tunnel-status is-${state}${state === 'up' ? ' is-active' : ''}`} role="img" aria-label={label} title={tip}>
                      <Icon name={STATUS_ICON[state]} weight="bold" />
                    </span>
                  </TableCell>
                  <TableCell>{r.tunnel_host}</TableCell>
                  <TableCell>{r.tunnel_port}</TableCell>
                  <TableCell title={r.target_host}>{r.target_host}</TableCell>
                  <TableCell>{r.target_port}</TableCell>
                  <TableCell>{r.user}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : null}
      {menu && row ? (
        <TreeContextMenu
          entries={buildRowMenu({ rowUp: stateOf(row) === 'up', rowBusy: anyBusy, anyUp, allUp, hasRow: true })}
          x={menu.x}
          y={menu.y}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
