import { beforeEach, describe, expect, it } from 'vitest'
import { _resetTunnelStateForTests, getTunnelState, projectOfPath, setSystemsDb, setTunnelError, setProgress, systemKey, systemNameOf, systemPhase, tunnelConnecting } from './tunnelState'
import { createMockForgeApi } from '../test/mockApi'

const UP = { connected: true, tunnel_up: true, database: 'db', host: 'h' }

describe('tunnel state per system', () => {
  beforeEach(() => _resetTunnelStateForTests())

  it('a tunnel belongs to its system, not to the run configuration', () => {
    setSystemsDb([
      { system: 'FFG', status: UP, active: false },
      { system: 'SVB', status: { ...UP, connected: false, tunnel_up: false }, active: true },
    ])
    const s = getTunnelState()
    expect(systemPhase('FFG', s)).toBe('on')
    expect(systemPhase('SVB', s)).toBe('off')
    expect(systemPhase('Other', s)).toBe('off')
  })

  it('connecting and errors are tracked per system', () => {
    tunnelConnecting(true, 'FFG')
    expect(systemPhase('FFG')).toBe('connecting')
    expect(systemPhase('SVB')).toBe('off')
    tunnelConnecting(false, 'FFG')
    setTunnelError('refused', 'FFG')
    expect(systemPhase('FFG')).toBe('error')
    expect(systemPhase('SVB')).toBe('off')
  })

  it('two systems stay open next to each other; activating one keeps the other', async () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    await api.dbConnect('t', 's', null, null, 'FFG')
    await api.dbConnect('t', 's', null, null, 'SVB')
    expect((await api.dbSystems()).map((e) => e.system)).toEqual(['FFG', 'SVB'])
    expect(await api.dbActivate('FFG')).toBe(true)
    await api.dbDisconnect('SVB')
    const left = await api.dbSystems()
    expect(left).toEqual([{ system: 'FFG', status: expect.objectContaining({ connected: true }), active: true }])
    setSystemsDb(left)
    expect(systemPhase('FFG')).toBe('on')
    expect(systemPhase('SVB')).toBe('off')
  })

  it('the same system name in two projects never shares a tunnel', () => {
    setSystemsDb([{ system: systemKey('C:/Work/FFG', 'dev1'), status: UP, active: true }])
    const s = getTunnelState()
    expect(systemPhase(systemKey('C:\\work\\ffg\\', 'dev1'), s)).toBe('on')
    expect(systemPhase(systemKey('C:/Work/SVB', 'dev1'), s)).toBe('off')
    expect(systemNameOf(systemKey('C:/Work/FFG', 'dev1'))).toBe('dev1')
  })

  it('finds the project of a file by the longest matching root', () => {
    const projects = ['C:/Work/FFG', 'C:/Work/FFG/sub']
    expect(projectOfPath(projects, 'C:\\Work\\FFG\\system\\dev1\\dev1.aod')).toBe('C:/Work/FFG')
    expect(projectOfPath(projects, 'C:/Work/FFG/sub/system/x.aod')).toBe('C:/Work/FFG/sub')
    expect(projectOfPath(projects, 'C:/Work/FFGX/a.aod')).toBeNull()
  })

  it('a running connect shows connecting with its phase until it finishes', () => {
    const k = systemKey('C:/Work/FFG', 'dev1')
    setProgress(k, 'Waiting for the database', false)
    expect(systemPhase(k, getTunnelState())).toBe('connecting')
    expect(getTunnelState().progressBy[k].phase).toBe('Waiting for the database')
    expect(systemPhase(systemKey('C:/Work/FFG', 'dev2'), getTunnelState())).toBe('off')
    setProgress(k, 'Connected', true)
    expect(systemPhase(k, getTunnelState())).toBe('off')
  })
})
