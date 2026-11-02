import { describe, expect, it, vi } from 'vitest'
import { codeFilePath, codeTabNode, saveCodeProperty } from './codeSave'
import { createMockForgeApi } from '../test/mockApi'
import type { CodeTarget, PropertySheet } from '../wire/types'

const target: CodeTarget = { ownerNodeId: 'C:/p/entity/Thing_entity/Thing_entity.aod', ownerName: 'Thing_entity', path: '$', prop: 'onInit', reference: '%aditoprj%/entity/Thing_entity/onInit.js', linkedRoot: 'C:\\p', isNew: true }
const sheet = (over: Partial<PropertySheet>): PropertySheet => ({ name: 'Thing_entity', type_label: 'entity', path: '$', groups: [], catalog_missing: false, ...over })

function apiWith(s: PropertySheet) {
  const api = createMockForgeApi({ projectTree: [], documents: {} })
  api.getPropertySheet = async () => s
  api.writeLinkedFile = vi.fn(async () => {})
  api.setSheetProperty = vi.fn(async () => ({ tree: { kind: 'object' as const, fields: [] }, can_undo: true, can_redo: false }))
  api.setModificationScript = vi.fn(async () => ({ action: 'created' as const, dir: 'Thing-onInit-1' }))
  return api
}

describe('code tab of a property', () => {
  it('has the file name as title and the resolved file as id', () => {
    expect(codeFilePath(target)).toBe('C:/p/entity/Thing_entity/onInit.js')
    const node = codeTabNode(target, false)
    expect(node.label).toBe('onInit.js')
    expect(node.kind).toBe('file')
    expect(node.code).toBe(target)
  })

  it('the first save creates the file and writes the reference', async () => {
    const api = apiWith(sheet({}))
    const result = await saveCodeProperty(api, target, 'x', 'C:/proj')
    expect(api.writeLinkedFile).toHaveBeenCalledWith('C:\\p', target.reference, 'x')
    expect(api.setSheetProperty).toHaveBeenCalledWith(target.ownerNodeId, '$', 'onInit', { kind: 'text', value: target.reference }, false)
    expect(result.outcome).toBeDefined()
  })

  it('a later save only writes the file', async () => {
    const api = apiWith(sheet({}))
    await saveCodeProperty(api, { ...target, isNew: false }, 'y', 'C:/proj')
    expect(api.writeLinkedFile).toHaveBeenCalled()
    expect(api.setSheetProperty).not.toHaveBeenCalled()
  })

  it('a module object gets its modification automatically, without asking', async () => {
    const api = apiWith(sheet({ read_only: 'module' }))
    const result = await saveCodeProperty(api, target, 'z', 'C:/proj')
    expect(api.enabledModifications).toEqual([target.ownerNodeId])
    expect(api.writeLinkedFile).not.toHaveBeenCalled()
    expect(result.message).toMatch(/Thing-onInit-1/)
  })

  it('a module object without an open project is refused with a clear message', async () => {
    const api = apiWith(sheet({ read_only: 'module' }))
    await expect(saveCodeProperty(api, target, 'z', '')).rejects.toThrow(/Open a project first/)
    expect(api.setModificationScript).not.toHaveBeenCalled()
  })
})
