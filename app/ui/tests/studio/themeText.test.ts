import { describe, expect, it } from 'vitest'
import { parseTheme } from '../../src/theme/themeToml'
import { THEME_KEYS } from '../../src/theme/themeSchema'
import { groupKeys, retitleTheme, setKeyInText, themeFileName, toColorInput } from '../../src/studio/themeText'

const text = `[theme]
name = "T"
id = "t"
kind = "dark"
author = "Lion"

[surface]
base = "#111111"   # main surface
raised = "#222222"

[button.primary]
background = "#333333"
`

describe('setKeyInText', () => {
  it('changes a value and keeps the comment', () => {
    expect(setKeyInText(text, 'surface.base', '#abcdef')).toContain('base = "#abcdef"   # main surface')
  })

  it('works for a nested section', () => {
    expect(setKeyInText(text, 'button.primary.background', '#010203')).toContain('background = "#010203"')
  })

  it('adds a missing key to its section and a missing section at the end', () => {
    const added = setKeyInText(text, 'surface.inset', '#444444')
    expect(parseTheme(added).tokens['--bg-inset']).toBe('#444444')
    expect(added.indexOf('inset =')).toBeLessThan(added.indexOf('[button.primary]'))
    const section = setKeyInText(text, 'border.focus', '#555555')
    expect(parseTheme(section).tokens['--focus-ring']).toBe('#555555')
  })

  it('keeps CRLF line endings', () => {
    const crlf = text.replace(/\n/g, '\r\n')
    const out = setKeyInText(crlf, 'surface.raised', '#999999')
    expect(out.includes('\r\n')).toBe(true)
    expect(out.replace(/\r\n/g, '').includes('\n')).toBe(false)
  })

  it('does not touch the same name in another section', () => {
    const other = '[text]\nbase = "#000000"\n[surface]\nbase = "#111111"\n'
    expect(setKeyInText(other, 'surface.base', '#ffffff')).toBe('[text]\nbase = "#000000"\n[surface]\nbase = "#ffffff"\n')
  })
})

describe('themeFileName', () => {
  it('makes a safe file name', () => {
    expect(themeFileName('Mein Théme 2!')).toBe('mein-theme-2.theme.toml')
    expect(themeFileName('  --  ')).toBeNull()
    expect(themeFileName('../etc')).toBe('etc.theme.toml')
  })
})

describe('retitleTheme', () => {
  it('sets name, id and kind and clears the author', () => {
    const out = parseTheme(retitleTheme(text, 'My "copy"', 'my-copy.theme.toml', 'light'))
    expect(out.meta).toMatchObject({ name: 'My copy', id: 'my-copy', kind: 'light' })
    expect(out.meta.author).toBe('')
  })
})

describe('groupKeys and toColorInput', () => {
  it('groups every schema key exactly once', () => {
    expect(groupKeys().flatMap((g) => g.keys.map((k) => k.key)).sort()).toEqual(THEME_KEYS.map((k) => k.key).sort())
    expect(groupKeys().map((g) => g.label)).toContain('Surfaces')
  })

  it('shortens colours to #rrggbb for the colour input', () => {
    expect(toColorInput('#abc')).toBe('#aabbcc')
    expect(toColorInput('#11223344')).toBe('#112233')
    expect(toColorInput('red')).toBe('#000000')
  })
})
