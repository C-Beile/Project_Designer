import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { _resetSshKeyCacheForTests, useSshKeyPath } from '../settings/sshKey'
import { _resetTunnelStateForTests, phaseOf, setSharedDb, setTunnelError, tunnelConnecting } from '../services/tunnelState'
import { maskStatement, subscribeOutput, logStatement } from './outputBus'
import { choiceDialog, confirmDialog, DialogHost, _resetDialogsForTests } from './dialogService'
import { dismissToast, getNotifications, notify, clearNotifications } from './notifications'
import { processCodeTarget } from '../properties/codeSave'
import { SystemEditor } from '../editors/SystemEditor'
import type { PropertySheet, TreeNode, WireValue } from '../wire/types'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

describe('SSH key path is remembered', () => {
  beforeEach(() => _resetSshKeyCacheForTests())

  it('is pre-filled from the settings and saved when changed, without losing other settings', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {}, settings: { designer_install_dir: 'D:/d', ssh_key_path: 'C:/keys/a.ppk' } })
    const set = vi.spyOn(api, 'setSettings')
    const { result } = renderHook(() => useSshKeyPath(api))
    await waitFor(() => expect(result.current[0]).toBe('C:/keys/a.ppk'))
    act(() => result.current[1]('C:/keys/b.ppk'))
    await waitFor(() => expect(set).toHaveBeenCalledWith({ designer_install_dir: 'D:/d', ssh_key_path: 'C:/keys/b.ppk' }))
    expect((await api.getSettings()).ssh_key_path).toBe('C:/keys/b.ppk')
  })
})

describe('tunnel state', () => {
  beforeEach(() => _resetTunnelStateForTests())
  const off = { connected: false, tunnel_up: false, database: null, host: null }

  it('maps the facts to grey, yellow, green and red', () => {
    expect(phaseOf({ db: off, forwardsUp: false, connecting: 0, error: null })).toBe('off')
    expect(phaseOf({ db: off, forwardsUp: false, connecting: 1, error: null })).toBe('connecting')
    expect(phaseOf({ db: { ...off, tunnel_up: true }, forwardsUp: false, connecting: 0, error: null })).toBe('on')
    expect(phaseOf({ db: off, forwardsUp: true, connecting: 0, error: null })).toBe('on')
    expect(phaseOf({ db: off, forwardsUp: false, connecting: 0, error: 'refused' })).toBe('error')
  })

  it('a started connection clears the old error and a success clears it as well', () => {
    setTunnelError('boom')
    tunnelConnecting(true)
    tunnelConnecting(false)
    setSharedDb({ ...off, connected: true })
    expect(phaseOf({ db: { ...off, connected: true }, forwardsUp: false, connecting: 0, error: null })).toBe('on')
  })
})

describe('Output > Database statement log', () => {
  it('writes the original wording and masks credential values', () => {
    const lines: string[] = []
    const off = subscribeOutput((sub, l) => sub === 'database' && lines.push(...l.map((x) => x.text)))
    logStatement('SELECT * FROM ASYS_USERS', [], 36)
    logStatement("UPDATE ASYS_USERS SET PASSWORD = 'hunter2' WHERE ID = 1", [], 4)
    off()
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d: ClientPreparedStatement\{sql:'SELECT \* FROM ASYS_USERS', parameters:\[\]\} \[36ms\]$/)
    expect(lines[1]).not.toContain('hunter2')
    expect(maskStatement("a  b\n c = 1")).toBe('a b c = 1')
  })
})

describe('in-app dialogs and notifications', () => {
  beforeEach(() => {
    _resetDialogsForTests()
    clearNotifications()
  })

  it('a question is answered with Enter, declined with Escape and never doubled', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    const first = confirmDialog('Delete it?', { okLabel: 'Delete' })
    const again = confirmDialog('Delete it?', { okLabel: 'Delete' })
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(await first).toBe(true)
    expect(await again).toBe(true)
    const second = confirmDialog('Really?')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(await second).toBe(false)
  })

  it('a choice dialog returns the clicked button', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    const p = choiceDialog('Unsaved', [{ id: 'save', label: 'Save' }, { id: 'discard', label: "Don't Save" }])
    await user.click(await screen.findByRole('button', { name: "Don't Save" }))
    expect(await p).toBe('discard')
  })

  it('a notification stays in the list after its toast is dismissed', () => {
    const id = notify('Modification created: modification/x', { timeoutMs: 0 })
    expect(getNotifications().filter((n) => n.toast)).toHaveLength(1)
    dismissToast(id)
    expect(getNotifications()).toHaveLength(1)
    expect(getNotifications()[0].toast).toBe(false)
  })
})

describe('process objects open their code', () => {
  const node: TreeNode = { id: 'C:/p/process/My_lib/My_lib.aod', label: 'My_lib', object_type: 'process', is_leaf: true, children: [], kind: 'object' }
  const text = (value: string): WireValue => ({ kind: 'text', value })

  function sheetWith(row: Record<string, unknown>): PropertySheet {
    return { name: 'My_lib', type_label: 'process', path: '$', catalog_missing: false, groups: [{ key: 'g', label: '', rows: [{ name: 'process', kind: 'linked', display: '', editable: true, typed: false, set: false, ...row }] }] } as PropertySheet
  }

  it('resolves the process.js of a set property and of a missing one', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    api.getPropertySheet = async () => sheetWith({ set: true, value: text('%aditoprj%/process/My_lib/process.js') })
    const target = await processCodeTarget(api, node)
    expect(target).toMatchObject({ prop: 'process', reference: '%aditoprj%/process/My_lib/process.js', linkedRoot: 'C:/p', isNew: false })
    api.getPropertySheet = async () => sheetWith({ new_reference: '%aditoprj%/process/My_lib/process.js' })
    expect((await processCodeTarget(api, node))?.isNew).toBe(true)
    api.getPropertySheet = async () => ({ ...sheetWith({}), groups: [] })
    expect(await processCodeTarget(api, node)).toBeNull()
  })
})

describe('system editor without a database connection', () => {
  beforeEach(() => {
    _resetTunnelStateForTests()
    _resetSshKeyCacheForTests()
  })
  const tree: WireValue = {
    kind: 'object',
    fields: [
      { key: 'name', value: { kind: 'text', value: 'dev1' } },
      { key: 'serverConfigPath', value: { kind: 'text', value: '$PROJECTHOME/others/s.xml' } },
      { key: 'tunnelConfigPath', value: { kind: 'text', value: '$PROJECTHOME/others/t.xml' } },
    ],
  }

  it('shows the unavailable panel and "Test tunnel" only looks at the tunnel without connecting anything', async () => {
    const user = userEvent.setup()
    const api = createMockForgeApi({ projectTree: [], documents: {}, aliasConfigs: {} })
    const connect = vi.spyOn(api, 'dbConnect')
    vi.spyOn(api, 'systemTunnelState').mockResolvedValue({ db_tunnel_up: false, target: null, problem: null })
    render(<SystemEditor nodeId="n" projectRoot="C:/demo" tree={tree} api={api} onTreeChange={() => {}} />)
    expect(await screen.findByText('Connection to database unavailable.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Test tunnel' }))
    await waitFor(() => expect(screen.getByLabelText('Connection details')).toHaveTextContent(/No tunnel is open/))
    expect(connect).not.toHaveBeenCalled()
  })
})
