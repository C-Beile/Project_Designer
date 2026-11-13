import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../test/mockApi'
import { _flushAppConfigForTests, _resetAppConfigForTests, configGet, configSet, loadAppConfig, onConfigChange, touches } from './appConfig'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  _resetAppConfigForTests()
})

function api(initial: Record<string, unknown> = {}) {
  const sent: { path: string[]; value: unknown }[] = []
  const base = createMockForgeApi({ projectTree: [], documents: {} })
  return {
    sent,
    api: {
      ...base,
      configGet: async () => initial,
      configSet: async (path: string[], value: unknown) => {
        sent.push({ path, value })
      },
    },
  }
}

describe('appConfig', () => {
  it('loads the file once and reads synchronously by path', async () => {
    const { api: a } = api({ appearance: { theme: 'light', zoom: 1.25 } })
    await loadAppConfig(a)
    expect(configGet('appearance', 'theme')).toBe('light')
    expect(configGet<{ zoom: number }>('appearance')?.zoom).toBe(1.25)
    expect(configGet('appearance', 'nope')).toBeUndefined()
    expect(configGet('missing', 'deeper')).toBeUndefined()
  })

  it('writes to memory at once and sends one bundled write per path after a short delay', async () => {
    const { api: a, sent } = api()
    await loadAppConfig(a)
    configSet(['appearance', 'theme'], 'dark')
    configSet(['appearance', 'theme'], 'light')
    expect(configGet('appearance', 'theme')).toBe('light')
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(400)
    expect(sent).toEqual([{ path: ['appearance', 'theme'], value: 'light' }])
  })

  it('null or undefined deletes the value and empty sections vanish', async () => {
    const { api: a, sent } = api({ popups: { git: { x: 1 } } })
    await loadAppConfig(a)
    configSet(['popups', 'git', 'x'], undefined)
    expect(configGet('popups')).toBeUndefined()
    _flushAppConfigForTests()
    expect(sent).toEqual([{ path: ['popups', 'git', 'x'], value: null }])
  })

  it('a key may contain dots and slashes', async () => {
    const { api: a } = api()
    await loadAppConfig(a)
    configSet(['git', 'excluded', 'C:/Adito/p.q'], ['a.aod'])
    expect(configGet('git', 'excluded', 'C:/Adito/p.q')).toEqual(['a.aod'])
  })

  it('takes over changes from other windows, but not over its own unsent value', async () => {
    const { api: a } = api()
    let push: (p: unknown) => void = () => {}
    await loadAppConfig(a, (_event, handler) => {
      push = handler
      return () => {}
    })
    const seen: string[][] = []
    onConfigChange((p) => seen.push([...p]))
    push({ path: ['appearance', 'theme'], value: 'night' })
    expect(configGet('appearance', 'theme')).toBe('night')
    configSet(['appearance', 'zoom'], 1.5)
    push({ path: ['appearance', 'zoom'], value: 1 })
    expect(configGet('appearance', 'zoom')).toBe(1.5)
    expect(seen).toEqual([['appearance', 'theme'], ['appearance', 'zoom']])
  })

  it('touches() tells whether a change concerns a section', () => {
    expect(touches(['appearance', 'theme'], ['appearance'])).toBe(true)
    expect(touches(['appearance'], ['appearance', 'theme'])).toBe(true)
    expect(touches(['editor', 'x'], ['appearance'])).toBe(false)
  })
})
