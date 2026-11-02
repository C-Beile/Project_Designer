import { describe, expect, it } from 'vitest'
import { resolvePathVariables } from './pathVariables'

describe('path variables (appendix C)', () => {
  it('replaces $PROJECTHOME and keeps the rest of the path', () => {
    expect(resolvePathVariables('aditoDataPath', '$PROJECTHOME/data', { projectHome: 'C:/proj/' })).toEqual({ resolved: 'C:/proj/data', unresolved: [], problems: [] })
  })

  it('leaves variables with an unknown value as written and reports them', () => {
    const r = resolvePathVariables('aditoHomePath', '$ADITOHOME/lib', { projectHome: 'C:/proj' })
    expect(r.resolved).toBe('$ADITOHOME/lib')
    expect(r.unresolved).toEqual(['$ADITOHOME'])
  })

  it('does not allow $ADITODATA inside aditoDataPath, but inside other paths', () => {
    expect(resolvePathVariables('aditoDataPath', '$ADITODATA/x', {}).problems).toHaveLength(1)
    expect(resolvePathVariables('aditoHomePath', '$ADITODATA/x', { aditoData: 'D:/data' })).toMatchObject({ resolved: 'D:/data/x', problems: [] })
  })
})
