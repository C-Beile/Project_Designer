import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { groupSessions, ServicesTree } from './ServicesTree'
import { _resetTunnelStateForTests, setSystemsDb } from './tunnelState'
import { createMockForgeApi } from '../test/mockApi'

const st = (database: string) => ({ connected: true, tunnel_up: true, database, host: '127.0.0.1' })

describe('ServicesTree', () => {
  beforeEach(() => _resetTunnelStateForTests())

  it('groups the sessions by project and system with System_alias first and Data aliases after it', () => {
    const groups = groupSessions({
      'c:/p/FZ|dev1|alias:THHIT_Data_alias': st('data'),
      'c:/p/FZ|dev1': st('sys'),
      'c:/p/FZ|dev2': { ...st('x'), connected: false },
      'c:/p/FZ|dev1_bg': st('bg'),
      'c:/p/FZ|dev1_bg|alias:Data_alias': st('bgdata'),
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].systems.map((s) => s.name)).toEqual(['dev1'])
    expect(groups[0].systems[0].aliases.map((a) => a.label)).toEqual(['System_alias', 'THHIT_Data_alias'])
  })

  it('shows both databases of a system and opens a table in an SQL tab of that alias', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const opened: string[] = []
    render(<ServicesTree api={api} onOpenSql={(s) => opened.push(s)} />)
    act(() => setSystemsDb([{ system: 'c:/p/FZ|dev1', status: st('sys'), active: true }, { system: 'c:/p/FZ|dev1|alias:Data_alias', status: st('data'), active: false }]))
    const tree = await screen.findByRole('tree', { name: 'Database connections' })
    const user = userEvent.setup()
    await user.click(within(tree).getAllByText('FZ')[0])
    await user.click(within(tree).getAllByText('dev1')[0])
    expect(within(tree).getByText('System_alias')).toBeInTheDocument()
    expect(within(tree).getByText('Data_alias')).toBeInTheDocument()
    await user.click(within(tree).getByRole('button', { name: 'Open SQL for System_alias' }))
    expect(opened).toEqual([''])
  })
})

describe('ServicesTree tunnels and project names', () => {
  it('writes the project as on disk and lists the open tunnels with a close button', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    const closed: string[] = []
    api.dbDisconnect = async (system) => {
      closed.push(String(system))
    }
    render(<ServicesTree api={api} onOpenSql={() => {}} projects={['C:/Users/Dev/Pichler']} />)
    act(() => setSystemsDb([{ system: 'c:/users/dev/pichler|dev1', status: st('sys'), active: true }]))
    const tree = await screen.findByRole('tree', { name: 'Database connections' })
    expect(within(tree).getAllByText('Pichler').length).toBeGreaterThan(0)
    expect(within(tree).queryByText('pichler')).toBeNull()
    const user = userEvent.setup()
    await user.click(within(tree).getByRole('button', { name: 'Close dev1 of Pichler' }))
    expect(closed).toContain('c:/users/dev/pichler|dev1')
  })
})
