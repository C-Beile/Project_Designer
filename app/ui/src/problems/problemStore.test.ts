import { beforeEach, describe, expect, it } from 'vitest'
import { countsByNode, errorCount, fromDiagnostic, fromProblemDto, getProblems, problemsFromBuildLog, resetProblemsForTests, setProblems } from './problemStore'

beforeEach(() => resetProblemsForTests())

describe('problem store', () => {
  it('keeps one list per channel and counts per object, ignoring path separators and case', () => {
    setProblems('scan:p', [
      fromProblemDto({ node_id: 'C:\\p\\entity\\A\\A.aod', object: 'A', object_type: 'entity', source: 'parse', severity: 'Error', message: 'bad', line: 4 }, 'scan:p'),
      fromProblemDto({ node_id: 'C:\\p\\entity\\B\\B.aod', object: 'B', object_type: 'entity', source: 'reference', severity: 'Warning', message: 'w' }, 'scan:p'),
    ])
    expect(getProblems()).toHaveLength(2)
    expect(errorCount(getProblems())).toBe(1)
    expect(countsByNode(getProblems()).get('c:/p/entity/a/a.aod')).toEqual({ errors: 1, warnings: 0 })
    setProblems('scan:p', [])
    expect(getProblems()).toHaveLength(0)
  })

  it('lets the live check of an object replace its scan findings', () => {
    const id = 'C:\\p\\entity\\A\\A.aod'
    setProblems('scan:p', [fromProblemDto({ node_id: id, object: 'A', object_type: 'entity', source: 'validator', severity: 'Error', message: 'old' }, 'scan:p')])
    setProblems(`live:${id}`, [fromDiagnostic({ severity: 'Error', message: 'new', path: 'x' }, id, 'A', `live:${id}`)])
    expect(getProblems().map((p) => p.message)).toEqual(['new'])
  })

  it('reads file, line and message out of a build log', () => {
    const log = ['[info] start', 'ERROR C:\\proj\\entity\\X\\X.aod:12:5 unexpected token', 'Transpile failed: exit 1'].join('\n')
    const list = problemsFromBuildLog(log)
    expect(list[0]).toMatchObject({ severity: 'Error', line: 12, column: 5, message: 'unexpected token' })
    expect(list[0].file).toBe('C:\\proj\\entity\\X\\X.aod')
    expect(list.some((p) => p.message.includes('Transpile failed'))).toBe(true)
  })
})
