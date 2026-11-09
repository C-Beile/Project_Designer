import { useMemo, useState } from 'react'
import type { LiquibaseConnection } from '../api/ForgeApi'
import { Modal } from '../core/Modal'

// "Select Database Connection", as in the original Designer: the connection the update goes to, the
// contexts, the choice to run from the transpiled directory (dist) and a button for a partial
// transpile. The connections are shown readable: alias, database and a shortened host; the full URL
// stands below the list.

export interface LiquibaseChoice {
  connection: LiquibaseConnection
  useDist: boolean
}

/** `adito-db.dev-fz-juelich-1-htc1-adito-cloud.svc.cluster.local` -> `adito-db.dev-fz-juelich-1`. */
export function shortHost(host: string): string {
  return host.replace(/\.svc\.cluster\.local$/, '').replace(/-htc1-adito-cloud$/, '').replace(/\.htc1\.adito\.cloud$/, '')
}

export function jdbcUrl(c: LiquibaseConnection): string {
  return `jdbc:mariadb://${c.host}:${c.port}/${c.database}`
}

const optionLabel = (c: LiquibaseConnection) => `${c.alias}  -  ${c.database}  @  ${shortHost(c.host)}${c.reachable ? '' : '  (no tunnel)'}`

export function SelectDatabaseConnectionDialog({
  connections,
  preferredAlias,
  title,
  onOk,
  onCancel,
  onTranspile,
}: {
  connections: LiquibaseConnection[]
  /** The connection of this alias is selected first. */
  preferredAlias?: string
  title: string
  onOk: (choice: LiquibaseChoice) => void
  onCancel: () => void
  onTranspile?: () => Promise<boolean>
}) {
  const [showAll, setShowAll] = useState(false)
  const [useDist, setUseDist] = useState(false)
  const [transpiling, setTranspiling] = useState(false)
  const [transpiled, setTranspiled] = useState(false)
  const anyReachable = connections.some((c) => c.reachable)
  const visible = useMemo(() => (showAll || !anyReachable ? connections : connections.filter((c) => c.reachable || c.alias === preferredAlias)), [connections, showAll, anyReachable, preferredAlias])
  const first = Math.max(0, visible.findIndex((c) => c.alias === preferredAlias))
  const [picked, setPicked] = useState<string | null>(null)
  const selected = visible.find((c) => `${c.alias}|${c.host}|${c.database}` === picked) ?? visible[first] ?? null

  return (
    <Modal
      title="Select Database Connection"
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={!selected} onClick={() => selected && onOk({ connection: selected, useDist: useDist || transpiled })}>
            OK
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <p>{title}</p>
      {connections.length === 0 ? (
        <p className="forge-field-error" role="alert">
          The system knows no database connection.
        </p>
      ) : (
        <>
          <select
            aria-label="Database connection"
            value={selected ? `${selected.alias}|${selected.host}|${selected.database}` : ''}
            onChange={(e) => setPicked(e.target.value)}
            style={{ width: '100%' }}
          >
            {visible.map((c) => (
              <option key={`${c.alias}|${c.host}|${c.database}`} value={`${c.alias}|${c.host}|${c.database}`}>
                {optionLabel(c)}
              </option>
            ))}
          </select>
          <label className="forge-field">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> <span>Show all connections</span>
          </label>
          {selected ? (
            <p className="forge-field-hint" aria-label="Connection URL" style={{ wordBreak: 'break-all', userSelect: 'text' }}>
              {jdbcUrl(selected)}
            </p>
          ) : null}
          <p>Available Contexts:</p>
          <label className="forge-field">
            <input type="checkbox" checked disabled readOnly /> <span>default</span>
          </label>
          <label className="forge-field">
            <input type="checkbox" checked={useDist} onChange={(e) => setUseDist(e.target.checked)} />{' '}
            <span>Execute in transpiled directory (dist). The project is not transpiled first, so changes made since the last transpile are not part of the update.</span>
          </label>
          {onTranspile ? (
            <button
              type="button"
              disabled={transpiling}
              onClick={() => {
                setTranspiling(true)
                void onTranspile()
                  .then((ok) => setTranspiled(ok))
                  .finally(() => setTranspiling(false))
              }}
            >
              {transpiling ? 'Transpiling…' : transpiled ? 'Partial Transpile (done)' : 'Partial Transpile'}
            </button>
          ) : null}
        </>
      )}
    </Modal>
  )
}
