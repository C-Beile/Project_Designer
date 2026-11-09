import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EntityEditor, diagramRows, fieldRows } from './EntityEditor'
import { createMockForgeApi } from '../test/mockApi'
import type { WireValue } from '../wire/types'
import fixture from '../test/fixtures/activity_entity.tree.json'

// Real data: the property tree of Activity_entity from the module @aditosoftware/activity,
// dumped by the Rust backend itself (crates/project/examples/dump_tree.rs), so the JSON tags are the
// ones the running app really receives, not the ones the mocks assume.
const activity = fixture as unknown as WireValue

function kinds(v: WireValue, out: Set<string>) {
  out.add(v.kind)
  if (v.kind === 'object') v.fields.forEach((f) => kinds(f.value, out))
  if (v.kind === 'array') v.items.forEach((i) => kinds(i, out))
}

describe('wire contract with the Rust backend', () => {
  it('only uses the lowercase kinds the frontend types declare', () => {
    const seen = new Set<string>()
    kinds(activity, seen)
    expect([...seen].every((k) => ['text', 'bool', 'int', 'object', 'array'].includes(k))).toBe(true)
    expect(seen.has('object')).toBe(true)
  })
})

describe('Activity_entity diagram (real data)', () => {
  it('extracts name, providers and consumers', () => {
    const rows = diagramRows(activity)
    expect(rows.filter((r) => r.kind === 'provider').length).toBe(4)
    expect(rows.filter((r) => r.kind === 'consumer').length).toBe(17)
    expect(fieldRows(activity).length).toBeGreaterThan(50)
  })

  it('renders a box with the entity name and one row per provider and consumer', () => {
    const api = createMockForgeApi({ projectTree: [], documents: {} })
    render(<EntityEditor nodeId="Activity_entity.aod" projectRoot="C:/p" tree={activity} api={api} onTreeChange={() => {}} />)
    const box = screen.getByLabelText('Activity_entity box')
    expect(within(box).getByText('Activity_entity')).toBeInTheDocument()
    expect(within(box).getAllByRole('button').length).toBe(diagramRows(activity).length)
    const stage = box.parentElement as HTMLElement
    expect(parseInt(stage.style.height, 10)).toBeGreaterThan(24 + diagramRows(activity).length * 17)
    expect(screen.queryByText(/no providers or consumers/)).toBeNull()
  })
})
