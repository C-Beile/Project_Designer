import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemDef } from '../../shell/menuModel'
import {
  _resetPluginRegistryForTests,
  getDialog,
  hasCommand,
  isPluginAvailable,
  registerCommand,
  registerDialog,
  registerMenuContribution,
  registerOptionsPage,
  registerPlugin,
  registerShellExtension,
  setPluginData,
  useDialog,
  usePluginData,
  useShellExtensions,
  registerStatusBarItem,
  registerToolbarItem,
  registerTreeContextItem,
  runCommandById,
  toolbarItemState,
  useMenuContributions,
  useOptionsPages,
  usePlugins,
  useStatusBarItems,
  useToolbarItems,
  useTreeContextItems,
  type PluginInfo,
} from './registry'

const Dummy = () => null
const plugin = (id: string, requires?: string[]): PluginInfo => ({
  id, name: id, category: 'x', version: '1', description: '', requires, switchable: true,
})
const item = (id: string): MenuItemDef => ({ id, kind: 'item', label: id, enabled: true })

beforeEach(() => _resetPluginRegistryForTests())

describe('plugins', () => {
  it('availability needs the plugin and its requires', () => {
    registerPlugin(plugin('git', ['base']))
    expect(isPluginAvailable('git')).toBe(false)
    registerPlugin(plugin('base'))
    expect(isPluginAvailable('git')).toBe(true)
    expect(isPluginAvailable('nope')).toBe(false)
  })

  it('cyclic requires are not available and do not hang', () => {
    registerPlugin(plugin('a', ['b']))
    registerPlugin(plugin('b', ['a']))
    expect(isPluginAvailable('a')).toBe(false)
  })

  it('unregister and reset remove plugins', () => {
    const off = registerPlugin(plugin('git'))
    expect(isPluginAvailable('git')).toBe(true)
    off()
    expect(isPluginAvailable('git')).toBe(false)
    registerPlugin(plugin('git'))
    _resetPluginRegistryForTests()
    expect(isPluginAvailable('git')).toBe(false)
  })

  it('usePlugins updates on registration', () => {
    const { result } = renderHook(() => usePlugins())
    expect(result.current).toHaveLength(0)
    act(() => { registerPlugin(plugin('git')) })
    expect(result.current.map((p) => p.id)).toEqual(['git'])
  })
})

describe('commands', () => {
  it('runs, reports and unregisters', () => {
    const run = vi.fn()
    const off = registerCommand('x.run', run)
    expect(hasCommand('x.run')).toBe(true)
    expect(runCommandById('x.run', 1, 2)).toBe(true)
    expect(run).toHaveBeenCalledWith(1, 2)
    off()
    expect(hasCommand('x.run')).toBe(false)
    expect(runCommandById('x.run')).toBe(false)
  })

  it('plugin commands need their plugin', () => {
    const run = vi.fn()
    registerCommand('git.commit', run, 'git')
    expect(runCommandById('git.commit')).toBe(false)
    registerPlugin(plugin('git'))
    expect(runCommandById('git.commit')).toBe(true)
  })
})

describe('menu contributions', () => {
  it('sorts by order, filters by menu, when and plugin', () => {
    registerPlugin(plugin('git'))
    registerMenuContribution({ menu: 'team', order: 20, items: [item('b')], plugin: 'git' })
    registerMenuContribution({ menu: 'team', order: 10, items: [item('a')] })
    registerMenuContribution({ menu: 'team', order: 5, items: [item('hidden')], when: () => false })
    registerMenuContribution({ menu: 'team', order: 1, items: [item('ghost')], plugin: 'missing' })
    registerMenuContribution({ menu: 'other', order: 1, items: [item('o')] })
    const { result } = renderHook(() => useMenuContributions('team'))
    expect(result.current.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('a menu contribution that throws is skipped and the others stay', () => {
    registerMenuContribution({ menu: 'team', order: 1, items: () => { throw new Error('boom') } })
    registerMenuContribution({ menu: 'team', order: 2, items: [item('ok')] })
    const { result } = renderHook(() => useMenuContributions('team'))
    expect(result.current.map((i) => i.id)).toEqual(['ok'])
  })

  it('a toolbar state that throws dims only that button', () => {
    const throwing = { id: 't', group: 'g', order: 1, label: 'Bad', command: 'x', state: () => { throw new Error('boom') } }
    expect(toolbarItemState(throwing, { hasProject: true, pluginActive: true })).toMatchObject({ enabled: false })
    expect(toolbarItemState({ ...throwing, state: undefined }, { hasProject: true, pluginActive: true })).toEqual({ enabled: true })
  })

  it('hook updates on new registration and on unregister', () => {
    const { result } = renderHook(() => useMenuContributions('team'))
    expect(result.current).toEqual([])
    let off = () => {}
    act(() => { off = registerMenuContribution({ menu: 'team', order: 1, items: [item('a')] }) })
    expect(result.current).toHaveLength(1)
    act(() => off())
    expect(result.current).toHaveLength(0)
  })
})

describe('options pages', () => {
  it('sorts, replaces by id and honours plugin', () => {
    registerPlugin(plugin('git'))
    registerOptionsPage({ id: 'b', category: 'Git', title: 'B', component: Dummy, order: 2, plugin: 'git' })
    registerOptionsPage({ id: 'a', category: 'Core', title: 'A', component: Dummy, order: 1 })
    registerOptionsPage({ id: 'a', category: 'Core', title: 'A2', component: Dummy, order: 1 })
    registerOptionsPage({ id: 'c', category: 'Core', title: 'C', component: Dummy, order: 0, plugin: 'none' })
    const { result } = renderHook(() => useOptionsPages())
    expect(result.current.map((p) => p.title)).toEqual(['A2', 'B'])
  })
})

describe('toolbar items', () => {
  it('filters by group, sorts, honours when', () => {
    registerToolbarItem({ id: 'push', group: 'git', label: 'Push', command: 'git.push', order: 2 })
    registerToolbarItem({ id: 'commit', group: 'git', label: 'Commit', command: 'git.commit', order: 1 })
    registerToolbarItem({ id: 'off', group: 'git', label: 'Off', command: 'x', order: 0, when: () => false })
    registerToolbarItem({ id: 'save', group: 'file', label: 'Save', command: 'save', order: 0 })
    const { result } = renderHook(() => useToolbarItems('git'))
    expect(result.current.map((i) => i.id)).toEqual(['commit', 'push'])
  })

  it('when is re-evaluated on every render', () => {
    let on = false
    registerToolbarItem({ id: 'x', group: 'g', label: 'X', command: 'x', order: 0, when: () => on })
    const { result, rerender } = renderHook(() => useToolbarItems('g'))
    expect(result.current).toHaveLength(0)
    on = true
    rerender()
    expect(result.current).toHaveLength(1)
  })
})

describe('status bar items', () => {
  it('filters by align and sorts', () => {
    registerStatusBarItem({ id: 'r2', align: 'right', component: Dummy, order: 2 })
    registerStatusBarItem({ id: 'r1', align: 'right', component: Dummy, order: 1 })
    registerStatusBarItem({ id: 'l', align: 'left', component: Dummy, order: 0 })
    const right = renderHook(() => useStatusBarItems('right'))
    expect(right.result.current.map((i) => i.id)).toEqual(['r1', 'r2'])
    const left = renderHook(() => useStatusBarItems('left'))
    expect(left.result.current.map((i) => i.id)).toEqual(['l'])
  })
})

describe('tree context items', () => {
  it('matches object types, sorts, honours plugin', () => {
    registerPlugin(plugin('git'))
    registerTreeContextItem({ id: 'hist', objectTypes: ['file', 'folder'], label: 'History', command: 'git.history', order: 2, plugin: 'git' })
    registerTreeContextItem({ id: 'open', objectTypes: ['file'], label: 'Open', command: 'open', order: 1 })
    registerTreeContextItem({ id: 'gone', objectTypes: ['file'], label: 'Gone', command: 'g', order: 0, plugin: 'missing' })
    const file = renderHook(() => useTreeContextItems('file'))
    expect(file.result.current.map((i) => i.id)).toEqual(['open', 'hist'])
    const folder = renderHook(() => useTreeContextItems('folder'))
    expect(folder.result.current.map((i) => i.id)).toEqual(['hist'])
    const none = renderHook(() => useTreeContextItems(null))
    expect(none.result.current).toEqual([])
  })

  it('hook updates when the plugin appears', () => {
    registerTreeContextItem({ id: 'hist', objectTypes: ['file'], label: 'H', command: 'h', order: 0, plugin: 'git' })
    const { result } = renderHook(() => useTreeContextItems('file'))
    expect(result.current).toHaveLength(0)
    act(() => { registerPlugin(plugin('git')) })
    expect(result.current).toHaveLength(1)
  })
})

describe('dialogs', () => {
  it('returns registered dialogs only while the plugin is available', () => {
    registerDialog({ id: 'git.commit', component: Dummy, plugin: 'git' })
    expect(getDialog('git.commit')).toBeUndefined()
    registerPlugin(plugin('git'))
    expect(getDialog('git.commit')?.component).toBe(Dummy)
    expect(getDialog('unknown')).toBeUndefined()
  })
})

describe('useDialog', () => {
  it('updates when the plugin appears and disappears', () => {
    registerDialog({ id: 'git.scmPanel', component: Dummy, plugin: 'git' })
    const { result } = renderHook(() => useDialog('git.scmPanel'))
    expect(result.current).toBeUndefined()
    let off!: () => void
    act(() => { off = registerPlugin(plugin('git')) })
    expect(result.current?.component).toBe(Dummy)
    act(() => off())
    expect(result.current).toBeUndefined()
  })
})

describe('shell extensions', () => {
  it('lists extensions of available plugins only, sorted by order', () => {
    registerPlugin(plugin('git'))
    registerShellExtension({ id: 'b', order: 2, component: Dummy, plugin: 'git' })
    registerShellExtension({ id: 'a', order: 1, component: Dummy })
    registerShellExtension({ id: 'gone', order: 0, component: Dummy, plugin: 'missing' })
    const { result } = renderHook(() => useShellExtensions())
    expect(result.current.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('plugin data', () => {
  it('sets and removes data per plugin id', () => {
    const { result } = renderHook(() => usePluginData())
    expect(result.current).toEqual({})
    let off!: () => void
    act(() => { off = setPluginData('git', { branch: 'main' }) })
    expect(result.current).toEqual({ git: { branch: 'main' } })
    act(() => off())
    expect(result.current).toEqual({})
  })
})
