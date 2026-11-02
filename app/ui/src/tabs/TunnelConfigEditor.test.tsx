import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TunnelConfigEditor, copyText, isTunnelActive } from './TunnelConfigEditor'
import { isDefaultRow } from '../properties/PropertySheetPanel'
import { createMockForgeApi } from '../test/mockApi'
import { subTabsFor, tunnelTabNode } from './tabModel'
import type { DbStatus, SheetRow, TunnelRowDto } from '../wire/types'

const REF = '$PROJECTHOME/others/cloud/a_tunnelconfig.xml'
const rows: TunnelRowDto[] = [
  { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'db.svc', target_port: 3306, user: 'dev-user' },
  { tunnel_host: 'ssh.example', tunnel_port: 22, target_host: 'web.svc', target_port: 8080, user: 'dev-user' },
]
const up: DbStatus = { connected: true, tunnel_up: true, database: 'sys', host: 'db.svc' }
const down: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

function setup(db: DbStatus, onDbChange = vi.fn()) {
  const api = createMockForgeApi({ projectTree: [], documents: {}, tunnelRows: { [REF]: rows } })
  render(<TunnelConfigEditor api={api} projectRoot="C:/p" reference={REF} db={db} onDbChange={onDbChange} />)
  return { api, onDbChange }
}

describe('TunnelConfigEditor', () => {
  it('shows the six columns and one row per tunnel', async () => {
    setup(down)
    expect(await screen.findByText('db.svc')).toBeInTheDocument()
    for (const h of ['Status', 'Tunnel Host Address', 'Tunnel Host Port', 'Target Server Address', 'Target Server Port', 'Username']) {
      expect(screen.getByText(h)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('img', { name: 'Tunnel inactive' })).toHaveLength(2)
  })

  it('marks only the tunnel to the connected database as active', async () => {
    setup(up)
    await screen.findByText('db.svc')
    expect(screen.getAllByRole('img', { name: 'Tunnel active' })).toHaveLength(1)
    expect(isTunnelActive(rows[1], up)).toBe(false)
  })

  it('stop closes the tunnel and reports the new status', async () => {
    const user = userEvent.setup()
    const { onDbChange } = setup(up)
    await screen.findByText('db.svc')
    await user.click(screen.getByRole('button', { name: 'Stop tunnels' }))
    await vi.waitFor(() => expect(onDbChange).toHaveBeenCalledWith(expect.objectContaining({ tunnel_up: false })))
  })

  it('copy text holds addresses only', () => {
    expect(copyText(rows[0])).toBe('ssh.example:22 -> db.svc:3306')
  })
})

describe('tunnel tab and default rows', () => {
  it('tunnel tab has the Editor view only and carries the reference', () => {
    const node = tunnelTabNode('sys-1', 'dev1', REF)
    expect(node.label).toBe('a_tunnelconfig.xml - dev1')
    expect(node.path).toBe(REF)
    expect(subTabsFor(node)).toEqual(['editor'])
  })

  it('empty, unset and unchecked rows are default (grey italic), set values are not', () => {
    const base: SheetRow = { name: 'x', kind: 'text', display: '', set: true, editable: true, typed: false }
    expect(isDefaultRow(base)).toBe(true)
    expect(isDefaultRow({ ...base, display: 'v' })).toBe(false)
    expect(isDefaultRow({ ...base, display: 'v', set: false })).toBe(true)
    expect(isDefaultRow({ ...base, kind: 'bool', display: 'true', value: { kind: 'bool', value: true } })).toBe(false)
    expect(isDefaultRow({ ...base, kind: 'bool', display: 'false', value: { kind: 'bool', value: false } })).toBe(true)
  })
})
