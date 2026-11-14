import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_TOML_THEMES } from '../../src/theme/builtinThemes'
import { applyThemeTokens, contrastRatio, parseTheme } from '../../src/theme/themeToml'
import { THEME_KEYS } from '../../src/theme/themeSchema'

const minimal = (extra: string) => `[theme]\nid = "t"\nname = "T"\nkind = "dark"\n${extra}`

describe('parseTheme', () => {
  it('maps own keys to CSS variables', () => {
    const t = parseTheme(minimal('[surface]\nbase = "#101010"\n[button.primary]\nbackground = "#2a78b4"\n'))
    expect(t.tokens).toEqual({ '--bg': '#101010', '--button-bg': '#2a78b4' })
    expect(t.meta).toMatchObject({ id: 't', name: 'T', kind: 'dark' })
  })

  it('resolves @references and reports cycles and unknown targets', () => {
    const t = parseTheme(minimal('[accent]\nprimary = "#4aa8e8"\n[selection]\nbackground = "@accent.primary"\ntext = "@selection.row"\nrow = "@selection.text"\n[border]\nfocus = "@nope.nothing"\n'))
    expect(t.tokens['--selected-bg']).toBe('#4aa8e8')
    expect(t.warnings.join('\n')).toMatch(/Zyklus/)
    expect(t.warnings.join('\n')).toMatch(/nicht gefunden/)
  })

  it('warns about unknown keys, bad colours and low contrast but still loads', () => {
    const t = parseTheme(minimal('[surface]\nbase = "#ffffff"\nmystery = "#000000"\n[text]\nprimary = "#eeeeee"\n[state]\nerror = "red"\n'))
    const w = t.warnings.join('\n')
    expect(w).toMatch(/surface\.mystery/)
    expect(w).toMatch(/state\.error.*keine Farbe/)
    expect(w).toMatch(/Kontrast/)
    expect(t.tokens['--bg']).toBe('#ffffff')
  })

  it('ignores internal keys such as folder colours', () => {
    expect(parseTheme(minimal('[icon.folder]\nsystem = "#4a80c8"\n')).warnings.join()).toMatch(/icon\.folder\.system/)
  })

  it('rejects a file without [theme] or with a wrong kind', () => {
    expect(() => parseTheme('[surface]\nbase = "#000000"\n')).toThrow()
    expect(() => parseTheme('[theme]\nid = "t"\nname = "T"\nkind = "sepia"\n')).toThrow(/kind/)
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('red', '#ffffff')).toBeNull()
  })
})

describe('applyThemeTokens', () => {
  it('sets and removes the variables', () => {
    const el = document.createElement('div')
    applyThemeTokens({ '--bg': '#123456' }, el)
    expect(el.style.getPropertyValue('--bg')).toBe('#123456')
    applyThemeTokens(undefined, el)
    expect(el.style.getPropertyValue('--bg')).toBe('')
  })
})

describe('built-in Lion theme', () => {
  const lion = BUILTIN_TOML_THEMES.lion

  it('loads without warnings and sets every schema key', () => {
    expect(lion.warnings).toEqual([])
    expect(Object.keys(lion.tokens).sort()).toEqual(THEME_KEYS.map((k) => k.cssVar).sort())
  })

  it('has the same colours as the Lion block in tokens.css', () => {
    const css = readFileSync(resolve(__dirname, '../../src/theme/tokens.css'), 'utf8')
    const block = css.slice(css.indexOf(":root[data-theme='lion'] {"))
    const fromCss: Record<string, string> = {}
    for (const m of block.matchAll(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8});/gm)) fromCss[m[1]] = m[2].toLowerCase()
    for (const [name, value] of Object.entries(lion.tokens)) expect(fromCss[name], name).toBe(value.toLowerCase())
  })
})
