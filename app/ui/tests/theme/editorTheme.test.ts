import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_TOML_THEMES } from '../../src/theme/builtinThemes'
import { _resetEditorThemeForTests, getActiveEditorTheme, mergeEditorTheme, restoreEditorTheme, setActiveEditorTheme, subscribeEditorTheme } from '../../src/theme/editorTheme'
import { parseTheme } from '../../src/theme/themeToml'
import type { MonacoThemeData } from '../../src/theme/vscodeTheme'

afterEach(_resetEditorThemeForTests)

const base: MonacoThemeData = { base: 'vs-dark', inherit: true, rules: [{ token: 'comment', foreground: '111111' }], colors: { 'editor.background': '#000000', focusBorder: '#123456' } }

const theme = `[theme]
name = "T"
id = "t"
kind = "light"

[editor]
background = "#fafafa"
selection = "#ccddee"

[editor.syntax]
comment = "#008800"
keyword = "#0000ff"
string = "#a31515"
`

describe('editor colours of a TOML theme', () => {
  it('are read with the Monaco names', () => {
    const parsed = parseTheme(theme)
    expect(parsed.editor.colors).toEqual({ 'editor.background': '#fafafa', 'editor.selectionBackground': '#ccddee' })
    expect(parsed.editor.syntax.comment).toEqual({ color: '#008800', italic: true })
    expect(parsed.editor.syntax.keyword).toEqual({ color: '#0000ff', italic: false })
    expect(parsed.warnings).toEqual([])
  })

  it('warn about an unknown editor key', () => {
    expect(parseTheme(theme + 'mystery = "#000000"\n').warnings.join()).toMatch(/editor\.syntax\.mystery/)
  })

  it('go on top of a built-in Monaco theme and also colour SQL text', () => {
    setActiveEditorTheme(parseTheme(theme))
    const merged = mergeEditorTheme(base, getActiveEditorTheme()!)
    expect(merged.colors).toMatchObject({ 'editor.background': '#fafafa', focusBorder: '#123456', 'editor.selectionBackground': '#ccddee' })
    expect(merged.colors['peekViewEditor.background']).toBe('#fafafa')
    const tokens = merged.rules.map((r) => r.token)
    expect(tokens).toEqual(expect.arrayContaining(['comment', 'keyword', 'string', 'string.sql', 'comment.sql']))
    expect(merged.rules.find((r) => r.token === 'comment.sql')).toMatchObject({ foreground: '008800', fontStyle: 'italic' })
    expect(tokens.lastIndexOf('comment')).toBeGreaterThan(0)
  })

  it('tell listeners about a change and stay quiet when nothing changed', () => {
    let calls = 0
    subscribeEditorTheme(() => calls++)
    setActiveEditorTheme(parseTheme(theme))
    setActiveEditorTheme(parseTheme(theme))
    expect(calls).toBe(1)
    restoreEditorTheme(null)
    expect(calls).toBe(2)
    expect(getActiveEditorTheme()).toBeNull()
  })

  it('are empty for a theme without an editor part', () => {
    setActiveEditorTheme(parseTheme('[theme]\nid = "t"\nname = "T"\nkind = "dark"\n'))
    expect(getActiveEditorTheme()).toBeNull()
  })

  it('give Lion the colours of its Monaco theme', () => {
    const { colors, syntax } = BUILTIN_TOML_THEMES.lion.editor
    expect(colors['editor.background']).toBe('#2b2b2b')
    expect(colors['editor.selectionBackground']).toBe('#2a78b4')
    expect(syntax.keyword.color).toBe('#569cd6')
    expect(syntax.comment).toEqual({ color: '#8a8a8a', italic: true })
  })
})
