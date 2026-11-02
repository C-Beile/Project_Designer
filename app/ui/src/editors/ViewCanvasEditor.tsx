import type { EditorProps } from './registry'
import { asArray, field, textField, textValue } from '../wire/types'
import { EditableText } from './EditableText'
import { FIELD_DRAG, ViewPreview, useViewEntityFields, type PreviewActions } from './ViewPreview'
import { ViewAddDialog, type AddChoice, type AddTemplate } from './ViewAddDialog'
import { addEntityFieldToTemplate, addViewReference } from './viewFields'
import { newUuid } from '../shell/uuid'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProjectIndex } from './projectIndex'
import { moveViewChild, parseViewChildren } from './viewChildren'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { confirmDialog } from '../shell/dialogService'

// Ziel 1 (neonView editor, P4 second family): a structured list view of the view's layout
// reference table, not a full drag-and-drop canvas. architecture.md names "ein eigener
// Canvas-Layer" as the long-term target for view rendering, but a real WYSIWYG canvas needs a
// layout engine that mirrors the ADITO client's own rendering rules (grid/tab/master-slave
// placement) - a project of its own, well beyond this round's budget. The MUST subset from
// feature-matrix.md ("Layout-Struktur, Feld-/Tile-Referenzen auf die zugehörige Entity") is fully
// covered by a table: every `neonViewReference` (the view's children/composition) with its
// `entityField`/`view` binding, plus which one is the layout's master - which is exactly the
// information a canvas would visualise, just as rows instead of positioned boxes. Documented as a
// deliberate choice, not a shortcut, in p4-editor-view-context-dashboard-notes.md.
//
// `name` (each reference's own id) and the layout's `master` pointer are both Designer-generated
// UUIDs (aod-format.md §1.1) that address *identity*, not editable content - shown read-only, same
// treatment `EntityFieldsEditor.tsx` gives the read-only DB column. `entityField`/`view` are plain
// business-name references (bare strings) and are the actual MUST-subset editable content.

export function ViewCanvasEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  async function commitScalar(path: string, next: string) {
    const updated = await api.setProperty(nodeId, path, textValue(next))
    onTreeChange(updated)
  }

  const name = textField(tree, 'name') ?? ''
  const master = textField(field(field(tree, 'layout'), 'masterSlaveLayout'), 'master')
  const references = asArray(field(field(tree, 'children'), 'neonViewReference'))

  const [mode, setMode] = useState<'preview' | 'structure'>('preview')
  const index = useProjectIndex()
  const [source, setSource] = useState<{ text: string; read_only: boolean } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; target: { path: string; label: string; view?: string; order: number | null } } | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ initial: AddTemplate | null } | null>(null)
  const entityFields = useViewEntityFields(api, name)

  useEffect(() => {
    let alive = true
    api
      .getObjectSource(nodeId)
      .then((s) => alive && setSource(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, nodeId, tree])

  const parsed = useMemo(() => (source ? parseViewChildren(source.text) : null), [source])
  const order = useMemo(() => parsed?.children.map((c) => `${c.kind}|${c.name}`) ?? null, [parsed])

  const move = useCallback(
    async (from: number, to: number) => {
      if (!source || source.read_only) return
      const next = moveViewChild(source.text, from, to)
      if (next === null || next === source.text) return
      try {
        const outcome = await api.setObjectSource(nodeId, next)
        setMoveError(null)
        setSource({ text: next, read_only: false })
        onTreeChange(outcome.tree)
      } catch (e) {
        setMoveError(e instanceof Error ? e.message : String(e))
      }
    },
    [api, nodeId, onTreeChange, source],
  )

  // Writes a changed source text of the open view (one undo step) and refreshes the preview.
  const writeSource = useCallback(
    async (next: string) => {
      try {
        const outcome = await api.setObjectSource(nodeId, next)
        setMoveError(null)
        setSource({ text: next, read_only: false })
        onTreeChange(outcome.tree)
      } catch (e) {
        setMoveError(e instanceof Error ? e.message : String(e))
      }
    },
    [api, nodeId, onTreeChange],
  )

  const addField = useCallback(
    (kind: string, template: string, entityField: string, before: number | null) => {
      if (!source || source.read_only) return
      const result = addEntityFieldToTemplate(source.text, kind, template, entityField, newUuid(), before)
      if ('error' in result) setMoveError(result.error)
      else void writeSource(result.text)
    },
    [source, writeSource],
  )

  const actions: PreviewActions = {
    selected: index?.selection && index.selection.nodeId === nodeId ? index.selection.path : null,
    select: (path, label) => index?.selectElement?.(nodeId, path, label),
    open: (viewName) => {
      const node = index?.findObject('neonView', viewName)
      if (node) index?.openObject(node)
    },
    menu: (x, y, target) => setMenu({ x, y, target }),
    order,
    move: source && !source.read_only && order ? (from, to) => void move(from, to) : undefined,
    addField: source && !source.read_only ? addField : undefined,
  }

  const menuEntries = (t: NonNullable<typeof menu>['target']): MenuEntry[] => {
    const editable = !!actions.move
    const last = (order?.length ?? 0) - 1
    const view = t.view ? index?.findObject('neonView', t.view) : null
    return [
      { id: 'open', label: 'Open', enabled: !!view, hint: t.view ? 'View not found in the open projects' : 'Only an embedded view can be opened' },
      { id: 'properties', label: 'Properties', enabled: true },
      { id: 'sep-1', label: '', enabled: false, separator: true },
      { id: 'up', label: 'Move Up', enabled: editable && t.order !== null && t.order > 0, hint: editable ? 'Already the first element' : 'Not available for module objects' },
      { id: 'down', label: 'Move Down', enabled: editable && t.order !== null && t.order < last, hint: editable ? 'Already the last element' : 'Not available for module objects' },
      { id: 'remove', label: 'Remove', enabled: !!index?.removeElement, hint: 'Not available here' },
      { id: 'add', label: 'Add...', enabled: editable, hint: 'Not available for module objects' },
    ]
  }

  const pickMenu = async (id: string, t: NonNullable<typeof menu>['target']) => {
    if (id === 'open' && t.view) {
      const node = index?.findObject('neonView', t.view)
      if (node) index?.openObject(node)
    } else if (id === 'properties') index?.selectElement?.(nodeId, t.path, t.label)
    else if (id === 'up' && t.order !== null) void move(t.order, t.order - 1)
    else if (id === 'down' && t.order !== null) void move(t.order, t.order + 2)
    else if (id === 'add') setAdding({ initial: templateOfPath(t.path) })
    else if (id === 'remove') {
      if (await confirmDialog(`Remove ${t.label} from this view?`, { title: 'Remove', okLabel: 'Remove' })) index?.removeElement?.(nodeId, t.path, t.label)
    }
  }

  // The ViewTemplate a path like `children.tableViewTemplate[1].columns...` belongs to (the second of that kind in the file).
  const templateOfPath = (path: string): AddTemplate | null => {
    const m = /^children\.(\w+)(?:\[(\d+)\])?/.exec(path)
    if (!m || !parsed) return null
    const sameKind = parsed.children.filter((c) => c.kind === m[1])
    const hit = sameKind[Number(m[2] ?? 0)]
    return hit ? { kind: hit.kind, name: hit.name } : null
  }
  const allTemplates: AddTemplate[] = parsed?.children.filter((c) => c.kind.endsWith('ViewTemplate')).map((c) => ({ kind: c.kind, name: c.name })) ?? []

  const add = (choice: AddChoice) => {
    setAdding(null)
    if (!source || source.read_only) return
    const result = choice.what === 'field' ? addEntityFieldToTemplate(source.text, choice.template.kind, choice.template.name, choice.entityField, newUuid()) : addViewReference(source.text, choice.view, newUuid(), choice.entityField)
    if ('error' in result) setMoveError(result.error)
    else void writeSource(result.text)
  }

  const modeBar = (
    <div className="vp-modebar" role="group" aria-label="View display">
      <button type="button" className={`vp-mode${mode === 'preview' ? ' is-active' : ''}`} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>
        Preview
      </button>
      <button type="button" className={`vp-mode${mode === 'structure' ? ' is-active' : ''}`} aria-pressed={mode === 'structure'} onClick={() => setMode('structure')}>
        Structure
      </button>
    </div>
  )

  if (mode === 'preview') {
    return (
      <div className="view-editor">
        {modeBar}
        <div className="vp-split">
          {entityFields ? (
            <aside className="vp-entity-list" aria-label="Entity fields">
              <h3>Entity fields</h3>
              {[...entityFields.entries()].map(([fieldName, meta]) => (
                <div
                  key={fieldName}
                  className="vp-entity-item"
                  draggable={!!actions.addField}
                  title={actions.addField ? 'Drag into a ViewTemplate of the view' : 'This view cannot be changed'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(FIELD_DRAG, fieldName)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <span>{meta.title || fieldName}</span>
                  <span className="vp-type">{meta.type}</span>
                </div>
              ))}
            </aside>
          ) : null}
          <ViewPreview api={api} tree={tree} name={name} actions={actions} />
        </div>
        {adding ? (
          <ViewAddDialog
            templates={allTemplates}
            initialTemplate={adding.initial}
            entityFields={entityFields ? [...entityFields.keys()] : []}
            views={index?.namesOf?.('neonView').filter((v) => v !== name).sort((a, b) => a.localeCompare(b)) ?? []}
            onClose={() => setAdding(null)}
            onAdd={add}
          />
        ) : null}
        {moveError ? <p className="forge-field-error" role="alert">{moveError}</p> : null}
        {menu ? <TreeContextMenu entries={menuEntries(menu.target)} x={menu.x} y={menu.y} onPick={(id) => void pickMenu(id, menu.target)} onClose={() => setMenu(null)} /> : null}
      </div>
    )
  }

  return (
    <div className="view-editor">
      {modeBar}
      <h2>{name}</h2>
      {master ? (
        <p>
          Layout master: <code>{master}</code>
        </p>
      ) : (
        <p>No master-slave layout on this view.</p>
      )}

      <table aria-label="View references">
        <thead>
          <tr>
            <th>Master</th>
            <th>Reference id</th>
            <th>Entity field</th>
            <th>Sub-view</th>
          </tr>
        </thead>
        <tbody>
          {references.map((reference, index) => {
            const refId = textField(reference, 'name') ?? ''
            const entityField = textField(reference, 'entityField') ?? ''
            const view = textField(reference, 'view') ?? ''
            const basePath = `children.neonViewReference[${index}]`
            const isMaster = master !== undefined && master === refId

            return (
              <tr key={refId || index}>
                <td>{isMaster ? '★' : ''}</td>
                <td>{refId}</td>
                <td>
                  <EditableText
                    value={entityField}
                    ariaLabel={`Reference ${index} entity field`}
                    onCommit={(next) => commitScalar(`${basePath}.entityField`, next)}
                  />
                </td>
                <td>
                  <EditableText
                    value={view}
                    ariaLabel={`Reference ${index} view`}
                    onCommit={(next) => commitScalar(`${basePath}.view`, next)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
