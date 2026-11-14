import { afterEach, describe, expect, it } from 'vitest'
import { limitsConfig } from '../../src/config/limitsConfig'
import { fakeBackend } from '../support/fakeWindowBackend'
import { EVENTS } from '../../src/windows/protocol'
import { openDialogWindow, osPopupsAvailable, setWindowBackend } from '../../src/windows/windowService'

afterEach(() => setWindowBackend(null))

describe('popup limit from limits.toml', () => {
  it('reports no free slot once max-popups dialogs are open and frees it when one closes', async () => {
    const { backend } = fakeBackend()
    setWindowBackend(backend)
    const max = limitsConfig.windows.maxPopups
    const pending = Array.from({ length: max }, (_, i) => openDialogWindow(`d${i}`, 'D', { width: 100, height: 100 }, {}))
    await new Promise((r) => setTimeout(r, 0))
    expect(osPopupsAvailable()).toBe(false)
    expect(osPopupsAvailable('d0')).toBe(true)
    await backend.emit(EVENTS.windowResult, { kind: 'dialog', name: 'd0', result: null })
    await pending[0]
    expect(osPopupsAvailable()).toBe(true)
  })
})
