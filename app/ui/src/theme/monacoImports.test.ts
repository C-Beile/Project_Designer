import { describe, expect, it, vi } from 'vitest'
import { exportLine, parseImports } from './monacoImports'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

describe('import navigation', () => {
  const text = `import { neon, vars } from "@aditosoftware/jdito-types";
import { ContactUtils as CU, Other } from "Contact_lib";
import {
  A,
  B
} from 'Multi_lib';
import Def from "Default_lib";
`

  it('reads the module and the imported names of every import, also over several lines', () => {
    const imports = parseImports(text)
    expect(imports.map((i) => i.spec)).toEqual(['@aditosoftware/jdito-types', 'Contact_lib', 'Multi_lib', 'Default_lib'])
    expect(imports[1].names.get('CU')).toBe('ContactUtils')
    expect(imports[1].names.get('Other')).toBe('Other')
    expect([...imports[2].names.keys()]).toEqual(['A', 'B'])
    expect(imports[3].names.get('Def')).toBe('')
  })

  it('finds the line of an export and falls back to the first line', () => {
    const lib = `/** doc */\nexport function Helper() {}\nexport const Value = 1\nexport { Listed, Other as Alias }\n`
    expect(exportLine(lib, 'Helper')).toBe(2)
    expect(exportLine(lib, 'Value')).toBe(3)
    expect(exportLine(lib, 'Listed')).toBe(4)
    expect(exportLine(lib, 'Missing')).toBe(1)
    expect(exportLine(lib, '')).toBe(1)
  })
})
