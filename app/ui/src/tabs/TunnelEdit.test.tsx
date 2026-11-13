import { configSet } from '../settings/appConfig'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TunnelConfigEditor } from './TunnelConfigEditor'
import { DialogHost, _resetDialogsForTests } from '../core/dialogService'
import { createMockForgeApi } from '../test/mockApi'
import type { DbStatus, TunnelRowDto } from '../wire/types'

const REF = '$PROJECTHOME/others/cloud/a_tunnelconfig.xml'
const down: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

function setup(rows: TunnelRowDto[]) {
  const api = createMockForgeApi({ projectTree: [], documents: {}, tunnelRows: { [REF]: rows } })
  render(
    <>
      <TunnelConfigEditor api={api} projectRoot="C:/p" reference={REF} db={down} onDbChange={vi.fn()} />
      <DialogHost />
    </>,
  )
  return api
}

const base: TunnelRowDto = { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'db.svc', target_port: 3306, user: 'dev-user' }

describe('Add and Delete Tunnel', () => {
  beforeEach(() => configSet(['tunnels', 'view'], 'table'))

  afterEach(() => _resetDialogsForTests())

  it('Add Tunnel asks for the target and takes jump host and user from the selected tunnel', async () => {
    const user = userEvent.setup()
    const api = setup([base])
    const add = vi.spyOn(api, 'addTunnelRow')
    fireEvent.contextMenu(await screen.findByText('db.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Add Tunnel' }))
    await user.type(await screen.findByLabelText('Target server'), 'web.svc:8080')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith('C:/p', REF, { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'web.svc', target_port: 8080, user: 'dev-user' }))
    expect(await screen.findByText('web.svc')).toBeInTheDocument()
  })

  it('refuses a target without a port', async () => {
    const user = userEvent.setup()
    setup([base])
    fireEvent.contextMenu(await screen.findByText('db.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Add Tunnel' }))
    await user.type(await screen.findByLabelText('Target server'), 'web.svc')
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  })

  it('Delete Tunnel asks first and removes only the selected one', async () => {
    const user = userEvent.setup()
    const api = setup([base, { ...base, target_host: 'web.svc', target_port: 8080 }])
    const del = vi.spyOn(api, 'deleteTunnelRow')
    fireEvent.contextMenu(await screen.findByText('web.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Delete Tunnel' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(del).toHaveBeenCalledWith('C:/p', REF, 1))
    await waitFor(() => expect(screen.queryByText('web.svc')).toBeNull())
    expect(screen.getByText('db.svc')).toBeInTheDocument()
  })

  it('declining the question deletes nothing', async () => {
    const user = userEvent.setup()
    const api = setup([base])
    const del = vi.spyOn(api, 'deleteTunnelRow')
    fireEvent.contextMenu(await screen.findByText('db.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Delete Tunnel' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(del).not.toHaveBeenCalled()
  })
})
