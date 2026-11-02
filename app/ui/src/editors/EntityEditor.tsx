import { useEffect, useMemo, useState } from 'react'
import type { EditorProps } from './registry'
import { field, textField, type WireValue } from '../wire/types'
import { useProjectIndex } from './projectIndex'
import { EditableText } from './EditableText'

// Entity editor (reference screenshots 06/07/42): the entity as a box with its providers (arrow
// to the right) and consumers (arrow to the left) as rows; "Direct dependencies" adds the
// entities its consumers depend on, connected by lines. A row click selects the element in the
// Properties panel, where everything is edited. The second view lists all entity fields as a
// table (name, type, title, reference) whose title can be edited right there.
// Creating elements ("+ New ...") needs the model creation of the refactoring work and is dimmed.

export type RowKind = 'provider' | 'consumer'

export interface EntityRow {
  kind: RowKind
  name: string
  extensionPoint: boolean
  /** Element path inside the entity, e.g. `entityFields.entityConsumer[2]`. */
  path: string
  /** Consumers: the entity and field they depend on. */
  targetEntity?: string
  targetField?: string
}

export interface FieldRow {
  tag: string
  name: string
  path: string
  type: string
  title: string
  reference: string
}

function entityItems(tree: WireValue | undefined): { tag: string; index: number; value: WireValue }[] {
  const container = field(tree, 'entityFields')
  if (!container || container.kind !== 'object') return []
  const out: { tag: string; index: number; value: WireValue }[] = []
  for (const f of container.fields) {
    const items = f.value.kind === 'array' ? f.value.items : [f.value]
    items.forEach((value, index) => out.push({ tag: f.key, index, value }))
  }
  return out
}

const pathOf = (tag: string, index: number) => `entityFields.${tag}[${index}]`

export function diagramRows(tree: WireValue | undefined): EntityRow[] {
  const rows: EntityRow[] = []
  for (const { tag, index, value } of entityItems(tree)) {
    const isProvider = tag.startsWith('entityProvider')
    const isConsumer = tag.startsWith('entityConsumer')
    if (!isProvider && !isConsumer) continue
    const dependency = field(value, 'dependency')
    rows.push({
      kind: isProvider ? 'provider' : 'consumer',
      name: textField(value, 'name') ?? '',
      extensionPoint: /ExtensionPoint/i.test(tag),
      path: pathOf(tag, index),
      targetEntity: textField(dependency, 'entityName'),
      targetField: textField(dependency, 'fieldName'),
    })
  }
  const order = (r: EntityRow) => (r.kind === 'provider' ? 0 : 2) + (r.extensionPoint ? 1 : 0)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map((x) => x.r)
}

export function fieldRows(tree: WireValue | undefined): FieldRow[] {
  return entityItems(tree)
    .filter((i) => !i.tag.startsWith('entityProvider') && !i.tag.startsWith('entityConsumer'))
    .map(({ tag, index, value }) => {
      const dependency = field(value, 'dependency')
      return {
        tag,
        name: textField(value, 'name') ?? '',
        path: pathOf(tag, index),
        type: textField(value, 'contentType') ?? '',
        title: textField(value, 'title') ?? '',
        reference: dependency ? [textField(dependency, 'entityName'), textField(dependency, 'fieldName')].filter(Boolean).join('.') : (textField(value, 'recordfield') ?? ''),
      }
    })
}

const NEW_ITEMS = ['New Field', 'New Field Group', 'New RecordContainer', 'New Action', 'New Action Group', 'New Parameter', 'New Consumer', 'New Provider', 'New Aggregate Field']

const BOX_W = 190
const HEAD_H = 24
const ROW_H = 17
const COL_GAP = 130

interface Box {
  entity: string
  rows: EntityRow[]
  x: number
  y: number
  main: boolean
}

export function EntityEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  const index = useProjectIndex()
  const [mode, setMode] = useState<'diagram' | 'fields'>('diagram')
  const [zoom, setZoom] = useState(1)
  const [deps, setDeps] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [related, setRelated] = useState<Record<string, EntityRow[] | null>>({})

  const name = textField(tree, 'name') || '(unnamed entity)'
  const rows = useMemo(() => diagramRows(tree), [tree])
  const fields = useMemo(() => fieldRows(tree), [tree])
  const targets = useMemo(() => [...new Set(rows.map((r) => r.targetEntity).filter((t): t is string => !!t && t !== name))], [rows, name])

  useEffect(() => {
    if (!deps || !index) return
    let cancelled = false
    for (const t of targets) {
      if (t in related) continue
      const node = index.findObject('entity', t)
      if (!node) {
        setRelated((r) => ({ ...r, [t]: null }))
        continue
      }
      api
        .getPropertyTree(node.id)
        .then((tr) => {
          if (!cancelled) setRelated((r) => ({ ...r, [t]: diagramRows(tr) }))
        })
        .catch(() => {
          if (!cancelled) setRelated((r) => ({ ...r, [t]: null }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [deps, targets, index, api, related])

  const boxes: Box[] = useMemo(() => {
    const out: Box[] = [{ entity: name, rows, x: 24, y: 18, main: true }]
    if (!deps) return out
    let y = 18
    for (const t of targets) {
      const r = related[t]
      if (!r) continue
      out.push({ entity: t, rows: r, x: 24 + BOX_W + COL_GAP, y, main: false })
      y += HEAD_H + r.length * ROW_H + 30
    }
    return out
  }, [name, rows, deps, targets, related])

  const rowY = (box: Box, i: number) => box.y + HEAD_H + i * ROW_H + ROW_H / 2
  const lines = deps
    ? rows.flatMap((r, i) => {
        const target = boxes.find((b) => !b.main && b.entity === r.targetEntity)
        if (!target) return []
        const j = Math.max(0, target.rows.findIndex((t) => t.name === r.targetField))
        const main = boxes[0]
        return [{ key: `${r.path}`, x1: main.x + BOX_W, y1: rowY(main, i), x2: target.x, y2: rowY(target, j) }]
      })
    : []

  const width = (deps && boxes.length > 1 ? 24 + 2 * BOX_W + COL_GAP : 24 + BOX_W) + 40
  const height = Math.max(...boxes.map((b) => b.y + HEAD_H + b.rows.length * ROW_H)) + 40

  function select(path: string, label: string) {
    setSelectedPath(path)
    index?.selectElement?.(nodeId, path, label)
  }

  async function commitTitle(path: string, value: string) {
    const outcome = await api.setSheetProperty(nodeId, path, 'title', { kind: 'text', value }, false)
    onTreeChange(outcome.tree)
  }

  return (
    <div className="entity-editor">
      <div className="entity-toolbar" role="toolbar" aria-label="Entity editor toolbar">
        <div className="forge-opt-pages" role="tablist" aria-label="Entity views">
          {(['diagram', 'fields'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={`forge-opt-page${mode === m ? ' is-active' : ''}`} onClick={() => setMode(m)}>
              {m === 'diagram' ? 'Diagram' : 'Fields'}
            </button>
          ))}
        </div>
        {mode === 'diagram' ? (
          <>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}>
              −
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))}>
              ＋
            </button>
            <button type="button" aria-pressed={deps} title="Show the entities this entity depends on" onClick={() => setDeps((d) => !d)}>
              Direct dependencies
            </button>
            <button type="button" disabled title="Arrange - not available yet" aria-label="Arrange">
              ⛶
            </button>
            <button type="button" disabled title="Export as image - not available yet" aria-label="Export">
              ⇪
            </button>
            <button type="button" disabled title="Print - not available yet" aria-label="Print">
              🖶
            </button>
          </>
        ) : null}
        <span className="entity-new">
          <button type="button" aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen((o) => !o)}>
            ＋ New …
          </button>
          {newOpen ? (
            <ul role="menu" aria-label="New">
              {NEW_ITEMS.map((n) => (
                <li key={n} role="menuitem" aria-disabled="true" title="Creating models is not available yet">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
        </span>
      </div>

      {mode === 'diagram' ? (
        <div className="entity-canvas">
          <div className="entity-stage" style={{ width: width * zoom, height: height * zoom }}>
            <div style={{ width, height, transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative' }}>
              <svg className="entity-lines" width={width} height={height} aria-hidden="true">
                {lines.map((l) => (
                  <polyline key={l.key} points={`${l.x1},${l.y1} ${(l.x1 + l.x2) / 2},${l.y1} ${(l.x1 + l.x2) / 2},${l.y2} ${l.x2},${l.y2}`} fill="none" stroke="var(--diagram-line)" strokeWidth="1" />
                ))}
              </svg>
              {boxes.map((b) => (
                <div key={`${b.entity}-${b.x}`} className={`entity-box${b.main ? ' is-main' : ''}`} style={{ left: b.x, top: b.y, width: BOX_W }} aria-label={`${b.entity} box`}>
                  <div className="entity-box-head" style={{ height: HEAD_H }}>
                    {b.entity}
                  </div>
                  {b.rows.map((r) => (
                    <div
                      key={r.path}
                      role="button"
                      tabIndex={b.main ? 0 : -1}
                      className={`entity-box-row${b.main && r.path === selectedPath ? ' is-selected' : ''}`}
                      style={{ height: ROW_H }}
                      onClick={() => b.main && select(r.path, r.name)}
                      onKeyDown={(e) => {
                        if (b.main && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          select(r.path, r.name)
                        }
                      }}
                    >
                      <span className="entity-box-arrow" aria-hidden="true">
                        {r.extensionPoint ? '' : r.kind === 'provider' ? '➔' : '⬅'}
                      </span>
                      {r.name}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {rows.length === 0 ? <p className="forge-field-hint">This entity has no providers or consumers; its fields are listed in the Fields view.</p> : null}
          {deps && targets.some((t) => related[t] === null) ? (
            <p className="forge-field-hint">Some dependent entities are not part of the open projects and are not drawn.</p>
          ) : null}
        </div>
      ) : (
        <div className="entity-fields">
          <table aria-label="Entity fields">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Title</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.path} className={f.path === selectedPath ? 'is-selected' : undefined} onClick={() => select(f.path, f.name)}>
                  <td>{f.name}</td>
                  <td>{f.type}</td>
                  <td>
                    <EditableText value={f.title} ariaLabel={`Title of ${f.name}`} onCommit={(v) => void commitTitle(f.path, v)} />
                  </td>
                  <td>{f.reference}</td>
                </tr>
              ))}
              {fields.length === 0 ? (
                <tr>
                  <td colSpan={4} className="forge-field-hint">
                    This entity has no fields.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

