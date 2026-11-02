import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSystemTunnels } from './useSystemTunnels'
import { _resetTunnelStateForTests, getTunnelState, overallPhase, setForwardFor, setSystemsDb, systemKey, systemPhase } from './tunnelState'
import { createMockForgeApi } from '../test/mockApi'
import type { TreeNode, WireValue } from '../wire/types'

const text = (value: string): WireValue => ({ kind: 'text', value })
const sysTree: WireValue = { kind: 'object', fields: [{ key: 'name', value: text('dev1') }, { key: 'tunnelConfigPath', value: text('$PROJECTHOME/t.xml') }, { key: 'serverConfigPath', value: text('$PROJECTHOME/s.xml') }] }
const node: TreeNode = { id: 'C:/p/system/dev1/dev1.aod', label: 'dev1', object_type: 'system', is_leaf: true, children: [] }
const top: TreeNode = { id: 'C:/p', label: 'p', object_type: null, is_leaf: false, children: [{ id: 'f', label: 'system', object_type: null, folder: 'system', is_leaf: false, children: [node] } as TreeNode] }
const KEY = systemKey('C:/p', 'dev1')

beforeEach(() => _resetTunnelStateForTests())

describe('system tunnel and database session belong together', () => {
  it('opens the session by itself when the database tunnel stands and closes it when the tunnel closes', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: { [node.id]: sysTree } })
    let up = true
    vi.spyOn(api, 'systemTunnelState').mockImplementation(async () => ({ db_tunnel_up: up, target: 'db:3306', problem: null }))
    const connect = vi.spyOn(api, 'dbConnect')
    renderHook(() => useSystemTunnels(api, ['C:/p'], { 'C:/p': [top] }))
    await waitFor(() => expect(connect).toHaveBeenCalledWith(expect.stringContaining('t.xml'), expect.stringContaining('s.xml'), null, null, KEY))
    await waitFor(() => expect(systemPhase(KEY, getTunnelState())).toBe('on'))
    up = false
    const disconnect = vi.spyOn(api, 'dbDisconnect')
    // the mock session reports tunnel_up, so it counts as its own tunnel and stays; only a dead session is closed
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('an open tunnel without a session is yellow, never green; another system does not count', () => {
    setForwardFor(KEY, true)
    const s = getTunnelState()
    expect(systemPhase(KEY, s)).toBe('open')
    expect(systemPhase(systemKey('C:/p', 'dev2'), s)).toBe('off')
    expect(overallPhase(s)).toBe('open')
    setSystemsDb([{ system: KEY, status: { connected: true, tunnel_up: true, database: 'd', host: 'h' }, active: true }])
    expect(overallPhase(getTunnelState())).toBe('on')
  })
})
