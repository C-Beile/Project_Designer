import { useResource } from '../core/hooks/useResource'
import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { AliasConfigTable, DbStatus, TableDump } from '../wire/types'
import { confirmDialog, promptDialog } from '../core/dialogService'
import { getUserSelection, notifyUsersChanged, setUserSelection, useUsersChanged } from './userSelection'
import { errorText } from '../core/errorText'
import { Button, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'

// Users tab and the alias-config list of the system editor, read from the system database
// (ASYS_USERS, ASYS_ALIASCONFIG). Credential columns are removed by the backend; this view only
// shows what it gets.

function DumpTable({ dump, label }: { dump: TableDump; label: string }) {
  return (
    <>
      <Table className="forge-users-table" aria-label={label}>
        <TableHeader>

            {dump.columns.map((c, i) => (
              <TableColumn isRowHeader={i === 0} key={c}>{c}</TableColumn>
            ))}

        </TableHeader>
        <TableBody>
          {dump.rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, i) => (
                <TableCell key={i}>{cell ?? ''}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dump.hidden_columns.length > 0 ? <p className="forge-field-hint">Hidden for security: {dump.hidden_columns.join(', ')}</p> : null}
      {dump.truncated ? <p className="forge-field-hint">Only the first rows are shown.</p> : null}
    </>
  )
}

function useRemote<T>(db: DbStatus, load: () => Promise<T>, reload = 0) {
  const loaded = useResource(async () => (db.connected ? load() : null), [db.connected, reload], [], { clearOnReload: true })
  return { data: loaded.data ?? null, error: loaded.error ?? null }
}

const PAGE_SIZE = 100

function isTrue(value: string | null): boolean {
  return value !== null && ['true', '1', 'y', 'yes'].includes(value.trim().toLowerCase())
}

// Users tab (original Designer, manual 6.1.3): one row per user with isActive as a check mark,
// title, email, firstname and lastname. Sorting by header click, a filter field and pages of 100
// rows keep large user lists fast.
function UsersGrid({ api, dump, systemKey, systemName, onReload }: { api: ForgeApi; dump: TableDump; systemKey?: string; systemName?: string; onReload: () => void }) {
  const [selectedUser, setSelectedUser] = useState<string | null>(() => getUserSelection()?.user ?? null)
  // Leaving the tab takes the user out of the Properties panel again.
  useEffect(() => () => setUserSelection(null), [])
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null)
  const [page, setPage] = useState(0)
  const [actionError, setActionError] = useState<string | null>(null)
  const needle = filter.trim().toLowerCase()

  async function addUser() {
    const title = await promptDialog(`Name of the new user in ${systemName ?? 'the system'}:`, { title: 'Add user', label: 'User name', okLabel: 'Add', validate: (v) => (v.trim() ? null : 'Enter a name.') })
    if (title === null) return
    const nl = String.fromCharCode(10)
    const yes = await confirmDialog(`Add the user "${title.trim()}" to the system database of ${systemName ?? 'the system'}?${nl}${nl}The user has no password yet.`, { title: 'Add user', okLabel: 'Add' })
    if (!yes) return
    setActionError(null)
    try {
      if (systemKey) await api.dbActivate(systemKey).catch(() => false)
      const created = await api.systemUserCreate(title.trim(), true)
      setSelectedUser(created)
      setUserSelection({ systemKey: systemKey ?? '', systemName: systemName ?? '', user: created, title: title.trim() })
      notifyUsersChanged()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  async function removeUser() {
    const selected = getUserSelection()
    if (!selected) return
    const yes = await confirmDialog(`Remove the user "${selected.title || selected.user}" with all of its properties from the system database of ${systemName ?? 'the system'}? This cannot be undone.`, { title: 'Remove user', okLabel: 'Remove' })
    if (!yes) return
    setActionError(null)
    try {
      if (systemKey) await api.dbActivate(systemKey).catch(() => false)
      await api.systemUserDelete(selected.user, true)
      setSelectedUser(null)
      setUserSelection(null)
      notifyUsersChanged()
    } catch (e) {
      setActionError(errorText(e))
    }
  }
  // Every row keeps the user it stands for (the key of the row), also after filtering and sorting.
  let entries = dump.rows.map((cells, i) => ({ cells, user: dump.row_keys?.[i] ?? null }))
  if (needle) entries = entries.filter((r) => r.cells.some((c) => (c ?? '').toLowerCase().includes(needle)))
  if (sort) {
    const { col, desc } = sort
    entries = [...entries].sort((x, y) => (x.cells[col] ?? '').localeCompare(y.cells[col] ?? '', undefined, { sensitivity: 'base', numeric: true }) * (desc ? -1 : 1))
  }
  const rows = entries
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const shown = rows.slice(Math.min(page, pages - 1) * PAGE_SIZE, Math.min(page, pages - 1) * PAGE_SIZE + PAGE_SIZE)
  return (
    <>
      <div className="users-toolbar">
        <Input
          type="search"
          placeholder="Filter users"
          aria-label="Filter users"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setPage(0)
          }}
        />
        <span className="users-count">{rows.length} users</span>
        <Button variant="bare" className="users-reload" title="Add a user" aria-label="Add user" onClick={() => void addUser()}>
          +
        </Button>
        <Button variant="bare" className="users-reload" title="Remove the selected user" aria-label="Remove user" isDisabled={!selectedUser} onClick={() => void removeUser()}>
          {'−'}
        </Button>
        <Button variant="bare" className="users-reload" title="Read the users again" aria-label="Reload users" onClick={onReload}>
          {'↻'}
        </Button>
        {pages > 1 ? (
          <span className="users-pager">
            <Button variant="bare" isDisabled={page <= 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
              {'‹'}
            </Button>
            <span>
              {Math.min(page, pages - 1) + 1} / {pages}
            </span>
            <Button variant="bare" isDisabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
              {'›'}
            </Button>
          </span>
        ) : null}
      </div>
      {actionError ? (
        <p className="forge-field-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="users-list">
      <Table className="forge-users-table users-grid" aria-label="Users">
        <TableHeader>

            {dump.columns.map((c, i) => (
              <TableColumn isRowHeader={i === 0} key={c} aria-sort={sort?.col === i ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <Button variant="bare" onClick={() => setSort(sort?.col === i ? { col: i, desc: !sort.desc } : { col: i, desc: false })}>
                  {c}
                  {sort?.col === i ? (sort.desc ? ' ▾' : ' ▴') : ''}
                </Button>
              </TableColumn>
            ))}

        </TableHeader>
        <TableBody>
          {shown.map((entry, r) => (
            <TableRow key={r} className={entry.user !== null && entry.user === selectedUser ? 'is-selected' : undefined} aria-selected={entry.user !== null && entry.user === selectedUser} onClick={() => {
                if (entry.user === null) return
                setSelectedUser(entry.user)
                setUserSelection({ systemKey: systemKey ?? '', systemName: systemName ?? '', user: entry.user, title: entry.cells[dump.columns.indexOf('title')] ?? entry.user })
              }}>
              {entry.cells.map((cell, i) => (
                <TableCell key={i} className={dump.columns[i].toLowerCase() === 'isactive' ? 'users-check' : undefined}>
                  {dump.columns[i].toLowerCase() === 'isactive' ? <Input type="checkbox" checked={isTrue(cell)} readOnly aria-label={isTrue(cell) ? 'active' : 'inactive'} /> : (cell ?? '')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {dump.truncated ? <p className="forge-field-hint">Only the first users are shown.</p> : null}
      </div>
    </>
  )
}

export function UsersTab({ api, db, reload = 0, systemKey, systemName }: { api: ForgeApi; db: DbStatus; reload?: number; systemKey?: string; systemName?: string }) {
  const [tick, setTick] = useState(0)
  const { data, error } = useRemote<TableDump>(
    db,
    async () => {
      if (systemKey) await api.dbActivate(systemKey).catch(() => false)
      return api.systemUsers()
    },
    reload + tick + useUsersChanged(),
  )
  return (
    <div className="forge-users" aria-label="Users">
      {!db.connected ? <p className="forge-field-hint">Open the tunnel in the Services tab to read the users from ASYS_USERS.</p> : null}
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {db.connected && !data && !error ? <p className="forge-field-hint">Please Wait…</p> : null}
      {data ? <UsersGrid api={api} dump={data} systemKey={systemKey} systemName={systemName} onReload={() => setTick((n) => n + 1)} /> : null}
    </div>
  )
}

export function SystemAliasConfigs({ api, db, reload = 0 }: { api: ForgeApi; db: DbStatus; reload?: number }) {
  const { data, error } = useRemote<AliasConfigTable>(db, () => api.systemAliasConfigs(), reload)
  if (!db.connected) return null
  return (
    <div className="forge-users" aria-label="Alias configs from the system database">
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <DumpTable dump={data.table} label="ASYS_ALIASCONFIG" />
          {data.missing_required.length > 0 ? (
            <p className="forge-field-error" role="alert">
              Expected alias config(s) not found: {data.missing_required.join(', ')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
