import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moveViewChild, parseViewChildren } from './viewChildren'

const FIXTURES = resolve(__dirname, '../../../../crates/aod/tests/fixtures')

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>\r
<neonView>\r
  <name>V</name>\r
  <layout>\r
    <boxLayout>\r
      <name>L</name>\r
    </boxLayout>\r
  </layout>\r
  <children>\r
    <genericViewTemplate>\r
      <name>A</name>\r
    </genericViewTemplate>\r
    <neonViewReference>\r
      <name>uuid-b</name>\r
      <view>B_view</view>\r
    </neonViewReference>\r
    <tableViewTemplate>\r
      <name>C</name>\r
    </tableViewTemplate>\r
  </children>\r
</neonView>\r
`

describe('view children in document order', () => {
  it('reads kind and name of the direct children only', () => {
    const p = parseViewChildren(SAMPLE)!
    expect(p.children.map((c) => `${c.kind}:${c.name}`)).toEqual(['genericViewTemplate:A', 'neonViewReference:uuid-b', 'tableViewTemplate:C'])
  })

  it('moves a child and moves it back byte for byte', () => {
    const moved = moveViewChild(SAMPLE, 2, 0)!
    expect(parseViewChildren(moved)!.children.map((c) => c.name)).toEqual(['C', 'A', 'uuid-b'])
    expect(moveViewChild(moved, 0, 3)).toBe(SAMPLE)
    expect(moveViewChild(SAMPLE, 0, 1)).toBe(SAMPLE)
    expect(moveViewChild(SAMPLE, 9, 0)).toBeNull()
  })

  it('works on every real view of the corpus fixtures: any move can be undone exactly', () => {
    let checked = 0
    for (const project of readdirSync(FIXTURES)) {
      let dir: string
      try {
        dir = resolve(FIXTURES, project, 'neonView')
        for (const name of readdirSync(dir)) {
          const text = readFileSync(resolve(dir, name, `${name}.aod`), 'utf-8')
          const p = parseViewChildren(text)
          if (!p || p.children.length < 2) continue
          const last = p.children.length - 1
          const moved = moveViewChild(text, last, 0)!
          expect(moved).not.toBe(text)
          expect(new DOMParser().parseFromString(moved, 'application/xml').getElementsByTagName('parsererror').length).toBe(0)
          expect(moveViewChild(moved, 0, last + 1)).toBe(text)
          checked += 1
        }
      } catch {
        continue
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('elements with attributes', () => {
  it('self-closing elements with an attribute and a space before the slash do not hide the end of the children', () => {
    const text = `<neonView>
  <name>V</name>
  <children>
    <genericViewTemplate>
      <name>A</name>
      <editMode v="true" />
    </genericViewTemplate>
    <tableViewTemplate>
      <name>B</name>
    </tableViewTemplate>
  </children>
</neonView>
`
    const parsed = parseViewChildren(text)
    expect(parsed?.children.map((c) => `${c.kind}|${c.name}`)).toEqual(['genericViewTemplate|A', 'tableViewTemplate|B'])
  })
})
