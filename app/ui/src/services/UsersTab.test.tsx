import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersTab } from './UsersTable'
import { UserPropertiesPanel } from './UserPropertiesPanel'
import { getUserSelection, setUserSelection } from './userSelection'
import { DialogHost, _resetDialogsForTests } from '../shell/dialogService'
import { createMockForgeApi } from '../test/mockApi'

const db = { connected: true, tunnel_up: true, database: 'sys', host: 'h' }
const users = { columns: ['isActive', 'title'], rows: [['true', 'Admin'], ['false', 'Guest']], hidden_columns: [], truncated: false, row_keys: ['u-admin', 'u-guest'] }

describe('Users tab', () => {
  beforeEach(() => setUserSelection(null))

  it('puts the clicked user into the selection that the Properties panel shows', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, systemUsers: users })
    await api.dbConnect('t.xml', 's.xml', null)
    render(<UsersTab api={api} db={db} systemKey="p|dev1" systemName="dev1" />)
    await user.click(await screen.findByText('Guest'))
    expect(getUserSelection()).toEqual({ systemKey: 'p|dev1', systemName: 'dev1', user: 'u-guest', title: 'Guest' })
    expect(screen.queryByLabelText('User properties')).toBeNull()
  })

  it('reads the list again with the reload button', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, systemUsers: users })
    await api.dbConnect('t.xml', 's.xml', null)
    const read = vi.spyOn(api, 'systemUsers')
    render(<UsersTab api={api} db={db} />)
    await screen.findByText('Guest')
    await user.click(screen.getByRole('button', { name: 'Reload users' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })
})

describe('User properties panel', () => {
  it('lists General, Security and Personal, shows unset values empty and writes a change only after the confirmation', async () => {
    _resetDialogsForTests()
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    vi.spyOn(api, 'systemUserProperties').mockResolvedValue([
      { id: '11111111-1111-1111-1111-111111111111', group: 'BASIC', key: 'title', value: 'Admin', editable: true },
      { id: '22222222-2222-2222-2222-222222222222', group: 'BASIC', key: 'roleNames', value: 'A', editable: true },
      { id: '33333333-3333-3333-3333-333333333333', group: 'BASIC', key: 'roleNames', value: 'B', editable: true },
      { id: '44444444-4444-4444-4444-444444444444', group: 'SECURITY', key: 'password', value: null, editable: false },
      { id: '55555555-5555-5555-5555-555555555555', group: 'CALENDAR', key: 'nonWorkdays', value: '5,6', editable: true },
    ])
    const write = vi.spyOn(api, 'systemUserSetProperty')
    render(
      <>
        <UserPropertiesPanel api={api} selection={{ systemKey: 'p|dev1', systemName: 'dev1', user: 'u-admin', title: 'Admin' }} />
        <DialogHost />
      </>,
    )
    const field = await screen.findByRole('textbox', { name: 'title' })
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByText('[A, B]')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'firstname' })).toHaveValue('')
    expect(screen.getByText('***')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'Boss')
    await user.click(screen.getByRole('button', { name: /Save \(1\)/ }))
    expect(write).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(write).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'Boss', true))
    await user.click(screen.getByRole('tab', { name: 'Extended' }))
    expect(screen.getByText('CALENDAR')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'nonWorkdays' })).toHaveValue('5,6')
  })
})
