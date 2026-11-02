import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DbStatus, SqlResult } from '../wire/types'
import { Modal } from './Dialogs'

// System Table Control Center (manual 13.2, screenshot 192), read-only: the ASYS_ tables of the
// connected system database with the version information of ASYS_VERSIONHISTORY. Creating,
// upgrading and deleting need the table structures of the ADITO platform, which Vendira Designer
// does not have (manual appendix B), so those buttons stay dimmed. Nothing is written.

// Tables the server needs to start (manual 13.2.5) plus the user table; missing ones show red.
const REQUIRED = ['ASYS_ALIASCONFIG', 'ASYS_SYSTEM', 'ASYS_USERS']
const NOT_AVAILABLE = 'Needs the table structures of the ADITO platform, which Vendira Designer does not have'

interface Row {
  name: string
  exists: boolean
  required: boolean
  version: string
  lastUpgrade: string
  user: string
}

function column(result: SqlResult | null, ...patterns: RegExp[]): number {
  if (!result) return -1
  for (const p of patterns) {
    const i = result.columns.findIndex((c) => p.test(c))
    if (i >= 0) return i
  }
  return -1
}

export function buildRows(tables: string[], history: SqlResult | null): Row[] {
  const nameCol = column(history, /^(TABLE_?NAME|TABLENAME)$/i, /TABLE/i, /^NAME$/i)
  const verCol = column(history, /^(CURRENT_?VERSION|VERSION)$/i, /VERSION/i)
  const dateCol = column(history, /UPGRADE/i, /DATE|TIME/i)
  const userCol = column(history, /USER/i)
  const byName = new Map<string, (string | null)[]>()
  if (history && nameCol >= 0) for (const r of history.rows) if (r[nameCol]) byName.set(String(r[nameCol]).toUpperCase(), r)
  const names = new Set(tables.map((t) => t.toUpperCase()).filter((t) => t.startsWith('ASYS_')))
  for (const r of REQUIRED) names.add(r)
  return [...names]
    .sort((a, b) => {
      const ma = tables.some((t) => t.toUpperCase() === a) ? 1 : 0
      const mb = tables.some((t) => t.toUpperCase() === b) ? 1 : 0
      return ma - mb || a.localeCompare(b)
    })
    .map((name) => {
      const hist = byName.get(name)
      const exists = tables.some((t) => t.toUpperCase() === name)
      return {
        name,
        exists,
        required: REQUIRED.includes(name),
        version: hist && verCol >= 0 ? (hist[verCol] ?? '') : '',
        lastUpgrade: hist && dateCol >= 0 ? (hist[dateCol] ?? '') : '',
        user: hist && userCol >= 0 ? (hist[userCol] ?? '') : '',
      }
    })
}

export function TableCenterDialog({ api, db, onClose }: { api: ForgeApi; db: DbStatus; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyNote, setHistoryNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    setHistoryNote(null)
    try {
      const tables = (await api.dbSchema()).map((t) => t.name)
      let history: SqlResult | null = null
      if (tables.some((t) => t.toUpperCase() === 'ASYS_VERSIONHISTORY')) {
        try {
          history = await api.dbQuery('SELECT * FROM ASYS_VERSIONHISTORY', false)
        } catch (e) {
          setHistoryNote(`The version history could not be read: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        setHistoryNote('ASYS_VERSIONHISTORY does not exist in this database, so no version information is available.')
      }
      setRows(buildRows(tables, history))
    } catch (e) {
      setRows(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  useEffect(() => {
    if (db.connected) void load()
  }, [db.connected, load, tick])

  const current = useMemo(() => rows?.find((r) => r.name === selected) ?? null, [rows, selected])
  const problems = rows?.filter((r) => !r.exists && r.required).length ?? 0

  return (
    <Modal
      title="System Table Control Center"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="forge-tablecenter">
        {!db.connected ? (
          <p className="forge-field-hint">Connect to a system database in the Services tab first.</p>
        ) : (
          <>
            <div className="forge-tablecenter-bar" role="toolbar" aria-label="System table actions">
              <button type="button" disabled title={`Create optional tables - ${NOT_AVAILABLE}`} aria-label="Create optional tables">
                +
              </button>
              <button type="button" disabled title="Delete the selected tables - not offered: dropping system tables cannot be undone" aria-label="Delete tables">
                -
              </button>
              <button type="button" disabled title={`Resolve problems - ${NOT_AVAILABLE}`} aria-label="Resolve problems">
                ✧
              </button>
              <button type="button" onClick={() => setTick((t) => t + 1)} title="Refresh" aria-label="Refresh">
                ↻
              </button>
            </div>
            {error ? (
              <p className="forge-field-error" role="alert">
                {error}
              </p>
            ) : null}
            {historyNote ? <p className="forge-field-hint">{historyNote}</p> : null}
            {rows ? (
              <div className="forge-tablecenter-split">
                <ul className="forge-tablecenter-list" aria-label="System tables">
                  {rows.map((r) => (
                    <li key={r.name} className={`${!r.exists && r.required ? 'is-problem' : ''}${r.name === selected ? ' is-selected' : ''}`} onClick={() => setSelected(r.name)}>
                      {r.name}
                    </li>
                  ))}
                </ul>
                <div className="forge-tablecenter-info" aria-label="Table information">
                  {current ? (
                    <>
                      <h3>{current.name}</h3>
                      {!current.exists ? <p className="forge-field-error">The table is missing{current.required ? ' but required: the server cannot start without it.' : '.'}</p> : null}
                      <dl>
                        <dt>Current Version</dt>
                        <dd>{current.version}</dd>
                        <dt>Available Version</dt>
                        <dd />
                        <dt>Last Upgrade</dt>
                        <dd>{current.lastUpgrade}</dd>
                        <dt>User</dt>
                        <dd>{current.user}</dd>
                      </dl>
                      <p className="forge-field-hint">The available version is not known to Vendira Designer.</p>
                    </>
                  ) : (
                    <p className="forge-field-hint">{problems > 0 ? `${problems} required table(s) are missing.` : 'Select a table.'}</p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  )
}
