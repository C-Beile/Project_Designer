import { describe, expect, it } from 'vitest'
import { copyValuesPlan, removeKeysPlan } from './languageOps'
import { parseLanguageEntries } from './languageEntries'

const file = (entries: [string, string][]) =>
  `<language>\n  <name>L</name>\n  <keyValueMap>\n${entries.map(([k, v]) => `    <stringEntry>\n      <name>${k}</name>\n      <value>${v}</value>\n    </stringEntry>\n`).join('')}  </keyValueMap>\n</language>\n`

describe('language file operations', () => {
  it('removes every entry of the given keys and counts them', () => {
    const t = file([['a', '1'], ['b', '2'], ['a', '3'], ['c', '4']])
    const plan = removeKeysPlan(t, new Set(['a']))
    expect(plan.removed).toBe(2)
    expect(parseLanguageEntries(plan.text)!.entries.map((e) => e.name)).toEqual(['b', 'c'])
    expect(removeKeysPlan(t, new Set(['zzz'])).text).toBe(t)
  })

  it('copies missing keys and fills empty values, never replacing an existing value', () => {
    const to = file([['a', 'mine'], ['b', '']])
    const from = file([['a', 'theirs'], ['b', 'filled'], ['c', 'new']])
    const plan = copyValuesPlan(to, from)
    expect(plan).toMatchObject({ added: 1, filled: 1 })
    expect(parseLanguageEntries(plan.text)!.entries.map((e) => [e.name, e.value])).toEqual([
      ['a', 'mine'],
      ['b', 'filled'],
      ['c', 'new'],
    ])
    expect(copyValuesPlan(plan.text, from)).toMatchObject({ added: 0, filled: 0 })
  })
})
