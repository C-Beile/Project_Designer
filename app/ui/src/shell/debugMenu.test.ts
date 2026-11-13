import { afterEach, describe, expect, it } from 'vitest'
import { registerMenuContribution } from '../core/plugins/registry'
import { buildMenus, type MenuContext } from './menuModel'

const base: MenuContext = {
  hasProject: true,
  projectName: 'p',
  hasSelection: false,
  hasUnsaved: false,
  canUndo: false,
  canRedo: false,
  recentProject: null,
  theme: 'dark',
  transpileRunning: false,
  engine: 'official',
}

describe('Debug menu', () => {
  const undo: Array<() => void> = []
  afterEach(() => undo.splice(0).forEach((u) => u()))

  it('is missing outside a dev build', () => {
    expect(buildMenus({ ...base, devBuild: false }).some((m) => m.id === 'debug')).toBe(false)
  })

  it('sits before Help and has Rebuild Index in a dev build', () => {
    const menus = buildMenus({ ...base, devBuild: true })
    const i = menus.findIndex((m) => m.id === 'debug')
    expect(i).toBeGreaterThan(-1)
    expect(menus[i + 1].id).toBe('help')
    const index = menus[i].items.find((x) => x.id === 'debug.index')!
    expect(index.children!.map((x) => x.id)).toEqual(['debug.rebuildIndex', 'debug.dumpIndex'])
  })

  it('disables Rebuild Index without a project', () => {
    const debug = buildMenus({ ...base, hasProject: false, devBuild: true }).find((m) => m.id === 'debug')!
    const index = debug.items.find((x) => x.id === 'debug.index')!
    expect(index.children!.find((x) => x.id === 'debug.rebuildIndex')!.enabled).toBe(false)
  })

  it('lets a plugin add its own entries', () => {
    undo.push(registerMenuContribution({ menu: 'debug', order: 10, items: [{ id: 'x.dump', kind: 'item', label: 'Dump', command: 'x.dump', enabled: true }] }))
    const debug = buildMenus({ ...base, devBuild: true }).find((m) => m.id === 'debug')!
    expect(debug.items.map((x) => x.id)).toEqual(['debug.index', 'x.dump'])
  })
})
