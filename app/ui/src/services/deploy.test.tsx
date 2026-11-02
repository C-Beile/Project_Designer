import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DeployDialog } from '../shell/DeployDialog'
import { ServicesPanel } from './ServicesPanel'
import { UsersTab, SystemAliasConfigs } from './UsersTable'
import { newUuid } from '../shell/uuid'
import { createMockForgeApi } from '../test/mockApi'
import type { AliasConfigTable, DbStatus, DeployPlan, TableDump } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const ON: DbStatus = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'adito-db.svc' }
const OFF: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

const PLAN: DeployPlan = {
  target: '_____systemalias @ adito-db.svc',
  outdated: true,
  mapping: { table: 'ASYS_SYSTEM', name_column: 'NAME', content_column: 'CONTENT' },
  items: [
    { op: 'I', key: 'entity/BrandNew', extra_files: 0, selected_by_default: true },
    { op: 'U', key: 'entity/Changed', extra_files: 2, selected_by_default: true },
    { op: 'D', key: 'entity/Gone', extra_files: 0, selected_by_default: false },
  ],
}

function makeApi(over: { deployPlan?: DeployPlan; systemUsers?: TableDump; systemAliasConfigs?: AliasConfigTable; pickedFiles?: string[] } = {}) {
  return createMockForgeApi({ projectTree: [], documents: {}, ...over })
}

describe('DeployDialog', () => {
  it('shows the outdated hint and plan, preselects I/U but not D, and writes nothing before confirmation', async () => {
    const user = userEvent.setup()
    const mock = makeApi({ deployPlan: PLAN })
    const onDeployed = vi.fn()
    render(<DeployDialog api={mock} projectRoot="C:/p" onClose={vi.fn()} onDeployed={onDeployed} />)
    expect(await screen.findByText('View is outdated. Deploy necessary.')).toBeInTheDocument()
    expect(screen.getByLabelText('Insert entity/BrandNew')).toBeChecked()
    expect(screen.getByLabelText('Update entity/Changed')).toBeChecked()
    expect(screen.getByLabelText('Delete entity/Gone')).not.toBeChecked()
    expect(screen.getByText(/2 more file\(s\) not transferred/)).toBeInTheDocument()
    const deploy = screen.getByRole('button', { name: 'Deploy' })
    expect(deploy).toBeDisabled()
    expect(mock.deployCalls.some((c) => c.startsWith('execute'))).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: /I confirm writing 2 change/ }))
    await user.click(deploy)
    await waitFor(() => expect(onDeployed).toHaveBeenCalled())
    expect(mock.deployCalls).toContain('execute:true:entity/BrandNew,entity/Changed')
    expect(onDeployed.mock.calls[0][0]).toMatch(/Deploy finished: 2 change/)
  })

  it('names deletes in the confirmation and shows both sides on Show changes', async () => {
    const user = userEvent.setup()
    render(<DeployDialog api={makeApi({ deployPlan: PLAN })} projectRoot="C:/p" onClose={vi.fn()} onDeployed={vi.fn()} />)
    await user.click(await screen.findByLabelText('Delete entity/Gone'))
    expect(screen.getByText(/including 1 delete/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Show changes' })[1])
    expect(await screen.findByText('<local entity/Changed/>')).toBeInTheDocument()
    expect(screen.getByText('<remote entity/Changed/>')).toBeInTheDocument()
  })

  it('reports a missing connection without offering a deploy', async () => {
    render(<DeployDialog api={makeApi()} projectRoot="C:/p" onClose={vi.fn()} onDeployed={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not connected')
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled()
  })

  it('shows a rolled-back message when the write fails', async () => {
    const user = userEvent.setup()
    const mock = makeApi({ deployPlan: PLAN })
    mock.deployExecute = async () => {
      throw new Error('query failed: Unknown column')
    }
    render(<DeployDialog api={mock} projectRoot="C:/p" onClose={vi.fn()} onDeployed={vi.fn()} />)
    await user.click(await screen.findByRole('checkbox', { name: /I confirm writing/ }))
    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was written (rolled back)')
  })

  it('warns when the target looks like a cloud system', async () => {
    render(<DeployDialog api={makeApi({ deployPlan: { ...PLAN, target: 'sys @ db.dev.htc1.adito.cloud' } })} projectRoot="C:/p" onClose={vi.fn()} onDeployed={vi.fn()} />)
    expect(await screen.findByText(/looks like a cloud system/)).toBeInTheDocument()
  })
})

describe('System database views', () => {
  it('lists users without credential columns and tells which were hidden', async () => {
    const mock = makeApi({ systemUsers: { columns: ['LOGINNAME', 'ID'], rows: [['admin', '1']], hidden_columns: ['PASSWORD'], truncated: false } })
    await mock.dbConnect('t', 's', null)
    render(<UsersTab api={mock} db={ON} />)
    expect(await screen.findByText('admin')).toBeInTheDocument()
  })

  it('asks for the tunnel before reading users', () => {
    render(<UsersTab api={makeApi()} db={OFF} />)
    expect(screen.getByText(/Open the tunnel/)).toBeInTheDocument()
  })

  it('flags a missing required alias config', async () => {
    const mock = makeApi({ systemAliasConfigs: { table: { columns: ['ALIAS'], rows: [['___SYSTEMALIAS']], hidden_columns: [], truncated: false }, missing_required: ['Data_alias'] } })
    await mock.dbConnect('t', 's', null)
    render(<SystemAliasConfigs api={mock} db={ON} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Data_alias')
  })
})

describe('Tunnel basic auth', () => {
  it('switches to a password field, connects with basic auth and clears the password', async () => {
    const user = userEvent.setup()
    const mock = makeApi({ pickedFiles: ['a.xml', 'b.xml'] })
    function Host() {
      const [db, setDb] = useState<DbStatus>(OFF)
      return <ServicesPanel api={mock} db={db} onDbChange={setDb} onOpenSql={vi.fn()} />
    }
    render(<Host />)
    const browse = screen.getAllByRole('button', { name: 'Browse...' })
    await user.click(browse[0])
    await user.click(browse[1])
    await user.click(screen.getByLabelText('Basic auth'))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
    const field = screen.getByLabelText('Tunnel password')
    expect(field).toHaveAttribute('type', 'password')
    await user.type(field, 'pw123')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mock.connectCalls).toEqual(['basic']))
    expect(document.body.textContent).not.toContain('pw123')
  })
})

describe('UUID generator', () => {
  it('produces distinct 36-character UUIDs', () => {
    const a = newUuid()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(newUuid()).not.toBe(a)
  })
})
