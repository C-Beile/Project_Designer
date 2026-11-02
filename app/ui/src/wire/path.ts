import type { WireValue } from './types'

// Mirrors app/core/src/wire.rs's `parse_node_path` exactly (same dotted/indexed string format,
// root is `"$"` or `""`) - only used by the test mock backend (src/test/mockApi.ts) to simulate
// `set_property`'s targeted-field-update semantics without a real Rust process.
export type PathSegment = { kind: 'field'; name: string } | { kind: 'index'; index: number }

export function parseNodePath(raw: string): PathSegment[] {
  if (raw === '' || raw === '$') return []
  const segments: PathSegment[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '.') {
      i += 1
      continue
    }
    if (raw[i] === '[') {
      const end = raw.indexOf(']', i)
      if (end === -1) throw new Error(`unterminated '[' in node path '${raw}'`)
      segments.push({ kind: 'index', index: Number(raw.slice(i + 1, end)) })
      i = end + 1
      continue
    }
    let end = i
    while (end < raw.length && raw[end] !== '.' && raw[end] !== '[') end += 1
    segments.push({ kind: 'field', name: raw.slice(i, end) })
    i = end
  }
  return segments
}

/** Immutably replaces the value at `segments` inside `root`, returning a new tree. */
export function setAt(root: WireValue, segments: PathSegment[], newValue: WireValue): WireValue {
  if (segments.length === 0) return newValue
  const [head, ...rest] = segments

  if (head.kind === 'field') {
    if (root.kind !== 'object') throw new Error(`cannot address field '${head.name}' on a non-object node`)
    return {
      kind: 'object',
      fields: root.fields.map((f) => (f.key === head.name ? { key: f.key, value: setAt(f.value, rest, newValue) } : f)),
    }
  }
  if (root.kind !== 'array') throw new Error(`cannot address index [${head.index}] on a non-array node`)
  return {
    kind: 'array',
    items: root.items.map((item, i) => (i === head.index ? setAt(item, rest, newValue) : item)),
  }
}

export function getAt(root: WireValue, segments: PathSegment[]): WireValue | undefined {
  let current: WireValue | undefined = root
  for (const seg of segments) {
    if (!current) return undefined
    if (seg.kind === 'field') {
      current = current.kind === 'object' ? current.fields.find((f) => f.key === seg.name)?.value : undefined
    } else {
      current = current.kind === 'array' ? current.items[seg.index] : undefined
    }
  }
  return current
}
