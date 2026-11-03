import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildRowMenu, hostPort, TunnelConfigEditor } from './TunnelConfigEditor'
import { NativeMenuGuard, isBlockedBrowserKey, textFieldOf, textMenuEntries } from '../shell/nativeGuard'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { createMockForgeApi } from '../test/mockApi'
import type { DbStatus, TunnelRowDto } from '../wire/types'

const REF = '$PROJECTHOME/others/cloud/a_tunnelconfig.xml'
const rows: TunnelRowDto[] = [
  { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'db.svc', target_port: 3306, user: 'dev-user' },
  { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'web.svc', target_port: 8080, user: 'dev-user' },
]
const down: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

function setup(extra: { tunnelError?: string } = {}) {
  const tunnelCalls: { row: TunnelRowDto; keyFile: string | null; hasPassword: boolean }[] = []
  const api = createMockForgeApi({ projectTree: [], documents: {}, tunnelRows: { [REF]: rows }, tunnelCalls, ...extra })
  render(<TunnelConfigEditor api={api} projectRoot="C:/p" reference={REF} db={down} onDbChange={vi.fn()} />)
  return { api, tunnelCalls }
}

describe('tunnel row menu', () => {
  beforeEach(() => window.localStorage.setItem('forge.tunnelView', 'table'))

  it('right click opens an own menu with the original entries first and prevents the browser menu', async () => {
    setup()
    const cell = await screen.findByText('web.svc')
    const notPrevented = fireEvent.contextMenu(cell)
    expect(notPrevented).toBe(false)
    const labels = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(labels).toEqual(['Add Tunnel', 'Delete Tunnel', 'Connect', 'Disconnect', 'Connect All', 'Disconnect All', 'Copy Target Address', 'Copy as host:port', 'Refresh'])
    expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('Connect shows the green state, Disconnect returns to grey', async () => {
    const user = userEvent.setup()
    const { tunnelCalls } = setup()
    fireEvent.contextMenu(await screen.findByText('db.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Connect' }))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Tunnel active' })).toHaveLength(1))
    expect(tunnelCalls[0].row.target_port).toBe(3306)
    await user.dblClick(screen.getByText('db.svc'))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Tunnel inactive' })).toHaveLength(2))
  })

  it('double click on a row connects it', async () => {
    const user = userEvent.setup()
    setup()
    await user.dblClick(await screen.findByText('web.svc'))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Tunnel active' })).toHaveLength(1))
  })

  it('a failed connect marks the row red with the message as tooltip and shows an alert', async () => {
    const user = userEvent.setup()
    setup({ tunnelError: 'plink.exe was not found. Install PuTTY (plink) and try again.' })
    await user.dblClick(await screen.findByText('web.svc'))
    const icon = await screen.findByRole('img', { name: 'Tunnel error' })
    expect(icon).toHaveAttribute('title', expect.stringContaining('plink.exe was not found'))
    expect(screen.getByRole('alert')).toHaveTextContent('plink.exe was not found')
  })

  it('Connect All opens every row and the Stop button closes all', async () => {
    const user = userEvent.setup()
    setup()
    fireEvent.contextMenu(await screen.findByText('db.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Connect All' }))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Tunnel active' })).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Stop tunnels' }))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'Tunnel inactive' })).toHaveLength(2))
  })

  it('passes the typed password to the backend without echoing it anywhere', async () => {
    const user = userEvent.setup()
    const { tunnelCalls } = setup()
    await user.type(await screen.findByLabelText('Tunnel password'), 'pw-secret')
    await user.dblClick(screen.getByText('web.svc'))
    await waitFor(() => expect(tunnelCalls).toHaveLength(1))
    expect(tunnelCalls[0].hasPassword).toBe(true)
    expect(document.body.textContent).not.toContain('pw-secret')
  })

  it('copy entries write the target address and host:port', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    setup()
    fireEvent.contextMenu(await screen.findByText('web.svc'))
    await user.click(screen.getByRole('menuitem', { name: 'Copy as host:port' }))
    expect(writeText).toHaveBeenCalledWith('web.svc:8080')
    expect(hostPort(rows[0])).toBe('db.svc:3306')
  })

  it('menu model enables entries by state', () => {
    const m = buildRowMenu({ rowUp: true, rowBusy: false, anyUp: true, allUp: true })
    const on = (id: string) => m.find((e) => e.id === id)!.enabled
    expect(on('connect')).toBe(false)
    expect(on('disconnect')).toBe(true)
    expect(on('connectAll')).toBe(false)
    expect(on('disconnectAll')).toBe(true)
  })
})

describe('context menu popup', () => {
  const entries = [
    { id: 'a', label: 'First', enabled: true },
    { id: 'b', label: 'Second', enabled: false, hint: 'Not available' },
    { id: 'c', label: 'Third', enabled: true },
  ]

  it('arrow keys skip disabled entries, Enter picks, Escape closes', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<TreeContextMenu entries={entries} x={5} y={5} onPick={onPick} onClose={onClose} />)
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Third' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('c')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('a disabled entry keeps its tooltip and does not pick; click outside closes', async () => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<TreeContextMenu entries={entries} x={5} y={5} onPick={onPick} onClose={onClose} />)
    const disabled = screen.getByRole('menuitem', { name: 'Second' })
    expect(disabled).toHaveAttribute('title', 'Not available')
    fireEvent.click(disabled)
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('native menu guard', () => {
  it('prevents the browser menu on any element and opens an own text menu on inputs', async () => {
    render(
      <div>
        <NativeMenuGuard release />
        <p>plain</p>
        <input aria-label="field" defaultValue="hello" />
      </div>,
    )
    expect(fireEvent.contextMenu(screen.getByText('plain'))).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(fireEvent.contextMenu(screen.getByLabelText('field'))).toBe(false)
    const labels = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(labels).toEqual(['Cut', 'Copy', 'Paste', 'Select All'])
  })

  it('blocks developer tool and reload shortcuts only in release builds', () => {
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    const { unmount } = render(<NativeMenuGuard release />)
    expect(press({ key: 'F12' })).toBe(true)
    expect(press({ key: 'I', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(press({ key: 'r', ctrlKey: true })).toBe(true)
    expect(press({ key: 's', ctrlKey: true })).toBe(false)
    unmount()
    render(<NativeMenuGuard release={false} />)
    expect(press({ key: 'F12' })).toBe(false)
  })

  it('helpers: key list, text field detection and entry state', () => {
    expect(isBlockedBrowserKey({ key: 'F5', ctrlKey: false, shiftKey: false, metaKey: false })).toBe(true)
    expect(isBlockedBrowserKey({ key: 'z', ctrlKey: true, shiftKey: false, metaKey: false })).toBe(false)
    const input = document.createElement('input')
    expect(textFieldOf(input)).toBe(input)
    expect(textFieldOf(document.createElement('div'))).toBeNull()
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(textFieldOf(checkbox)).toBeNull()
    const entriesOf = textMenuEntries(input)
    expect(entriesOf.find((e) => e.id === 'cut')!.enabled).toBe(false)
    expect(entriesOf.find((e) => e.id === 'paste')!.enabled).toBe(true)
  })
})
