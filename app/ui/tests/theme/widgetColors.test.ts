import { describe, expect, it } from 'vitest'
import { mergeEditorTheme, widgetColors } from '../../src/theme/editorTheme'

describe('widget colours follow the theme', () => {
  it('derives the peek view from the surfaces of the theme', () => {
    const colors = widgetColors({ 'editor.background': '#2b2b2b', 'editorWidget.background': '#303030', 'editor.foreground': '#d4d4d4', 'editorWidget.border': '#8a8a8a' })
    expect(colors['peekViewEditor.background']).toBe('#303030')
    expect(colors['peekViewResult.background']).toBe('#303030')
    expect(colors['peekViewBorder']).toBe('#8a8a8a')
  })

  it('does not keep the surfaces of the base theme when a theme brings its own', () => {
    const base = { base: 'vs-dark' as const, inherit: true, rules: [], colors: { 'editor.background': '#011627', 'editorWidget.background': '#021320' } }
    const merged = mergeEditorTheme(base, { id: 'x', kind: 'dark', colors: { 'editor.background': '#2b2b2b', 'editorWidget.background': '#303030' }, syntax: {} })
    expect(merged.colors['peekViewEditor.background']).toBe('#303030')
  })

  it('leaves a colour the theme sets itself alone', () => {
    const merged = mergeEditorTheme(
      { base: 'vs-dark', inherit: true, rules: [], colors: {} },
      { id: 'x', kind: 'dark', colors: { 'editor.background': '#111111', 'peekViewEditor.background': '#222222' }, syntax: {} },
    )
    expect(merged.colors['peekViewEditor.background']).toBe('#222222')
  })
})
