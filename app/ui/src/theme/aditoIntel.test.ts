import { describe, expect, it } from 'vitest'
import { aliasTables, classMembers, entityNames, findAditoTokens, languageKeys, libraryExports, localVariables, stringContext, suggestionsFor, type ProjectKnowledge } from './aditoIntel'

const known: ProjectKnowledge = {
  fields: ['NAME', 'CITY'],
  params: ['ObjectId_param'],
  libraries: ['Activity_lib', 'Utils_lib'],
  languageKeys: ['Activity_Title', 'Common_Save'],
  tables: [{ table: 'ACTIVITY', columns: ['ACTIVITYID', 'TITLE'] }, { table: 'ADDRESS', columns: ['ADDRESSID'] }],
}

describe('stringContext', () => {
  it('recognises the calls ADITO scripts put names into', () => {
    expect(stringContext('const x = vars.get("$field.NA')).toEqual({ kind: 'variable', prefix: '$field.NA' })
    expect(stringContext('vars.set("$sys.')).toEqual({ kind: 'variable', prefix: '$sys.' })
    expect(stringContext('import { Utils } from "Ut')).toEqual({ kind: 'import', prefix: 'Ut' })
    expect(stringContext('translate.text("Activity_')).toEqual({ kind: 'translate', prefix: 'Activity_' })
    expect(stringContext('newSelect("ACT')?.kind).toBe('sql')
    expect(stringContext('  .from("AD')).toEqual({ kind: 'sql', prefix: 'AD' })
  })

  it('stays silent outside of such calls and outside of strings', () => {
    expect(stringContext('const text = "hello')).toBeNull()
    expect(stringContext('vars.get(')).toBeNull()
    expect(stringContext('vars.get("$field.A") + "x')).toBeNull()
  })
})

describe('sources', () => {
  it('reads fields, parameters, tables, language keys and exports', () => {
    expect(entityNames('<entityField>\n<name>CITY</name>\n</entityField><entityParameter><name>P_param</name></entityParameter>')).toEqual({ fields: ['CITY'], params: ['P_param'] })
    expect(aliasTables('<entityDb><name>ACTIVITY</name><entityFieldDb><name>TITLE</name></entityFieldDb></entityDb>')).toEqual([{ table: 'ACTIVITY', columns: ['TITLE'] }])
    expect(languageKeys('<stringEntry><name>A_B</name><value>x</value></stringEntry>')).toEqual(['A_B'])
    expect(libraryExports('export class ActivityUtils {}\nexport function load() {}\nexport { a as b }')).toEqual(['ActivityUtils', 'load', 'b'])
  })
})

describe('suggestionsFor', () => {
  it('offers fields, parameters and system variables for vars.get', () => {
    const labels = suggestionsFor({ kind: 'variable', prefix: '$' }, known).map((s) => s.label)
    expect(labels).toContain('$field.NAME')
    expect(labels).toContain('$param.ObjectId_param')
    expect(labels).toContain('$sys.recordstate')
  })

  it('narrows by what was typed', () => {
    expect(suggestionsFor({ kind: 'variable', prefix: '$field.ci' }, known).map((s) => s.label)).toEqual(['$field.CITY'])
    expect(suggestionsFor({ kind: 'import', prefix: 'util' }, known).map((s) => s.label)).toEqual(['Utils_lib'])
  })

  it('offers tables, then the columns of the table before the dot', () => {
    expect(suggestionsFor({ kind: 'sql', prefix: 'AC' }, known).map((s) => s.label)).toEqual(['ACTIVITY'])
    expect(suggestionsFor({ kind: 'sql', prefix: 'activity.' }, known).map((s) => s.label)).toEqual(['ACTIVITY.ACTIVITYID', 'ACTIVITY.TITLE'])
  })
})

describe('library members and tokens', () => {
  const lib = `export class KeywordUtils {
  /** Reads the relations of an object. */
  static getAttributeRelationsByKey(pKey, pType) {
    if (pKey) { return []; }
  }

  static async load() {}

  constructor() {}
}
export function other() {}`

  it('lists the methods of an exported class with their comment', () => {
    const members = classMembers(lib, 'KeywordUtils')
    expect(members.map((m) => m.name)).toEqual(['getAttributeRelationsByKey', 'load'])
    expect(members[0]).toMatchObject({ signature: 'getAttributeRelationsByKey(pKey, pType)', isStatic: true, doc: 'Reads the relations of an object.' })
    expect(classMembers(lib, 'Missing')).toEqual([])
  })

  it('finds ADITO variables inside strings and calls outside of them', () => {
    const text = 'if(vars.get("$this.value") == null) { var d = vars.getString("$field.DIRECTION"); } // vars.get("$field.X")'
    const tokens = findAditoTokens(text)
    const variables = tokens.filter((t) => t.kind === 'variable').map((t) => text.slice(t.start, t.end))
    const calls = tokens.filter((t) => t.kind === 'call').map((t) => text.slice(t.start, t.end))
    expect(variables).toEqual(['$this.value', '$field.DIRECTION'])
    expect(calls).toEqual(['get', 'getString'])
  })

  it('collects the local variables a script uses', () => {
    expect(localVariables('vars.set("$local.a", 1); vars.get("$local.b"); vars.get("$local.a")')).toEqual(['a', 'b'])
  })
})
