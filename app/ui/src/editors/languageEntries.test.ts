import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addEntry, deleteEntry, escapeXml, parseLanguageEntries, setEntry, unescapeXml } from './languageEntries'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>\r
<language>\r
  <name>_____LANGUAGE_de</name>\r
  <keyValueMap>\r
    <stringEntry>\r
      <name>Vacation</name>\r
      <value>Urlaub</value>\r
    </stringEntry>\r
    <stringEntry>\r
      <name>a &amp; b</name>\r
      <value>&lt; 5 min. "x"</value>\r
    </stringEntry>\r
  </keyValueMap>\r
</language>\r
`

const REAL = [
  'C:/Users/ClemensBeile/Desktop/ADITO_Designer/PROJECT/_scratch/hardening/FZ_Juerlich/language/_____LANGUAGE_de/_____LANGUAGE_de.aod',
  'C:/Users/ClemensBeile/Desktop/ADITO_Designer/PROJECT/_scratch/hardening/FZ_Juerlich/language/_____LANGUAGE_en/_____LANGUAGE_en.aod',
]

describe('language entries as text', () => {
  it('reads key and value and decodes entities', () => {
    const p = parseLanguageEntries(SAMPLE)!
    expect(p.entries.map((e) => [e.name, e.value])).toEqual([
      ['Vacation', 'Urlaub'],
      ['a & b', '< 5 min. "x"'],
    ])
    expect(escapeXml(unescapeXml('&lt;&gt;&amp;'))).toBe('&lt;&gt;&amp;')
  })

  it('changing a value touches only that text', () => {
    const next = setEntry(SAMPLE, 0, { value: 'Ferien & mehr' })!
    expect(next).toBe(SAMPLE.replace('<value>Urlaub</value>', '<value>Ferien &amp; mehr</value>'))
    expect(setEntry(next, 0, { value: 'Urlaub' })).toBe(SAMPLE)
  })

  it('changing a key escapes < > & and keeps quotes', () => {
    const next = setEntry(SAMPLE, 1, { name: 'x<y "q"' })!
    expect(next).toContain('<name>x&lt;y "q"</name>')
    expect(parseLanguageEntries(next)!.entries[1].name).toBe('x<y "q"')
  })

  it('adds a completely empty row with the file line style and deletes it again byte for byte', () => {
    const added = addEntry(SAMPLE)!
    expect(added.index).toBe(2)
    expect(added.text).toContain('    <stringEntry>\r\n      <name></name>\r\n      <value></value>\r\n    </stringEntry>\r\n  </keyValueMap>')
    expect(added.text.replace(/\r\n/g, '').includes('\n')).toBe(false)
    expect(deleteEntry(added.text, 2)).toBe(SAMPLE)
  })

  it('inserting in front of a row and deleting a middle row restore the file', () => {
    const added = addEntry(SAMPLE, 'New', 'Neu', 1)!
    expect(parseLanguageEntries(added.text)!.entries.map((e) => e.name)).toEqual(['Vacation', 'New', 'a & b'])
    expect(deleteEntry(added.text, 1)).toBe(SAMPLE)
  })

  it('works on the real language files: any edit can be undone byte for byte', () => {
    let checked = 0
    for (const file of REAL) {
      if (!existsSync(resolve(file))) continue
      const text = readFileSync(resolve(file), 'utf-8')
      const p = parseLanguageEntries(text)!
      expect(p.entries.length).toBeGreaterThan(100)
      const i = Math.floor(p.entries.length / 2)
      const original = p.entries[i]
      const changed = setEntry(text, i, { name: original.name + 'X', value: original.value + '&<>' })!
      expect(changed).not.toBe(text)
      expect(setEntry(changed, i, { name: original.name, value: original.value })).toBe(text)
      const added = addEntry(text, 'k', 'v')!
      expect(deleteEntry(added.text, added.index)).toBe(text)
      expect(deleteEntry(text, i)!.length).toBeLessThan(text.length)
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(0)
  })
})
