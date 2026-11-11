import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KIND_CONTEXT, KIND_GROUP, addChild, moveNode, nodeAt, parseApplicationTree, removeNode, setNodeField, validateReferences } from './applicationTree'

// Real files of the corpus fixtures: Pichler uses CRLF line endings.
const FIXTURES = resolve(__dirname, '../../../../crates/aod/tests/fixtures')
const load = (project: string) => readFileSync(resolve(FIXTURES, project, 'application/_____SYSTEM_APPLICATION_NEON/_____SYSTEM_APPLICATION_NEON.aod'), 'utf-8')

function wellFormed(text: string): boolean {
  return new DOMParser().parseFromString(text, 'application/xml').getElementsByTagName('parsererror').length === 0
}

function count(node: { kind: number | null; children: unknown[] }, kind: number): number {
  return (node.kind === kind ? 1 : 0) + (node.children as (typeof node)[]).reduce((n, c) => n + count(c, kind), 0)
}

describe.each(['Pichler', 'Hermes'])('application tree of %s', (project) => {
  const text = load(project)

  it('reads the root, groups, contexts and titles', () => {
    const root = parseApplicationTree(text)!
    expect(root.kind).toBe(200)
    expect(root.children[0].kind).toBe(KIND_GROUP)
    expect(root.children[0].name).toBe('Contactmanagement')
    expect(root.children[0].title).toBe('Contact Management')
    expect(root.children[0].icon).toBe('VAADIN:CONNECT')
    expect(count(root, KIND_CONTEXT)).toBe((text.match(/<kind v="10077" \/>/g) ?? []).length)
  })

  it('adding an entry and removing it again restores the file byte for byte', () => {
    const added = addChild(text, [0, 0], 1, KIND_CONTEXT, 'Brand_new_context')!
    expect(added).not.toBe(text)
    expect(wellFormed(added)).toBe(true)
    const root = parseApplicationTree(added)!
    expect(nodeAt(root, [0, 0, 1])!.name).toBe('Brand_new_context')
    expect(removeNode(added, [0, 0, 1])).toBe(text)
  })

  it('moving an entry down and back restores the file byte for byte', () => {
    const before = parseApplicationTree(text)!
    const group = nodeAt(before, [0, 0])!
    expect(group.children.length).toBeGreaterThan(2)
    const moved = moveNode(text, [0, 0, 0], [0, 0], 3)!
    expect(wellFormed(moved)).toBe(true)
    const after = parseApplicationTree(moved)!
    expect(nodeAt(after, [0, 0, 2])!.name).toBe(group.children[0].name)
    expect(moveNode(moved, [0, 0, 2], [0, 0], 0)).toBe(text)
  })

  it('moves a whole group into another group with the right indentation and back', () => {
    const before = parseApplicationTree(text)!
    const second = before.children[1]
    const moved = moveNode(text, [1], [0], before.children[0].children.length)!
    expect(wellFormed(moved)).toBe(true)
    const after = parseApplicationTree(moved)!
    expect(after.children.length).toBe(before.children.length - 1)
    const inner = nodeAt(after, [0, before.children[0].children.length])!
    expect(inner.name).toBe(second.name)
    expect(inner.children.length).toBe(second.children.length)
    expect(count(after, KIND_CONTEXT)).toBe(count(before, KIND_CONTEXT))
    expect(moveNode(moved, [0, before.children[0].children.length], [], 1)).toBe(text)
  })

  it('refuses to move a group into itself', () => {
    expect(moveNode(text, [0], [0, 0], 0)).toBeNull()
  })

  it('changes a title and restores it', () => {
    const changed = setNodeField(text, [0], 'title', 'Kontakte & Co')!
    expect(changed).toContain('<title>Kontakte &amp; Co</title>')
    expect(wellFormed(changed)).toBe(true)
    expect(setNodeField(changed, [0], 'title', 'Contact Management')).toBe(text)
  })

  it('removing the only child of a group removes its childNodes element', () => {
    const grouped = addChild(text, [], 0, KIND_GROUP, 'GroupX', '')!
    const filled = addChild(grouped, [0], 0, KIND_CONTEXT, 'OnlyOne')!
    expect(filled).toContain('<childNodes>')
    expect(removeNode(filled, [0, 0])).toBe(grouped)
    expect(removeNode(grouped, [0])).toBe(text)
  })
})

describe('reference check', () => {
  it('flags unknown contexts and roles but not INTERNAL_ roles', () => {
    const root = parseApplicationTree(load('Hermes'))!
    const issues = validateReferences(root, { contexts: new Set(['Person']), dashboards: new Set(), roles: new Set() })
    expect(issues.some((i) => i.message === "Context 'Organisation' not found")).toBe(true)
    expect(issues.some((i) => i.message.includes('INTERNAL_'))).toBe(false)
    expect(issues.some((i) => i.message === "Context 'Person' not found")).toBe(false)
  })
})
