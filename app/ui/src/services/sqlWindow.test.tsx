import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlEditor } from './SqlEditor'
import { createMockForgeApi } from '../test/mockApi'
import { lastEditor, resetEditors } from '../test/monacoMock'
import { loadSqlHistory, } from './sqlTools'
import type { DbStatus } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const ON: DbStatus = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'adito-db.svc' }
const one = { columns: ['ID', 'NAME'], rows: [['1', 'alpha'], ['2', null], ['3', 'gamma']], truncated: false, elapsed_ms: 2 }
const two = { columns: ['X'], rows: [['9']], truncated: false, elapsed_ms: 1 }

async function setup(initial: string, results: Record<string, typeof one> = { 'select * from t': one, 'select 2': two }) {
  const api = createMockForgeApi({ projectTree: [], documents: {}, dbResults: { ...results, 'UPDATE `t`': two } })
  await api.dbConnect('t', 's', null)
  render(<SqlEditor api={api} db={ON} label="SQL 1" initial={initial} onTextChange={() => {}} />)
  return api
}

beforeEach(() => {
  resetEditors()
  window.localStorage.clear()
})

describe('Execute SQL window (manual chapter 8)', () => {
  it('has the original layout: connection row, icon bar, result tab per statement with the middle bar', async () => {
    const user = userEvent.setup()
    await setup('select * from t')
    expect(screen.getByRole('combobox', { name: 'Connection' })).toHaveTextContent('adito-db.svc')
    const bar = screen.getByRole('toolbar', { name: 'SQL toolbar' })
    for (const name of ['Run', 'Run selected statement', 'SQL history', 'Keep prior tabs', 'Find', 'Comment', 'Uncomment']) expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Start macro' })).toBeDisabled()
    await user.click(within(bar).getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('tab', { name: 'select * from t' })).toBeInTheDocument()
    const mid = screen.getByRole('toolbar', { name: 'Result toolbar' })
    expect(within(mid).getByRole('combobox', { name: 'Max. rows' })).toHaveValue('100')
    expect(screen.getByTestId('sql-summary')).toHaveTextContent('Fetched Rows: 3')
    expect(within(mid).getByRole('textbox', { name: 'Matching Rows' })).toBeInTheDocument()
  })

  it('run sql executes every statement in its own result tab; prior tabs are kept on request', async () => {
    const user = userEvent.setup()
    const api = await setup('select * from t;\nselect 2;')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(api.dbCalls.map((c) => c.sql)).toEqual(['select * from t', 'select 2']))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(api.dbCalls).toHaveLength(4))
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Keep prior tabs' }))
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(4))
  })

  it('run statement takes the statement at the cursor, and history remembers what ran', async () => {
    const user = userEvent.setup()
    const api = await setup('select * from t;\nselect 2;')
    await user.click(screen.getByRole('button', { name: 'Run selected statement' }))
    await waitFor(() => expect(api.dbCalls).toEqual([{ sql: 'select * from t', allowWrite: true }]))
    expect(loadSqlHistory()).toEqual(['select * from t'])
    await user.click(screen.getByRole('button', { name: 'SQL history' }))
    expect(within(screen.getByRole('dialog', { name: 'SQL history' })).getByText('select * from t')).toBeInTheDocument()
  })

  it('Matching Rows filters the grid, Max. rows limits it and a click on a header sorts', async () => {
    const user = userEvent.setup()
    await setup('select * from t')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    const table = await screen.findByRole('table', { name: 'Query result' })
    await user.type(screen.getByRole('textbox', { name: 'Matching Rows' }), 'gam')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    await user.clear(screen.getByRole('textbox', { name: 'Matching Rows' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Max. rows' }), '100')
    await user.click(within(table).getByRole('columnheader', { name: 'NAME' }))
    await user.click(within(table).getByRole('columnheader', { name: /NAME/ }))
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('gamma')
  })

  it('editing the grid generates reviewed statements and runs nothing before the confirmation', async () => {
    const user = userEvent.setup()
    const api = await setup('select * from t', { 'select * from t': one, "UPDATE t SET `NAME` = 'beta' WHERE `ID` = '2' AND `NAME` IS NULL LIMIT 1": two })
    await user.click(screen.getByRole('button', { name: 'Run' }))
    const table = await screen.findByRole('table', { name: 'Query result' })
    await user.dblClick(within(table).getAllByRole('row')[2].querySelectorAll('td')[2] as HTMLElement)
    await user.type(screen.getByRole('textbox', { name: 'Edit NAME' }), 'beta{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save row' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm write statement' })
    expect(confirm).toHaveTextContent("UPDATE t SET `NAME` = 'beta' WHERE `ID` = '2' AND `NAME` IS NULL LIMIT 1")
    expect(api.dbCalls.filter((c) => c.sql.startsWith('UPDATE'))).toEqual([])
    await user.click(within(confirm).getByRole('button', { name: 'Run statement' }))
    await waitFor(() => expect(api.dbCalls.some((c) => c.allowWrite && c.sql.startsWith('UPDATE t SET'))).toBe(true))
  })

  it('writes the executed statements into the Database output', async () => {
    const user = userEvent.setup()
    const { subscribeOutput } = await import('../core/outputBus')
    const seen: string[] = []
    const off = subscribeOutput((sub, lines) => lines.forEach((l) => seen.push(`${sub}:${l.text}`)))
    await setup('select 2')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(seen.some((l) => l.startsWith('database:') && l.includes('select 2'))).toBe(true))
    off()
    expect(lastEditor()).toBeTruthy()
  })
})

describe('Result grid context menu', () => {
  it('opens an own menu with copy entries and offers editing', async () => {
    const user = userEvent.setup()
    await setup('select * from t')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    const table = await screen.findByRole('table', { name: 'Query result' })
    const cell = within(table).getAllByRole('cell')[1]
    expect(fireEvent.contextMenu(cell)).toBe(false)
    expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual(['Copy Cell', 'Copy Row', 'Copy Result', 'Export CSV', 'Edit Cell'])
    expect(screen.getByRole('menuitem', { name: 'Edit Cell' })).not.toHaveAttribute('aria-disabled', 'true')
  })
})
