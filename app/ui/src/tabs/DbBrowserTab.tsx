import { useCallback, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { useTunnelState } from '../services/tunnelState'
import { useProjectIndex } from '../editors/projectIndex'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { promptDialog } from '../core/dialogService'
import { parseAliasConfigRef } from './AliasConfigTab'
import { CATALOG_SQL, PROCEDURES_SQL, TABLES_SQL, changelogFor, columnInfos, columnsSql, foreignKeyInfos, foreignKeysSql, indexInfos, indexesSql, viewDataSql, type ColumnInfo, type ForeignKeyInfo, type IndexInfo } from './dbBrowserSql'
import { setSystemsDb } from '../services/tunnelState'
import { errorText } from '../core/errorText'
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, TextArea } from '../core/ui/controls'
import { copyText } from '../core/clipboard'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

// "Database" tab of a database alias (original Designer, shots 95-98): tree Alias > Catalog >
// Tables / Views, columns of the selected table on the right. The tree is loaded lazily: the table
// list once, the columns only when a table is selected. Everything is read-only; View Data and
// Execute Command open an SQL tab, Generate Changelog only shows text. The entries that would change
// the database stay dimmed.

interface TableRow {
  name: string
  view: boolean
}

const WRITES_NOT_BUILT = 'Changing the database from here is not built; the original needs a confirmed, tested write path first'

export function DbBrowserTab({ api, path }: { api: ForgeApi; path: string | undefined }) {
  const ref = parseAliasConfigRef(path)
  const tunnel = useTunnelState()
  const index = useProjectIndex()
  const up = ref ? !!tunnel.bySystem[ref.key]?.connected : false
  const isSystemAlias = !ref || /systemalias/i.test(ref.alias)
  const sessionKey = ref ? (isSystemAlias ? ref.key : `${ref.key}|alias:${ref.alias}`) : ''
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null)
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[] | null>(null)
  const [procedures, setProcedures] = useState<string[] | null>(null)
  const [catalog, setCatalog] = useState<string | null>(null)
  const [tables, setTables] = useState<TableRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null)
  const [filter, setFilter] = useState('')
  const [reload, setReload] = useState(0)
  const [menu, setMenu] = useState<{ x: number; y: number; table: string } | null>(null)
  const [changelog, setChangelog] = useState<string | null>(null)

  useAbortableEffect((signal) => {
    setTables(null)
    setError(null)
    if (!ref || !up) return
    ;(async () => {
      if (!isSystemAlias && !tunnel.bySystem[sessionKey]?.connected) {
        if (!ref.tunnelConfig) throw new Error('The tunnel config of this system is not known; open the browser from the system editor.')
        // The alias has one config per server id; the one of this system must win over `default` (localhost).
        const serverIds = await api.systemServerIds(ref.reference, ref.system).catch(() => [] as string[])
        await api.dbConnectAlias(ref.key, ref.alias, ref.tunnelConfig, serverIds)
        setSystemsDb(await api.dbSystems())
      }
      await api.dbActivate(sessionKey).catch(() => false)
      const [cat, list] = await Promise.all([api.dbQuery(CATALOG_SQL, false), api.dbQuery(TABLES_SQL, false)])
      if (signal.aborted) return
      setCatalog(cat.rows[0]?.[0] ?? null)
      setTables(list.rows.map((r) => ({ name: r[0] ?? '', view: (r[1] ?? '').toUpperCase().includes('VIEW') })))
    })().catch((e) => {
      if (!signal.aborted) setError(errorText(e))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, up, reload])

  useAbortableEffect((signal) => {
    setColumns(null)
    setIndexes(null)
    setForeignKeys(null)
    if (!selected || !up) return
    void api.dbActivate(sessionKey).catch(() => false)
    api
      .dbQuery(indexesSql(selected), false)
      .then((r) => !signal.aborted && setIndexes(indexInfos(r.rows)))
      .catch(() => !signal.aborted && setIndexes([]))
    api
      .dbQuery(foreignKeysSql(selected), false)
      .then((r) => !signal.aborted && setForeignKeys(foreignKeyInfos(r.rows)))
      .catch(() => !signal.aborted && setForeignKeys([]))
    api
      .dbQuery(columnsSql(selected), false)
      .then((r) => !signal.aborted && setColumns(columnInfos(r.rows)))
      .catch((e) => !signal.aborted && setError(errorText(e)))
  }, [api, selected, up, sessionKey])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return (tables ?? []).filter((t) => (f ? t.name.toLowerCase().includes(f) : true))
  }, [tables, filter])
  const realTables = visible.filter((t) => !t.view)
  const views = visible.filter((t) => t.view)

  const menuEntries = (table: string): MenuEntry[] => {
    const isView = tables?.find((t) => t.name === table)?.view ?? false
    return [
      { id: 'viewData', label: 'View Data...', enabled: !!viewDataSql(table) && !!index?.openSql, hint: 'Not available for this table name' },
      { id: 'execute', label: 'Execute Command...', enabled: !!index?.openSql },
      { id: 'changelog', label: 'Generate Changelog...', enabled: !isView, hint: 'A changelog is generated for tables only' },
      { id: 'sep-1', label: '', enabled: false, separator: true },
      { id: 'addColumn', label: 'Add Column...', enabled: false, hint: WRITES_NOT_BUILT },
      { id: 'refresh', label: 'Refresh', enabled: true },
      { id: 'delete', label: 'Delete', enabled: false, hint: WRITES_NOT_BUILT },
      { id: 'sep-2', label: '', enabled: false, separator: true },
      { id: 'grab', label: 'Grab Structure...', enabled: false, hint: 'The target of the original is not documented' },
      { id: 'recreate', label: 'Recreate Table...', enabled: false, hint: WRITES_NOT_BUILT },
      { id: 'properties', label: 'Properties', enabled: false, hint: 'Shown below the columns of the selected table' },
    ]
  }

  const pick = useCallback(
    async (id: string, table: string) => {
      if (id === 'refresh') {
        setReload((n) => n + 1)
        setColumns(null)
      } else if (id === 'viewData') {
        const sql = viewDataSql(table)
        if (sql) index?.openSql?.(sql, sessionKey)
      } else if (id === 'execute') index?.openSql?.('', sessionKey)
      else if (id === 'changelog') {
        const cols = (await api.dbQuery(columnsSql(table), false).then((r) => columnInfos(r.rows)).catch(() => null)) ?? []
        const author = await promptDialog('Author of the changeset', { title: 'Generate Changelog', label: 'Author', initial: 'c.beile' })
        if (author === null) return
        const d = new Date()
        const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
        setChangelog(changelogFor(table, cols, author.trim(), date))
      }
    },
    [api, index, sessionKey],
  )

  if (!ref) return <p className="forge-field-error">The database reference of this tab is unreadable.</p>
  if (!up) return <p className="forge-field-hint">Connection to the database of {ref.system} unavailable. Open its tunnel in the system editor.</p>

  const row = (t: TableRow) => (
    <li
      key={t.name}
      role="treeitem"
      aria-selected={t.name === selected}
      tabIndex={0}
      className={`dbb-table${t.name === selected ? ' is-selected' : ''}`}
      onClick={() => setSelected(t.name)}
      onKeyDown={(e) => e.key === 'Enter' && setSelected(t.name)}
      onContextMenu={(e) => {
        e.preventDefault()
        setSelected(t.name)
        setMenu({ x: e.clientX, y: e.clientY, table: t.name })
      }}
    >
      {t.name}
    </li>
  )

  return (
    <div className="dbb" aria-label={`${ref.alias} database`}>
      <div className="dbb-tree">
        <Input aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="dbb-root">{ref.alias}</div>
        <div className="dbb-catalog">Catalog: {catalog ?? '...'}</div>
        {error ? <p className="forge-field-error" role="alert">{error}</p> : null}
        {!tables && !error ? <p className="forge-field-hint">Please Wait…</p> : null}
        {tables ? (
          <>
            <details open>
              <summary>Tables ({realTables.length})</summary>
              <ul role="tree" aria-label="Tables">{realTables.map(row)}</ul>
            </details>
            <details>
              <summary>Views ({views.length})</summary>
              <ul role="tree" aria-label="Views">{views.map(row)}</ul>
            </details>
            <details
              onToggle={(e) => {
                if ((e.currentTarget as HTMLDetailsElement).open && procedures === null) {
                  void api.dbActivate(sessionKey).catch(() => false)
                  api
                    .dbQuery(PROCEDURES_SQL, false)
                    .then((r) => setProcedures(r.rows.map((x) => `${x[0] ?? ''} (${(x[1] ?? '').toLowerCase()})`)))
                    .catch(() => setProcedures([]))
                }
              }}
            >
              <summary>Procedures{procedures ? ` (${procedures.length})` : ''}</summary>
              <ul aria-label="Procedures">
                {(procedures ?? []).map((p) => (
                  <li key={p} className="dbb-table">
                    {p}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>
      <div className="dbb-detail">
        {selected ? (
          <>
            <Table className="dbb-grid" aria-label={`Columns of ${selected}`}>
              <TableHeader>

                  <TableColumn isRowHeader>Name</TableColumn>
                  <TableColumn>Type</TableColumn>
                  <TableColumn>DB Type</TableColumn>
                  <TableColumn>Length</TableColumn>
                  <TableColumn>Decimal Places</TableColumn>
                  <TableColumn>Allows NULL</TableColumn>
                  <TableColumn>Default Value</TableColumn>

              </TableHeader>
              <TableBody>
                {(columns ?? []).map((c) => (
                  <TableRow key={c.name}>
                    <TableCell>{c.key === 'PRI' ? `${c.name} (key)` : c.name}</TableCell>
                    <TableCell>{c.type}</TableCell>
                    <TableCell>{c.dbType}</TableCell>
                    <TableCell>{c.length}</TableCell>
                    <TableCell>{c.scale}</TableCell>
                    <TableCell>{c.nullable ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{c.defaultValue ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h4>Indexes</h4>
            <Table className="dbb-grid" aria-label={`Indexes of ${selected}`}>
              <TableHeader>

                  <TableColumn isRowHeader>Name</TableColumn>
                  <TableColumn>Columns</TableColumn>
                  <TableColumn>Unique</TableColumn>

              </TableHeader>
              <TableBody>
                {(indexes ?? []).map((i) => (
                  <TableRow key={i.name}>
                    <TableCell>{i.name}</TableCell>
                    <TableCell>{i.columns}</TableCell>
                    <TableCell>{i.unique ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <h4>Foreign Keys</h4>
            <Table className="dbb-grid" aria-label={`Foreign keys of ${selected}`}>
              <TableHeader>

                  <TableColumn isRowHeader>Name</TableColumn>
                  <TableColumn>Column</TableColumn>
                  <TableColumn>References</TableColumn>

              </TableHeader>
              <TableBody>
                {(foreignKeys ?? []).map((f) => (
                  <TableRow key={`${f.name}.${f.column}`}>
                    <TableCell>{f.name}</TableCell>
                    <TableCell>{f.column}</TableCell>
                    <TableCell>
                      {f.refTable}.{f.refColumn}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="dbb-props" aria-label="Properties">
              <dt>Name</dt>
              <dd>{selected}</dd>
              <dt>Catalog</dt>
              <dd>{catalog ?? ''}</dd>
              <dt>Schema</dt>
              <dd>{catalog ?? ''}</dd>
              <dt>System</dt>
              <dd>{ref.system}</dd>
            </dl>
          </>
        ) : (
          <p className="forge-field-hint">Select a table to see its columns.</p>
        )}
        {changelog ? (
          <div className="dbb-changelog">
            <TextArea readOnly aria-label="Generated changelog" value={changelog} rows={14} />
            <Button variant="bare" onClick={() => void copyText(changelog)}>
              Copy
            </Button>
            <Button variant="bare" onClick={() => setChangelog(null)}>
              Close
            </Button>
            <p className="forge-field-hint">The text is only shown; nothing is run. Check it against a module changeset before you use it.</p>
          </div>
        ) : null}
      </div>
      {menu ? <TreeContextMenu entries={menuEntries(menu.table)} x={menu.x} y={menu.y} onPick={(id) => void pick(id, menu.table)} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
