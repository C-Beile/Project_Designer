import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { SchemaTable } from '../wire/types'
import { TunnelGlyph } from '../tree/TunnelGlyph'
import { useTunnelState, systemNameOf, projectOfPath } from './tunnelState'
import { closeSystemTunnel } from './useSystemTunnels'
import { errorText } from '../core/errorText'

// Services tab: project > system > database alias (System_alias, Data_alias ...) > tables. Every
// open session of the tunnel state shows up by itself; tables are read when an alias is opened and
// can be filtered. A click on a table opens an SQL tab for exactly that database.

const ALIAS_MARK = '|alias:'

interface AliasEntry {
  sessionKey: string
  label: string
  kind: 'system' | 'data'
  database: string | null
  host: string | null
}
interface SystemEntry {
  systemKey: string
  name: string
  aliases: AliasEntry[]
}
interface ProjectEntry {
  project: string
  label: string
  systems: SystemEntry[]
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Groups the open sessions: the plain key is the system alias, `key|alias:Name` another database alias. */
export function groupSessions(bySystem: Record<string, { connected: boolean; tunnel_up: boolean; database: string | null; host: string | null }>): ProjectEntry[] {
  const projects = new Map<string, Map<string, SystemEntry>>()
  const entryOf = (key: string): SystemEntry => {
    const at = key.lastIndexOf('|')
    const project = key.slice(0, at)
    const systems = projects.get(project) ?? new Map<string, SystemEntry>()
    projects.set(project, systems)
    const name = key.slice(at + 1)
    const found = systems.get(key) ?? { systemKey: key, name, aliases: [] }
    systems.set(key, found)
    return found
  }
  for (const [key, st] of Object.entries(bySystem)) {
    // The background systems (dev1_bg ...) mirror their main system and stay out of the view.
    if (key === '' || !st.connected || /_bg$/i.test(systemNameOf(key.split(ALIAS_MARK)[0]))) continue
    const i = key.indexOf(ALIAS_MARK)
    if (i < 0) entryOf(key).aliases.push({ sessionKey: key, label: 'System_alias', kind: 'system', database: st.database, host: st.host })
    else entryOf(key.slice(0, i)).aliases.push({ sessionKey: key, label: key.slice(i + ALIAS_MARK.length), kind: 'data', database: st.database, host: st.host })
  }
  return [...projects.entries()].map(([project, systems]) => ({
    project,
    label: baseName(project),
    systems: [...systems.values()]
      .map((s) => ({ ...s, aliases: s.aliases.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'system' ? -1 : 1)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`svt-chevron${open ? ' is-open' : ''}`} viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
      <path d="M2 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DbGlyph({ kind }: { kind: 'system' | 'data' }) {
  return (
    <svg className={`svt-db svt-db-${kind}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <ellipse cx="8" cy="3.8" rx="5" ry="2.1" fill="currentColor" />
      <path d="M3 3.8v8.4c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V3.8c0 1.2-2.2 2.1-5 2.1S3 5 3 3.8z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function AliasNode({ api, alias, onOpenSql }: { api: ForgeApi; alias: AliasEntry; onOpenSql: (sql: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tables, setTables] = useState<SchemaTable[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    void (async () => {
      await api.dbActivate(alias.sessionKey).catch(() => false)
      return api.dbSchema()
    })()
      .then((t) => !cancelled && setTables(t))
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, alias.sessionKey, open, tick])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (tables ?? []).filter((t) => !f || t.name.toLowerCase().includes(f))
  }, [tables, filter])

  const openTable = (name: string) => {
    void api.dbActivate(alias.sessionKey).catch(() => false).then(() => onOpenSql(`SELECT * FROM \`${name}\` LIMIT 100`))
  }

  return (
    <li role="treeitem" aria-expanded={open} className="svt-alias">
      <div className="svt-row svt-alias-row" onClick={() => setOpen((v) => !v)}>
        <Chevron open={open} />
        <DbGlyph kind={alias.kind} />
        <span className="svt-name">{alias.label}</span>
        <span className="svt-meta" title={alias.host ? `jdbc:mariadb://${alias.host}` : undefined}>
          {alias.database ?? ''}
        </span>
        <span className="svt-grow" />
        {open && tables ? <span className="svt-count">{tables.length}</span> : null}
        <button
          type="button"
          className="svt-icon-btn"
          title="Open SQL editor for this alias"
          aria-label={`Open SQL for ${alias.label}`}
          onClick={(e) => {
            e.stopPropagation()
            void api.dbActivate(alias.sessionKey).catch(() => false).then(() => onOpenSql(''))
          }}
        >
          SQL
        </button>
        <button
          type="button"
          className="svt-icon-btn"
          title="Read the tables again"
          aria-label={`Refresh ${alias.label}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
            setTick((n) => n + 1)
          }}
        >
          ↻
        </button>
      </div>
      {open ? (
        <div className="svt-tables">
          {error ? (
            <p className="forge-field-error" role="alert">
              {error}
            </p>
          ) : null}
          {tables === null && !error ? <p className="forge-field-hint">Reading tables...</p> : null}
          {tables && tables.length > 12 ? <input className="svt-filter" type="search" placeholder="Filter tables" aria-label={`Filter tables of ${alias.label}`} value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
          <ul role="group" aria-label={`Tables of ${alias.label}`}>
            {shown.map((t) => (
              <li key={`${t.schema}.${t.name}`} role="treeitem" aria-selected="false">
                <button type="button" className="svt-table" title={`SELECT * FROM ${t.name}`} onClick={() => openTable(t.name)}>
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M2 3h12v10H2zM2 6.5h12M6 6.5V13" fill="none" stroke="currentColor" strokeWidth="1.1" />
                  </svg>
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
          {tables && shown.length === 0 ? <p className="forge-field-hint">No tables.</p> : null}
        </div>
      ) : null}
    </li>
  )
}

/** Name of a project as written on disk; the session keys only know it in the lower case form used for comparing paths. */
function projectNameOf(key: string, projects: string[]): string {
  const real = projectOfPath(projects, key)
  return baseName(real ?? key)
}

export function ServicesTree({ api, onOpenSql, projects = [] }: { api: ForgeApi; onOpenSql: (sql: string) => void; projects?: string[] }) {
  const { bySystem } = useTunnelState()
  const groups = useMemo(() => groupSessions(bySystem).map((g) => ({ ...g, label: projectNameOf(g.project, projects) })), [bySystem, projects])
  const [tunnelsOpen, setTunnelsOpen] = useState(true)
  const closeSystem = (systemKey: string, sessions: string[]) => {
    void closeSystemTunnel(api, systemKey, sessions)
  }
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const toggle = (k: string) =>
    setOpened((prev) => {
      const next = new Set(prev)
      if (!next.delete(k)) next.add(k)
      return next
    })

  if (groups.length === 0) return null
  const tunnelCount = groups.reduce((n, g) => n + g.systems.length, 0)
  return (
    <ul className="svt" role="tree" aria-label="Database connections">
      <li role="treeitem" aria-expanded="true" className="svt-root">
        <div className="svt-row svt-root-row">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="svt-db">
            <ellipse cx="8" cy="3.8" rx="5" ry="2.1" fill="currentColor" />
            <path d="M3 3.8v8.4c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V3.8c0 1.2-2.2 2.1-5 2.1S3 5 3 3.8z" fill="currentColor" opacity="0.6" />
          </svg>
          <strong className="svt-name">Databases</strong>
          <span className="svt-meta">{tunnelCount} {tunnelCount === 1 ? 'connection' : 'connections'}</span>
        </div>
      <ul role="group">
      {groups.map((p) => (
        <li key={p.project} role="treeitem" aria-expanded={opened.has(p.project)}>
          <div className="svt-row svt-project-row" onClick={() => toggle(p.project)}>
            <Chevron open={opened.has(p.project)} />
            <strong className="svt-name">{p.label}</strong>
          </div>
          {!opened.has(p.project) ? null : (
            <ul role="group">
              {p.systems.map((s) => (
                <li key={s.systemKey} role="treeitem" aria-expanded={opened.has(s.systemKey)}>
                  <div className="svt-row svt-system-row" onClick={() => toggle(s.systemKey)}>
                    <Chevron open={opened.has(s.systemKey)} />
                    <span className="svt-dot" aria-hidden="true" />
                    <span className="svt-name">{systemNameOf(s.systemKey)}</span>
                    <span className="svt-meta">{s.aliases.length} {s.aliases.length === 1 ? 'database' : 'databases'}</span>
                    <span className="svt-grow" />
                    <button
                      type="button"
                      className="svt-icon-btn"
                      title={`Close the connections and the tunnel of ${systemNameOf(s.systemKey)}`}
                      aria-label={`Disconnect ${systemNameOf(s.systemKey)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        closeSystem(s.systemKey, s.aliases.map((a) => a.sessionKey))
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {!opened.has(s.systemKey) ? null : (
                    <ul role="group">
                      {s.aliases.map((a) => (
                        <AliasNode key={a.sessionKey} api={api} alias={a} onOpenSql={onOpenSql} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      </ul>
      </li>
      <li role="treeitem" aria-expanded={tunnelsOpen} className="svt-root">
        <div className="svt-row svt-root-row" title="The tunnels are opened with the tunnel button of a system in the Projects tree" onClick={() => setTunnelsOpen((v) => !v)}>
          <Chevron open={tunnelsOpen} />
          <TunnelGlyph size={14} />
          <strong className="svt-name">Tunnel</strong>
          <span className="svt-meta">{tunnelCount} open</span>
        </div>
        {tunnelsOpen ? (
          <ul role="group" aria-label="Open tunnels">
            {groups.flatMap((g) =>
              g.systems.map((s) => (
                <li key={s.systemKey} role="treeitem" className="svt-tunnel">
                  <div className="svt-row svt-tunnel-row">
                    <span className="svt-dot" aria-hidden="true" />
                    <span className="svt-name">{systemNameOf(s.systemKey)}</span>
                    <span className="svt-meta">{g.label}</span>
                    <span className="svt-grow" />
                    <button type="button" className="svt-icon-btn" title={`Close the tunnel and the connections of ${systemNameOf(s.systemKey)} (${g.label})`} aria-label={`Close ${systemNameOf(s.systemKey)} of ${g.label}`} onClick={() => closeSystem(s.systemKey, s.aliases.map((a) => a.sessionKey))}>
                      Close
                    </button>
                  </div>
                </li>
              )),
            )}
          </ul>
        ) : null}
      </li>
    </ul>
  )
}
