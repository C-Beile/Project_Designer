import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ServicesPanel } from './ServicesPanel'
import { SqlEditor, looksReadOnly } from './SqlEditor'
import { GitDialog } from '../features/git'
import { StatusBar } from '../shell/StatusBar'
import { createMockForgeApi } from '../test/mockApi'
import { lastEditor, resetEditors } from '../test/monacoMock'
import type { DbStatus, GitOverview } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const OFF: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
const ON: DbStatus = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'adito-db.svc' }

beforeEach(() => resetEditors())

describe('read-only classification', () => {
  it('treats only reading statements as read-only', () => {
    expect(looksReadOnly('SELECT 1')).toBe(true)
    expect(looksReadOnly('-- note\n  show tables')).toBe(true)
    expect(looksReadOnly('/* x */ describe t')).toBe(true)
    expect(looksReadOnly('DELETE FROM t')).toBe(false)
    expect(looksReadOnly('update t set a=1')).toBe(false)
  })
})

describe('ServicesPanel', () => {
  function Host({ api, onSql }: { api: ReturnType<typeof createMockForgeApi>; onSql: (s: string) => void }) {
    const [db, setDb] = useState<DbStatus>(OFF)
    return <ServicesPanel api={api} db={db} onDbChange={setDb} onOpenSql={onSql} />
  }

  it('connects from the two chosen files and lists the tables', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({
      projectTree: [],
      documents: {},
      pickedFiles: ['C:/x/tunnelconfig.xml', 'C:/x/serverconfig_system.xml'],
      dbTables: [{ schema: 's', name: 'ASYS_USER' }],
    })
    const onSql = vi.fn()
    render(<Host api={api} onSql={onSql} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    const browse = screen.getAllByRole('button', { name: 'Browse...' })
    await user.click(browse[0])
    await user.click(browse[1])
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/_____systemalias @ adito-db.svc/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'ASYS_USER' }))
    expect(onSql).toHaveBeenCalledWith('SELECT * FROM `ASYS_USER` LIMIT 100')
    expect(screen.getByTestId('tunnel-state')).toHaveTextContent('open')
  })

  it('shows a failed connect as an error and stays disconnected', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, pickedFiles: ['a.xml', 'b.xml'], dbError: 'SSH tunnel stopped: Connect failed' })
    render(<Host api={api} onSql={vi.fn()} />)
    const browse = screen.getAllByRole('button', { name: 'Browse...' })
    await user.click(browse[0])
    await user.click(browse[1])
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('SSH tunnel stopped')
    expect(screen.getByTestId('tunnel-state')).toHaveTextContent('closed')
  })
})

describe('SqlEditor', () => {
  const result = { columns: ['ID', 'NAME'], rows: [['1', 'a'], ['2', null]], truncated: false, elapsed_ms: 3 }

  async function connected() {
    const api = createMockForgeApi({ projectTree: [], documents: {}, dbResults: { 'SELECT 1': result, 'DELETE FROM t': { columns: [], rows: [], truncated: false, elapsed_ms: 1 } } })
    await api.dbConnect('t', 's', null)
    return api
  }

  it('runs a SELECT read-only and shows the rows with NULL marked', async () => {
    const user = userEvent.setup()
    const api = await connected()
    render(<SqlEditor api={api} db={ON} label="SQL 1" initial="SELECT 1" onTextChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('table', { name: 'Query result' })).toBeInTheDocument()
    expect(screen.getByText('NULL')).toBeInTheDocument()
    expect(api.dbCalls).toEqual([{ sql: 'SELECT 1', allowWrite: false }])
  })

  it('does not ask for confirmation while writing is off and reports the backend refusal', async () => {
    const user = userEvent.setup()
    const api = await connected()
    render(<SqlEditor api={api} db={ON} label="SQL 1" initial="DELETE FROM t" onTextChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.dbCalls).toEqual([{ sql: 'DELETE FROM t', allowWrite: false }])
  })

  it('needs the switch and an explicit confirmation before a write statement runs', async () => {
    const user = userEvent.setup()
    const api = await connected()
    render(<SqlEditor api={api} db={ON} label="SQL 1" initial="DELETE FROM t" onTextChange={() => {}} />)
    await user.click(screen.getByRole('checkbox', { name: 'Allow write statements' }))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(api.dbCalls).toEqual([])
    expect(screen.getByRole('alertdialog')).toHaveTextContent('DELETE FROM t')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.dbCalls).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await user.click(screen.getByRole('button', { name: 'Run statement' }))
    await waitFor(() => expect(api.dbCalls).toEqual([{ sql: 'DELETE FROM t', allowWrite: true }]))
    expect(await screen.findByTestId('sql-summary')).toHaveTextContent('Statement executed')
  })

  it('takes the current editor text, and reading statements skip the confirmation even with writing on', async () => {
    const user = userEvent.setup()
    const api = await connected()
    render(<SqlEditor api={api} db={ON} label="SQL 1" initial="" onTextChange={() => {}} />)
    lastEditor().type('SELECT 1')
    await user.click(screen.getByRole('checkbox', { name: 'Allow write statements' }))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(api.dbCalls).toEqual([{ sql: 'SELECT 1', allowWrite: false }]))
  })

  it('explains that a connection is needed first', () => {
    render(<SqlEditor api={createMockForgeApi({ projectTree: [], documents: {} })} db={OFF} label="SQL 1" initial="" onTextChange={() => {}} />)
    expect(screen.getByText('Connect in the Services tab first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })
})

describe('tunnel badge', () => {
  it('shows on and off and hides when unknown', () => {
    const base = { system: null, message: '', task: null, branch: null, caret: null }
    const { rerender } = render(<StatusBar {...base} tunnel={true} />)
    expect(screen.getByText('Tunnel: on')).toBeInTheDocument()
    rerender(<StatusBar {...base} tunnel={false} />)
    expect(screen.getByText('Tunnel: off')).toBeInTheDocument()
    rerender(<StatusBar {...base} />)
    expect(screen.queryByText(/Tunnel:/)).toBeNull()
  })
})

describe('GitDialog', () => {
  const git: GitOverview = {
    root: 'C:/p',
    branch: 'main',
    files: [
      { code: ' M', path: 'entity/A/A.aod' },
      { code: '??', path: 'package-lock.json' },
    ],
    branches: [
      { name: 'main', is_current: true },
      { name: 'feature/x', is_current: false },
    ],
    remote_branches: ['origin/main', 'origin/feature/y'],
    commits: [{ hash: '1234567890', author: 'Me', date: '2026-10-12T09:00:00+02:00', subject: 'Init' }],
  }

  it('commits only the checked files with a one-line message, package-lock unchecked by default', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.getByRole('checkbox', { name: /package-lock.json/ })).not.toBeChecked()
    const commit = screen.getByRole('button', { name: 'Commit' })
    expect(commit).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'Fix tree icons')
    await user.click(commit)
    await waitFor(() => expect(api.gitCalls).toEqual(['commit:Fix tree icons:entity/A/A.aod']))
  })

  it('shows the Commit dialog without tabs and without Pull and Push buttons, as the original does', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pull' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Push' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Commit & Push' })).toBeInTheDocument()
    expect(api.gitCalls).toEqual([])
  })

  it('shows the project folder as the root of the tree with its sub folders and the git author, as in the original', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, git: { ...git, user_name: 'Clemens Beile', user_email: 'c@example.invalid' } })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    expect(screen.getByRole('checkbox', { name: 'p' })).toBeInTheDocument()
    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'entity' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Clemens Beile')).toBeInTheDocument()
    expect(screen.getByDisplayValue('c@example.invalid')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Commit message' }).tagName).toBe('TEXTAREA')
  })

  it('runs nothing on its own and switches branches only on click', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="branches" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByRole('button', { name: 'Switch branch' })
    expect(api.gitCalls).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Switch branch' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['checkout:feature/x']))
  })

  it('commits and pushes with the Commit & Push button', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    await screen.findByText('A.aod')
    const both = screen.getByRole('button', { name: 'Commit & Push' })
    expect(both).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'Fix')
    await user.click(both)
    await waitFor(() => expect(api.gitCalls).toEqual(['commit:Fix:entity/A/A.aod', 'push']))
  })

  it('creates a branch from a remote branch on click', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    render(<GitDialog api={api} projectRoot="C:/p" initialTab="branches" onClose={() => {}} onChanged={() => {}} />)
    await user.type(await screen.findByRole('textbox', { name: 'New branch name' }), 'feature/z')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Start from' }), 'origin/feature/y')
    await user.click(screen.getByRole('button', { name: 'Create and switch' }))
    await waitFor(() => expect(api.gitCalls).toEqual(['newbranch:feature/z:origin/feature/y']))
  })

  it('lists the history and reports a folder outside a repository', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, git })
    const { unmount } = render(<GitDialog api={api} projectRoot="C:/p" initialTab="history" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByText('Init')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    unmount()
    render(<GitDialog api={createMockForgeApi({ projectTree: [], documents: {} })} projectRoot="C:/q" initialTab="changes" onClose={() => {}} onChanged={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not inside a Git repository')
  })
})

describe('Services context menus', () => {
  function Host({ api }: { api: ReturnType<typeof createMockForgeApi> }) {
    const [db, setDb] = useState<DbStatus>(OFF)
    return <ServicesPanel api={api} db={db} onDbChange={setDb} onOpenSql={() => {}} />
  }

  it('offers the tunnel actions, dims what is impossible and opens the config dialog by double click', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<Host api={api} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('button', { name: 'Tunnel' }) })
    const menu = screen.getByRole('menu', { name: 'Context menu' })
    expect(within(menu).getByRole('menuitem', { name: 'Open Tunnels' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByRole('menuitem', { name: 'Close Opened Tunnels' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(menu).getByRole('menuitem', { name: 'Properties' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit Server Config...' }))
    expect(screen.getByRole('dialog', { name: 'Edit Server Config' })).toBeInTheDocument()
  })
})

describe('Navigator filter', () => {
  it('has no native checkboxes', async () => {
    const { NavigatorPanel } = await import('../navigator/NavigatorPanel')
    render(<NavigatorPanel api={createMockForgeApi({ projectTree: [], documents: {} })} nodeId="a" objectType="application" origin="" selectedPath={null} onSelect={() => {}} />)
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0)
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
  })
})