import { describe, expect, it, vi } from 'vitest'
import { linkedFilePathOf, objectRoot } from './objectRoot'
import { codeFilePath, processCodeTarget } from './codeSave'
import type { ForgeApi } from '../api/ForgeApi'
import type { TreeNode } from '../wire/types'

const PKG = 'C:\\Users\\c\\Desktop\\GitRepos_ADITO\\FFG\\node_modules\\@aditosoftware\\document-template'
const MODULE_PROCESS = `${PKG}\\process\\AddressFormatter_lib\\AddressFormatter_lib.aod`
const MODULE_ENTITY = `${PKG}/entity/Doc_entity/Doc_entity.aod`
const PROJECT_PROCESS = 'C:\\proj\\process\\My_lib\\My_lib.aod'

describe('linked file root', () => {
  it('is the package folder for module objects and the project folder for project objects', () => {
    expect(objectRoot(MODULE_PROCESS)).toBe(PKG.replace(/\\/g, '/'))
    expect(objectRoot(MODULE_ENTITY)).toBe(PKG.replace(/\\/g, '/'))
    expect(objectRoot(PROJECT_PROCESS)).toBe('C:/proj')
  })

  it('resolves module process, module entity script and project process references', () => {
    expect(linkedFilePathOf(MODULE_PROCESS, '%aditoprj%/process/AddressFormatter_lib/process.js')).toBe(`${PKG.replace(/\\/g, '/')}/process/AddressFormatter_lib/process.js`)
    expect(linkedFilePathOf(MODULE_ENTITY, '%aditoprj%/entity/Doc_entity/entityfields/title/valueProcess.js')).toContain('node_modules/@aditosoftware/document-template/entity/Doc_entity/entityfields/title/valueProcess.js')
    expect(linkedFilePathOf(PROJECT_PROCESS, '%aditoprj%/process/My_lib/process.js')).toBe('C:/proj/process/My_lib/process.js')
  })

  it('never produces a root-less path for a process opened by double click (backslash node id)', async () => {
    const api = {
      getPropertySheet: vi.fn(async () => ({ name: 'AddressFormatter_lib', groups: [{ rows: [{ name: 'process', set: true, value: { kind: 'text', value: '%aditoprj%/process/AddressFormatter_lib/process.js' } }] }] })),
    } as unknown as ForgeApi
    const node = { id: MODULE_PROCESS } as TreeNode
    const target = await processCodeTarget(api, node)
    expect(target?.linkedRoot).toBe(PKG.replace(/\\/g, '/'))
    expect(codeFilePath(target!)).toMatch(/^C:\/Users\/.*\/node_modules\/@aditosoftware\/document-template\/process\/AddressFormatter_lib\/process\.js$/)
  })
})
