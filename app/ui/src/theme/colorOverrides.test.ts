import { beforeEach, describe, expect, it } from 'vitest'
import { COLOR_GROUPS, applyColorOverrides, editorOverrides, reloadColorOverrides, saveColorOverrides } from './colorOverrides'

describe('colour overrides', () => {
  beforeEach(() => {
    saveColorOverrides({ colors: {}, uiFont: '' })
    document.documentElement.removeAttribute('style')
  })

  it('puts interface colours and the font on the window and takes them off again', () => {
    const next = { colors: { '--accent': '#112233' }, uiFont: 'Inter' }
    saveColorOverrides(next)
    applyColorOverrides(next)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#112233')
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('Inter')
    applyColorOverrides({ colors: {}, uiFont: '' })
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('')
  })

  it('keeps the editor and code colours for the editor theme', () => {
    saveColorOverrides({ colors: { '--bg': '#000000', 'editor:editor.background': '#101010', 'syntax:comment': '#abcdef' }, uiFont: '' })
    const mine = editorOverrides()
    expect(mine.colors).toEqual({ 'editor.background': '#101010' })
    expect(mine.rules).toEqual([{ token: 'comment', foreground: 'abcdef' }])
  })

  it('survives a reload from storage and ignores damaged values', () => {
    saveColorOverrides({ colors: { '--accent': '#112233' }, uiFont: '' })
    window.localStorage.setItem('forge.colorOverrides.v1', JSON.stringify({ colors: { '--accent': '#112233', '--bg': 'red' }, uiFont: 5 }))
    reloadColorOverrides()
    expect(editorOverrides().colors).toEqual({})
    expect(COLOR_GROUPS.map((g) => g.id)).toContain('primary')
  })
})
