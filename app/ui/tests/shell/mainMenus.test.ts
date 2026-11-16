import { describe, expect, it } from 'vitest'
import { buildMenus, item, registerMainMenu, type MenuContext } from '../../src/shell/menuModel'

const ctx: MenuContext = { hasProject: false, projectName: null, hasSelection: false, hasUnsaved: false, canUndo: false, canRedo: false, recentProject: null, theme: 'lion', transpileRunning: false, engine: 'official' }

describe('main menus as data', () => {
  it('a registered menu appears at its order, hides by its condition and leaves with its unregister', () => {
    let shown = true
    const off = registerMainMenu({ id: 'extra', label: 'Extra', mnemonic: 'x', order: 15, when: () => shown, items: () => [item('extra.run', 'Run Extra', true)] })
    const labels = () => buildMenus(ctx).map((m) => m.label)
    expect(labels().slice(0, 3)).toEqual(['File', 'Extra', 'Edit'])
    shown = false
    expect(labels()).not.toContain('Extra')
    shown = true
    off()
    expect(labels()).not.toContain('Extra')
  })
})
