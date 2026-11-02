import { useEffect, useRef, useState } from 'react'
import { useTunnelState, setTunnelError, setConnectedSystem, tunnelConnecting, requestSystemReload, systemKey, systemFacts, UNCONFIGURED_HINT } from '../services/tunnelState'
import { useSshKeyPath } from '../settings/sshKey'
import { resolvePathVariables } from '../properties/pathVariables'
import type { EditorProps } from './registry'
import type { AliasConfigDto } from '../wire/types'
import { SystemAliasConfigs } from '../services/UsersTable'
import { textField } from '../wire/types'
import { AliasIcon } from './aliasIcons'
import { useProjectIndex } from './projectIndex'
import { TreeContextMenu } from '../tree/TreeContextMenu'

// System editor (original Designer, shots 43 and 87): every alias config of the system as a
// two-column list Icon | Config (name, type line, JDBC URL right-aligned for database aliases). The
// list is read from the system database (ASYS_ALIASCONFIG); without a connection the editor shows
// "Connection to database unavailable." like the original. The selected alias is shown below with
// its property groups. Passwords are always masked; their values are never sent to the UI. The raw
// table is only a diagnosis aid inside a collapsed section.

export { AliasIcon }

export function SystemEditor({ nodeId, projectRoot, tree, api }: EditorProps) {
  const reference = textField(tree, 'serverConfigPath') ?? ''
  const name = textField(tree, 'name') ?? ''
  const [configs, setConfigs] = useState<AliasConfigDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const index = useProjectIndex()
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; alias: string } | null>(null)
  const tunnel = useTunnelState()
  const key = systemKey(projectRoot, name)
  const facts = systemFacts(key, tunnel)
  const progress = tunnel.progressBy[key] ?? null
  const [, setSecond] = useState(0)
  useEffect(() => {
    if (!progress) return
    const t = setInterval(() => setSecond((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [progress])
  const db = tunnel.bySystem[key] ?? { connected: false, tunnel_up: false, database: null, host: null }
  const [keyFile] = useSshKeyPath(api)
  const [showDetails, setShowDetails] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const [diagnosisOpen, setDiagnosisOpen] = useState(false)
  const [outdated, setOutdated] = useState(false)
  const tunnelRef = textField(tree, 'tunnelConfigPath') ?? ''

  // The system database is read again as soon as the tunnel stands and whenever the system is clicked.
  useEffect(() => {
    api.dbStatus(key).then((s) => (s.connected !== db.connected ? requestSystemReload() : undefined)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, nodeId])

  async function reconnect() {
    setReconnecting(true)
    setReconnectError(null)
    tunnelConnecting(true, key)
    try {
      const tunnelPath = resolvePathVariables('tunnelConfigPath', tunnelRef, { projectHome: projectRoot })
      const serverPath = resolvePathVariables('serverConfigPath', reference, { projectHome: projectRoot })
      if (!tunnelRef || !reference) throw new Error('tunnelConfigPath and serverConfigPath of this system must be set to reconnect.')
      if (tunnelPath.unresolved.length > 0 || serverPath.unresolved.length > 0) throw new Error('The config paths contain variables that cannot be resolved here.')
      await api.dbConnect(tunnelPath.resolved, serverPath.resolved, keyFile.trim() || null, null, key)
      setConnectedSystem(key)
      requestSystemReload()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setReconnectError(message)
      setTunnelError(message, key)
    } finally {
      tunnelConnecting(false, key)
      setReconnecting(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setConfigs(null)
    setError(null)
    setOutdated(false)
    if (!db.connected) return
    ;(async () => {
      await api.dbActivate(key).catch(() => false)
      const ids = await api.systemServerIds(reference, name).catch(() => [] as string[])
      let list: AliasConfigDto[]
      try {
        list = await api.systemAliasList(ids)
      } catch (e) {
        if (!reference) throw e
        list = await api.readAliasConfigs(projectRoot, reference)
        if (!cancelled) setError(`The alias configs could not be read from the system database (${e instanceof Error ? e.message : String(e)}); showing the server config file instead.`)
      }
      if (!cancelled) setConfigs(list)
      const plan = await api.deployPlan(projectRoot, false, null).catch(() => null)
      if (!cancelled && plan) setOutdated(plan.outdated)
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectRoot, reference, name, nodeId, db.connected, tunnel.reload])

  // A tunnel opened elsewhere (tunnel editor) makes this editor read the system database right away.
  const autoTried = useRef(false)
  useEffect(() => {
    if (!tunnel.forwardsUp && !facts.tunnelOpen) {
      autoTried.current = false
      return
    }
    if (!db.connected && !reconnecting && !autoTried.current) {
      autoTried.current = true
      void reconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunnel.forwardsUp, facts.tunnelOpen, db.connected])

  const current = configs?.find((c) => c.name === selected) ?? null

  const choose = (alias: string) => {
    setSelected(alias)
    const config = configs?.find((c) => c.name === alias)
    if (config) index?.selectAliasConfig?.(config, name)
  }
  const openAlias = (alias: string) => index?.openAliasConfig?.({ key, system: name, alias, reference })
  const openDatabase = (alias: string) => index?.openAliasConfig?.({ key, system: name, alias, reference, browse: true, tunnelConfig: resolvePathVariables('tunnelConfigPath', tunnelRef, { projectHome: projectRoot }).resolved })
  const isDatabase = (alias: string) => !!configs?.find((c) => c.name === alias)?.jdbc_url
  const openDefault = (alias: string) => (isDatabase(alias) ? openDatabase(alias) : openAlias(alias))
  const moveSelection = (delta: number) => {
    if (!configs || configs.length === 0) return
    const at = configs.findIndex((c) => c.name === selected)
    const next = Math.min(configs.length - 1, Math.max(0, (at < 0 ? (delta > 0 ? -1 : configs.length) : at) + delta))
    choose(configs[next].name)
  }

  if (!db.connected) {
    return (
      <div className="system-editor" aria-label={`System ${name}`}>
        {!reference ? <p className="forge-field-hint">serverConfigPath is empty; set it in Properties.</p> : null}
        <div className="system-db-unavailable" role="status" aria-label="Database unavailable">
          <span className="system-db-icon" aria-hidden="true">
            {'⛁'}
            <span className="system-db-banned">{'⃠'}</span>
          </span>
          {progress ? (
            <p role="status">
              <span className="forge-spinner" aria-hidden="true" /> Connecting to {name}... {progress.phase} ({Math.round((Date.now() - progress.startedAt) / 1000)} s)
            </p>
          ) : (
            <p>Connection to database unavailable.</p>
          )}
          <div className="system-db-buttons">
            <button type="button" disabled={reconnecting || !!progress || !tunnelRef || !reference} title={!tunnelRef || !reference ? UNCONFIGURED_HINT : undefined} onClick={() => void reconnect()}>
              {reconnecting || progress ? 'Connecting...' : 'Reconnect'}
            </button>
            {progress ? (
              <button type="button" onClick={() => void api.dbCancelConnect()}>
                Cancel
              </button>
            ) : null}
            <button type="button" onClick={() => setShowDetails((v) => !v)}>
              Details...
            </button>
          </div>
          {showDetails ? (
            <pre className="forge-error-detail" aria-label="Connection details">
              {reconnectError ?? facts.error ?? (facts.tunnelOpen ? 'The tunnel to the database is open; the database session is being opened.' : 'No tunnel is open. Open it with Reconnect, in the Services tab or in the tunnel config editor.')}
            </pre>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="system-editor system-editor-list" aria-label={`System ${name}`}>
      {error ? <p className="forge-field-hint" role="alert">{error}</p> : null}
      {configs === null && !error ? <p className="forge-field-hint">Please Wait…</p> : null}
      {configs ? (
        <>
          <div className="alias-table" role="grid" aria-label="Alias configs">
            <div className="alias-head" role="row">
              <span role="columnheader">Icon</span>
              <span role="columnheader">Config</span>
              <button type="button" className="alias-refresh" title="Reads ASYS_ALIASCONFIG again" aria-label="Refresh alias configs" onClick={() => requestSystemReload()}>
                {'↻'}
              </button>
            </div>
            <div className="alias-body">
              {configs.map((c) => (
                <div
                  key={c.name}
                  role="row"
                  tabIndex={0}
                  aria-selected={c.name === selected}
                  className={`alias-row${c.name === selected ? ' is-selected' : ''}`}
                  onClick={() => choose(c.name)}
                  onDoubleClick={() => openDefault(c.name)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    choose(c.name)
                    setRowMenu({ x: e.clientX, y: e.clientY, alias: c.name })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (c.name === selected) openDefault(c.name)
                      else choose(c.name)
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      moveSelection(e.key === 'ArrowDown' ? 1 : -1)
                      const rows = (e.currentTarget.parentElement?.querySelectorAll('[role="row"]') ?? []) as NodeListOf<HTMLElement>
                      const at = Array.from(rows).indexOf(e.currentTarget)
                      rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
                    }
                  }}
                >
                  <span role="gridcell" className="alias-cell-icon">
                    <AliasIcon icon={c.icon} />
                  </span>
                  <span role="gridcell" className="alias-cell-text">
                    <span className="alias-name">{c.name}</span>
                    <span className="alias-type">{c.type_label}</span>
                  </span>
                  {c.jdbc_url ? <span className="alias-url">{c.jdbc_url}</span> : null}
                </div>
              ))}
            </div>
          </div>
          {rowMenu ? (
            <TreeContextMenu
              entries={[
                { id: 'open', label: 'Open', enabled: !!index?.openAliasConfig },
                { id: 'openDb', label: 'Open Database', enabled: isDatabase(rowMenu.alias) && !!index?.openAliasConfig, hint: 'Only database aliases have a database to browse' },
                { id: 'refresh', label: 'Refresh', enabled: true },
              ]}
              x={rowMenu.x}
              y={rowMenu.y}
              onPick={(id) => {
                if (id === 'open') openAlias(rowMenu.alias)
                else if (id === 'openDb') openDatabase(rowMenu.alias)
                else if (id === 'refresh') requestSystemReload()
              }}
              onClose={() => setRowMenu(null)}
            />
          ) : null}
          {outdated ? (
            <p className="alias-outdated" role="status">
              View is outdated. Deploy necessary.
            </p>
          ) : null}
          {current ? (
            <details className="alias-detail-fold">
              <summary>Properties of {current.name}</summary>
            <div className="alias-detail" aria-label={`${current.name} properties`}>
              <strong>{current.name}</strong> <span className="alias-type">({current.type_label})</span>
              {current.groups.map((g) => (
                <div key={g.label} className="alias-group">
                  <div className="alias-group-label">{g.label}:</div>
                  {g.props.map((p) => (
                    <div key={p.name} className="alias-prop">
                      <span className="alias-prop-name">{p.name}</span>
                      <span className="alias-prop-value">{p.secret ? '•'.repeat(12) : p.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            </details>
          ) : null}
        </>
      ) : null}
      <details className="system-diagnosis" onToggle={(e) => setDiagnosisOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Diagnosis: raw ASYS_ALIASCONFIG</summary>
        {diagnosisOpen ? (
          <>
            <SystemAliasConfigs api={api} db={db} reload={tunnel.reload} />
          </>
        ) : null}
      </details>
    </div>
  )
}
