import { describe, expect, it } from 'vitest'
import { importedThemeToToml } from '../../src/studio/importedTheme'
import { parseTheme } from '../../src/theme/themeToml'
import type { ImportedTheme } from '../../src/theme/vscodeTheme'

const imported: ImportedTheme = {
  id: 'one-dark',
  name: 'One Dark',
  data: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'string.quoted', foreground: '98c379' },
    ],
    colors: { 'editor.background': '#282c34', 'editor.foreground': '#abb2bf', 'editorCursor.foreground': '#528bff' },
  },
}

describe('importedThemeToToml', () => {
  it('turns a VS Code theme into a theme file the Studio can read', () => {
    const parsed = parseTheme(importedThemeToToml(imported))
    expect(parsed.meta).toMatchObject({ name: 'One Dark', id: 'vscode:one-dark', kind: 'dark' })
    expect(parsed.editor.colors['editor.background']).toBe('#282c34')
    expect(parsed.editor.syntax.keyword?.color).toBe('#c678dd')
    expect(parsed.editor.syntax.string?.color).toBe('#98c379')
  })

  it('marks a light base as a light theme', () => {
    const light = { ...imported, data: { ...imported.data, base: 'vs' as const } }
    expect(parseTheme(importedThemeToToml(light)).meta.kind).toBe('light')
  })
})
