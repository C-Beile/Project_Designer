import { describe, expect, it } from 'vitest'
import { normalizeColor, parseThemePack, parseVsCodeTheme, stripJsonc, themeIdFor } from './vscodeTheme'

const sample = `{
  // a comment
  "name": "Sample Dark",
  "type": "dark",
  "colors": { "editor.background": "#1E1E1E", "editor.foreground": "#ccc", "bad": "red", },
  "tokenColors": [
    { "settings": { "foreground": "#d4d4d4" } },
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#6A9955", "fontStyle": "italic" } },
    { "scope": "string.quoted.double.js, constant.numeric.integer", "settings": { "foreground": "#CE9178" } },
    { "scope": "keyword.operator.assignment", "settings": { "foreground": "#d4d4d4" } },
    { "scope": "keyword.control", "settings": { "foreground": "#C586C0" } },
  ],
}`

describe('vscodeTheme', () => {
  it('removes comments and trailing commas but keeps text inside strings', () => {
    expect(JSON.parse(stripJsonc('{"a": "x // y", /* c */ "b": [1,2,],}'))).toEqual({ a: 'x // y', b: [1, 2] })
  })

  it('normalises colours', () => {
    expect(normalizeColor('#FFF')).toBe('#ffffff')
    expect(normalizeColor('#1E1E1E80')).toBe('#1e1e1e80')
    expect(normalizeColor('red')).toBeNull()
  })

  it('maps colours and scopes of a VS Code theme to Monaco', () => {
    const t = parseVsCodeTheme(sample, 'sample.json')
    expect(t.name).toBe('Sample Dark')
    expect(t.id).toBe(themeIdFor('Sample Dark'))
    expect(t.data.base).toBe('vs-dark')
    expect(t.data.colors['editor.background']).toBe('#1e1e1e')
    expect(t.data.colors['editor.foreground']).toBe('#cccccc')
    expect(t.data.colors['bad']).toBeUndefined()
    expect(t.data.rules).toContainEqual({ token: 'comment', foreground: '6a9955', fontStyle: 'italic' })
    expect(t.data.rules).toContainEqual({ token: 'string', foreground: 'ce9178' })
    expect(t.data.rules).toContainEqual({ token: 'number', foreground: 'ce9178' })
    expect(t.data.rules).toContainEqual({ token: 'operator', foreground: 'd4d4d4' })
    expect(t.data.rules).toContainEqual({ token: 'keyword', foreground: 'c586c0' })
  })

  it('uses the base of a light theme and refuses files that are no colour theme', () => {
    expect(parseVsCodeTheme('{"type":"light","colors":{"editor.background":"#fff"}}', 'l.json').data.base).toBe('vs')
    expect(() => parseVsCodeTheme('{"a":1}', 'x.json')).toThrow(/not a VS Code colour theme/)
    expect(() => parseVsCodeTheme('nope', 'x.json')).toThrow(/not valid JSON/)
    expect(() => parseVsCodeTheme('{"include":"./other.json"}', 'x.json')).toThrow(/includes another theme/)
  })
})

describe('parseThemePack', () => {
  const base = JSON.stringify({ name: 'Base', type: 'dark', colors: { 'editor.background': '#101010' }, tokenColors: [{ scope: 'comment', settings: { foreground: '#777777' } }] })
  const child = JSON.stringify({ name: 'Child', include: './base-theme.json', colors: { 'editor.foreground': '#eeeeee' }, tokenColors: [{ scope: 'string', settings: { foreground: '#00ff00' } }] })
  const manifest = JSON.stringify({ contributes: { themes: [{ label: 'My Child', uiTheme: 'vs-dark', path: './themes/child.json' }] } })

  it('finds the themes of an extension package and merges the included theme', () => {
    const themes = parseThemePack([
      { name: 'extension/package.json', text: manifest },
      { name: 'extension/themes/child.json', text: child.replace('./base-theme.json', './base-theme.json') },
      { name: 'extension/themes/base-theme.json', text: base },
    ])
    expect(themes).toHaveLength(1)
    expect(themes[0].name).toBe('My Child')
    expect(themes[0].data.colors['editor.background']).toBe('#101010')
    expect(themes[0].data.colors['editor.foreground']).toBe('#eeeeee')
    expect(themes[0].data.rules.map((r) => r.token)).toEqual(expect.arrayContaining(['comment', 'string']))
  })

  it('takes a single theme file and refuses a package without any colour theme', () => {
    expect(parseThemePack([{ name: 'night.json', text: base }])[0].name).toBe('Base')
    expect(() => parseThemePack([{ name: 'package.json', text: '{}' }])).toThrow(/No VS Code colour theme/)
  })
})

describe('TextMate themes (.tmTheme)', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>name</key><string>Sea</string>
<key>settings</key><array>
<dict><key>settings</key><dict><key>background</key><string>#1D262F</string><key>foreground</key><string>#88b4e7</string><key>caret</key><string>#34FEBB</string></dict></dict>
<dict><key>name</key><string>Comment</string><key>scope</key><string>comment</string><key>settings</key><dict><key>foreground</key><string>#444c55</string><key>fontStyle</key><string> italic</string></dict></dict>
</array></dict></plist>`

  it('reads the editor colours and the token colours of a plist theme', () => {
    const theme = parseVsCodeTheme(plist, 'Sea.tmTheme')
    expect(theme.name).toBe('Sea')
    expect(theme.data.base).toBe('vs-dark')
    expect(theme.data.colors['editor.background']).toBe('#1d262f')
    expect(theme.data.colors['editorCursor.foreground']).toBe('#34febb')
    expect(theme.data.rules.some((r) => r.token === 'comment' && r.fontStyle === 'italic')).toBe(true)
  })

  it('finds the themes of an extension that ships .tmTheme files', () => {
    const manifest = JSON.stringify({ contributes: { themes: [{ label: 'DuoTone Dark Sea', uiTheme: 'vs-dark', path: './themes/Sea.tmTheme' }] } })
    const themes = parseThemePack([
      { name: 'package.json', text: manifest },
      { name: 'themes/Sea.tmTheme', text: plist },
    ])
    expect(themes.map((t) => t.name)).toEqual(['DuoTone Dark Sea'])
  })
})

describe('TextMate themes colour the whole window', () => {
  const plist = `<plist version="1.0"><dict><key>name</key><string>Sea</string><key>settings</key><array>
<dict><key>settings</key><dict><key>background</key><string>#1D262F</string><key>foreground</key><string>#88b4e7</string><key>caret</key><string>#34FEBB</string></dict></dict>
<dict><key>scope</key><string>support.type.property-name</string><key>settings</key><dict><key>foreground</key><string>#ff8800</string></dict></dict>
<dict><key>scope</key><string>string</string><key>settings</key><dict><key>foreground</key><string>#34FEBB</string></dict></dict>
</array></dict></plist>`

  it('derives side bar, tabs and title bar from the editor colours', () => {
    const { colors } = parseVsCodeTheme(plist, 'Sea.tmTheme').data
    expect(colors['sideBar.background']).toBeTruthy()
    expect(colors['sideBar.background']).not.toBe(colors['editor.background'])
    expect(colors['titleBar.activeBackground']).toBeTruthy()
    expect(colors['button.background']).toBe('#34febb')
  })

  it('colours JSON keys and values through the Monaco token names', () => {
    const { rules } = parseVsCodeTheme(plist, 'Sea.tmTheme').data
    expect(rules.find((r) => r.token === 'string.key')?.foreground).toBe('ff8800')
    expect(rules.find((r) => r.token === 'string.value')?.foreground).toBe('34febb')
  })
})
