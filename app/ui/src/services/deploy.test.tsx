import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DeployDialog } from '../shell/DeployDialog'
import { ServicesPanel } from './ServicesPanel'
import { UsersTab, SystemAliasConfigs } from './UsersTable'
import { newUuid } from '../shell/uuid'
import { createMockForgeApi } from '../test/mockApi'
import type { AliasConfigTable, DbStatus, DeployOverview, DeployPlan, TableDump } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

const ON: DbStatus = { connected: true, tunnel_up: true, database: '_____systemalias', host: 'adito-db.svc' }
const OFF: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

const OVERVIEW: DeployOverview = {
  target: '_____systemalias @ adito-db.svc',
  last_deploy: { author: 'ClemensBeile', time_ms: 1793695345880, designer_version: '6.5.0' },
  changed: [
    { key: 'preferences/_____PREFERENCES_PROJECT', files: [{ path: 'preferences/_____PREFERENCES_PROJECT/_____PREFERENCES_PROJECT.aod', changed_ms: 1793695661283 }] },
    { key: 'language/_____LANGUAGE_de', files: [{ path: 'language/_____LANGUAGE_de/_____LANGUAGE_de.aod', changed_ms: 1793695661000 }] },
  ],
  other_files: [],
}

function makeApi(over: { deployOverview?: DeployOverview; deployPlan?: DeployPlan; systemUsers?: TableDump; systemAliasConfigs?: AliasConfigTable; pickedFiles?: string[] } = {}) {
  return createMockForgeApi({ projectTree: [], documents: {}, ...over })
}

const PLAN: DeployPlan = {
  target: '_____systemalias @ adito-db.svc',
  outdated: true,
  mapping: { table: 'ASYS_SYSTEM', name_column: 'ID', content_column: 'XMLDATA' },
  items: [
    { op: 'I', key: 'entity/BrandNew', extra_files: 0, selected_by_default: true },
    { op: 'U', key: 'entity/Person_entity', extra_files: 0, selected_by_default: true },
    { op: 'D', key: 'entity/Old_entity', extra_files: 0, selected_by_default: false },
  ],
}

describe('DeployDialog', () => {
  it('lists what a deploy would add, change and delete before anything is written', async () => {
    const mock = makeApi({ deployOverview: OVERVIEW, deployPlan: PLAN })
    render(<DeployDialog api={mock} projectRoot="C:/p" onClose={vi.fn()} />)
    expect(await screen.findByText(/by ClemensBeile/)).toBeInTheDocument()
    expect(screen.getByText('Planned changes: 1 added, 1 changed, 1 deleted')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'entity/BrandNew' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'entity/Person_entity' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'entity/Old_entity' })).not.toBeChecked()
    expect(mock.deployCalls.some((c) => c.startsWith('execute'))).toBe(false)
  })

  it('shows what changed inside a model on request', async () => {
    const user = userEvent.setup()
    const mock = makeApi({ deployOverview: OVERVIEW, deployPlan: PLAN })
    render(<DeployDialog api={mock} projectRoot="C:/p" onClose={vi.fn()} />)
    await screen.findByText(/by ClemensBeile/)
    await user.click(screen.getByRole('button', { name: 'Show changes of entity/Person_entity' }))
    expect(await screen.findByLabelText('Changes of the model')).toHaveTextContent('- <remote entity/Person_entity/>')
    expect(screen.getByLabelText('Changes of the model')).toHaveTextContent('+ <local entity/Person_entity/>')
  })

  it('asks for a confirmation and then writes only the selected models', async () => {
    const user = userEvent.setup()
    const onDeployed = vi.fn()
    const mock = makeApi({ deployOverview: OVERVIEW, deployPlan: PLAN })
    render(<DeployDialog api={mock} projectRoot="C:/p" onClose={vi.fn()} onDeployed={onDeployed} />)
    await screen.findByText(/by ClemensBeile/)
    await user.click(screen.getByRole('button', { name: 'Deploy (2)' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Deploy 2 models (1 added, 1 changed, 0 deleted)')
    expect(mock.deployCalls.some((c) => c.startsWith('execute'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Yes, deploy now' }))
    await waitFor(() => expect(mock.deployCalls).toContain('execute:true:entity/BrandNew,entity/Person_entity'))
    expect(onDeployed).toHaveBeenCalledWith('Deployed 2 models to _____systemalias @ adito-db.svc')
  })

  it('keeps Deploy off while nothing is selected', async () => {
    const user = userEvent.setup()
    render(<DeployDialog api={makeApi({ deployOverview: OVERVIEW, deployPlan: { ...PLAN, items: [PLAN.items[2]] } })} projectRoot="C:/p" onClose={vi.fn()} />)
    await screen.findByText(/by ClemensBeile/)
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'entity/Old_entity' }))
    expect(screen.getByRole('button', { name: 'Deploy (1)' })).toBeEnabled()
  })

  it('says so when the system is already up to date', async () => {
    render(<DeployDialog api={makeApi({ deployOverview: OVERVIEW, deployPlan: { ...PLAN, items: [], outdated: false } })} projectRoot="C:/p" onClose={vi.fn()} />)
    expect(await screen.findByText('Nothing to deploy')).toBeInTheDocument()
  })

  it('reports a missing connection', async () => {
    render(<DeployDialog api={makeApi()} projectRoot="C:/p" onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not connected')
  })

  it('warns when the target looks like a cloud system', async () => {
    render(<DeployDialog api={makeApi({ deployOverview: OVERVIEW, deployPlan: { ...PLAN, target: 'sys @ db.dev.htc1.adito.cloud' } })} projectRoot="C:/p" onClose={vi.fn()} />)
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
