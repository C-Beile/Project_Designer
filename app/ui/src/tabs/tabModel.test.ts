import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../wire/types'
import { EMPTY_TABS, activeTab, closeTab, closeTabsWhere, openTab, setSubTab, subTabsFor } from './tabModel'

function node(id: string, objectType: string | null = 'entity', kind?: TreeNode['kind']): TreeNode {
  return { id, label: id, object_type: objectType, is_leaf: true, children: [], kind }
}

describe('tab model', () => {
  it('opening an object twice focuses the existing tab instead of adding a second one', () => {
    let s = openTab(EMPTY_TABS, node('a'), 'P')
    s = openTab(s, node('b'), 'P')
    s = openTab(s, node('a'), 'P')
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(s.activeId).toBe('a')
  })

  it('closing the active tab activates its right neighbour, else the left one, else nothing', () => {
    let s = EMPTY_TABS
    for (const id of ['a', 'b', 'c']) s = openTab(s, node(id), 'P')
    s = { ...s, activeId: 'b' }
    s = closeTab(s, 'b')
    expect(s.activeId).toBe('c')
    s = closeTab(s, 'c')
    expect(s.activeId).toBe('a')
    s = closeTab(s, 'a')
    expect(s).toEqual({ tabs: [], activeId: null })
  })

  it('closing an inactive tab keeps the active one', () => {
    let s = openTab(openTab(EMPTY_TABS, node('a'), 'P'), node('b'), 'P')
    s = closeTab(s, 'a')
    expect(s.activeId).toBe('b')
  })

  it('offers Editor|Source|History, Users in between for system and alias, and Editor|History for files', () => {
    expect(subTabsFor(node('e', 'entity'))).toEqual(['editor', 'source', 'history'])
    expect(subTabsFor(node('v', 'neonView'))).toEqual(['editor', 'source', 'history'])
    expect(subTabsFor(node('s', 'system'))).toEqual(['editor', 'users', 'source', 'history'])
    expect(subTabsFor(node('a', 'aliasDefinition'))).toEqual(['editor', 'users', 'source', 'history'])
    expect(subTabsFor(node('p', 'process'))).toEqual(['editor', 'source', 'history'])
    expect(subTabsFor(node('f', null, 'file'))).toEqual(['editor', 'history'])
  })

  it('ignores a sub-tab the object does not have', () => {
    const s = openTab(EMPTY_TABS, node('e', 'entity'), 'P')
    expect(activeTab(setSubTab(s, 'e', 'users'))?.sub).toBe('editor')
    expect(activeTab(setSubTab(s, 'e', 'source'))?.sub).toBe('source')
  })

  it('closes all tabs of a project', () => {
    let s = openTab(EMPTY_TABS, node('a'), 'P1')
    s = openTab(s, node('b'), 'P2')
    s = openTab(s, node('c'), 'P1')
    s = closeTabsWhere(s, (t) => t.project === 'P1')
    expect(s.tabs.map((t) => t.id)).toEqual(['b'])
    expect(s.activeId).toBe('b')
  })
})
