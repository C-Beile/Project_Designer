import { afterEach, describe, expect, it } from 'vitest'
import { applyUiTheme, uiTokensFor } from './uiTheme'
import type { MonacoThemeData } from './vscodeTheme'

const dark: MonacoThemeData = { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#112233', 'sideBar.background': '#223344', 'focusBorder': '#ff0000' } }

describe('uiTheme', () => {
  afterEach(() => {
    applyUiTheme(undefined, 'dark')
  })

  it('turns workbench colours into interface tokens and leaves unknown ones out', () => {
    const { tokens, light } = uiTokensFor(dark)
    expect(tokens['--bg']).toBe('#112233')
    expect(tokens['--bg-panel']).toBe('#223344')
    expect(tokens['--accent']).toBe('#ff0000')
    expect(tokens['--button-fg']).toBeUndefined()
    expect(light).toBe(false)
  })

  it('sets and removes the tokens on the document and picks the light base for light themes', () => {
    applyUiTheme({ ...dark, base: 'vs' }, 'dark')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#112233')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyUiTheme(undefined, 'lion')
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('')
    expect(document.documentElement.getAttribute('data-theme')).toBe('lion')
  })
})
