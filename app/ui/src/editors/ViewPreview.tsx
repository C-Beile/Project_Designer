import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { field, intField, textField } from '../wire/types'
import type { TreeNode, WireValue } from '../wire/types'
import { useProjectIndex } from './projectIndex'
import { acceptsEntityFields } from './viewFields'
import { ChartSketch, MapSketch, Placeholder, Steps } from './viewSketches'

// Visual preview of a neonView: renders the layout, the field templates and the referenced
// sub-views the way the ADITO client arranges them. Field titles and types come from the entity
// of the view's context. It is an approximation for orientation (no live data), not a pixel-exact
// copy of the client.

const MAX_DEPTH = 4

/** Title and content type of one entity field. */
export interface FieldMeta {
  title: string
  type: string
}

export type EntityFields = Map<string, FieldMeta>

// What a click, double click, right click or drag on a box does. The editor around the preview owns
// the selection (it is shared with Navigator and Properties) and the actions; the preview only draws.
export interface PreviewActions {
  /** Path of the selected element in the open view (same notation as the Navigator). */
  selected: string | null
  select(path: string, label: string): void
  /** Double click on an embedded view: opens the referenced view. */
  open(viewName: string): void
  menu(x: number, y: number, target: { path: string; label: string; view?: string; order: number | null }): void
  /** Keys (`kind|name`) of the open view's children in file order. */
  order: string[] | null
  /** Moves child `from` in front of child `to` (file order); absent when the view cannot be changed. */
  move?: (from: number, to: number) => void
  /** Inserts a dragged entity field into a template of the open view; absent when the view cannot be changed. */
  addField?: (kind: string, template: string, entityField: string, before: number | null) => void
}

const PreviewActionsContext = createContext<PreviewActions | null>(null)
// Inside an embedded view every click belongs to the frame of that view in the open view.
const AnchorContext = createContext<{ path: string; label: string } | null>(null)
const DRAG_TYPE = 'application/x-forge-view-child'

// The entity metadata that applies to the view currently being drawn.
const EntityFieldsContext = createContext<EntityFields | null>(null)

function many(value: WireValue | undefined): WireValue[] {
  if (!value) return []
  if (value.kind === 'array') return value.items
  return value.kind === 'object' ? [value] : []
}

export function humanize(name: string): string {
  if (name === '#ENTITY') return 'Main data'
  const spaced = name
    .replace(/_fieldgroup$/i, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  const lower = spaced.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** The entity fields of an entity's property tree; a field without content type is text. */
export function entityFieldsOf(entityTree: WireValue): EntityFields {
  const out: EntityFields = new Map()
  for (const f of many(field(field(entityTree, 'entityFields'), 'entityField'))) {
    const name = textField(f, 'name')
    if (!name) continue
    out.set(name, { title: textField(f, 'title') ?? '', type: (textField(f, 'contentType') ?? 'TEXT').toUpperCase() })
  }
  return out
}

/** Label of a field: the entity's title, else a readable form of the technical name. */
export function labelOf(name: string, fields: EntityFields | null): string {
  const title = fields?.get(name)?.title
  return title ? title : humanize(name)
}

const TYPE_LABELS: Record<string, string> = { TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', BOOLEAN: 'Yes/No', CHECKBOX: 'Yes/No', FILE: 'File', IMAGE: 'Image' }

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0) + type.slice(1).toLowerCase()
}

function useEntityFields(api: ForgeApi, entity: TreeNode | null): EntityFields | null {
  const [fields, setFields] = useState<EntityFields | null>(null)
  const entityId = entity?.id ?? null
  useEffect(() => {
    setFields(null)
    if (!entityId) return
    let alive = true
    api
      .getPropertyTree(entityId)
      .then((t) => {
        if (alive) setFields(entityFieldsOf(t))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, entityId])
  return fields
}

function fieldNames(template: WireValue): string[] {
  return many(field(field(template, 'fields'), 'entityFieldLink'))
    .map((f) => textField(f, 'entityField') ?? '')
    .filter(Boolean)
}

interface Child {
  kind: string
  value: WireValue
  /** Path of the element in its view, as the Navigator writes it. */
  path: string
}

function childrenOf(tree: WireValue): Child[] {
  const children = field(tree, 'children')
  if (!children || children.kind !== 'object') return []
  const out: Child[] = []
  for (const f of children.fields) {
    const items = many(f.value)
    const indexed = f.value.kind === 'array'
    items.forEach((v, i) => out.push({ kind: f.key, value: v, path: indexed ? `children.${f.key}[${i}]` : `children.${f.key}` }))
  }
  return out
}

function layoutOf(tree: WireValue): { kind: string; value: WireValue | undefined } {
  const layout = field(tree, 'layout')
  if (layout && layout.kind === 'object' && layout.fields.length > 0) {
    return { kind: layout.fields[0].key, value: layout.fields[0].value }
  }
  return { kind: 'boxLayout', value: undefined }
}

function Selectable({
  path,
  label,
  view,
  className,
  order = null,
  children,
  as: Tag = 'div',
  fieldDrop,
  ...rest
}: {
  /** Handlers for a dragged entity field dropped on this element. */
  fieldDrop?: Record<string, unknown>
  path: string
  label: string
  view?: string
  className?: string
  order?: number | null
  children: ReactNode
  as?: 'div' | 'section' | 'fieldset' | 'label'
  title?: string
  'data-template'?: string
}) {
  const actions = useContext(PreviewActionsContext)
  const anchor = useContext(AnchorContext)
  const target = anchor ?? { path, label }
  const selected = !anchor && actions?.selected === path
  const movable = !anchor && order !== null && !!actions?.move
  return (
    <Tag
      {...rest}
      className={`${className ?? ''} vp-sel${selected ? ' is-selected' : ''}`.trim()}
      data-path={path}
      aria-selected={selected}
      draggable={movable || undefined}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation()
        actions?.select(target.path, target.label)
      }}
      onDoubleClick={(e: React.MouseEvent) => {
        e.stopPropagation()
        if (view) actions?.open(view)
      }}
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        actions?.select(target.path, target.label)
        actions?.menu(e.clientX, e.clientY, { ...target, view, order: anchor ? null : order })
      }}
      onDragStart={movable ? (e: React.DragEvent) => {
        e.stopPropagation()
        e.dataTransfer.setData(DRAG_TYPE, String(order))
        e.dataTransfer.effectAllowed = 'move'
      } : undefined}
      onDragOver={movable || fieldDrop ? (e: React.DragEvent) => {
        if (fieldDrop && e.dataTransfer.types.includes(FIELD_DRAG)) {
          ;(fieldDrop.onDragOver as (ev: React.DragEvent) => void)(e)
          return
        }
        if (!movable) return
        e.preventDefault()
        e.stopPropagation()
      } : undefined}
      onDrop={movable || fieldDrop ? (e: React.DragEvent) => {
        if (fieldDrop && e.dataTransfer.getData(FIELD_DRAG)) {
          ;(fieldDrop.onDrop as (ev: React.DragEvent) => void)(e)
          return
        }
        if (!movable) return
        const from = e.dataTransfer.getData(DRAG_TYPE)
        if (from === '') return
        e.preventDefault()
        e.stopPropagation()
        actions?.move?.(Number(from), order as number)
      } : undefined}
    >
      {children}
    </Tag>
  )
}

export const FIELD_DRAG = 'application/x-forge-entity-field'

function flag(value: WireValue | undefined, name: string): boolean {
  const v = field(value, name)
  return v?.kind === 'bool' ? v.value : v?.kind === 'text' ? v.value === 'true' : false
}

function listColumns(value: WireValue): string[] {
  const columns = field(value, 'columns')
  if (!columns || columns.kind !== 'object') return []
  const out: string[] = []
  for (const f of columns.fields) for (const c of many(f.value)) out.push(textField(c, 'entityField') ?? '')
  return out.filter(Boolean)
}

function actionNames(value: WireValue): string[] {
  return many(field(field(value, 'actions'), 'element'))
    .map((v) => (v.kind === 'text' ? v.value : ''))
    .filter(Boolean)
}

/** Drag-over and drop handlers that insert a dragged entity field into the template (in front of entry `before`, else at the end). */
function useFieldDrop(child: Child): (before: number | null) => Record<string, unknown> {
  const actions = useContext(PreviewActionsContext)
  const anchor = useContext(AnchorContext)
  const name = textField(child.value, 'name') ?? ''
  if (!actions?.addField || anchor || !acceptsEntityFields(child.kind) || !name) return () => ({})
  const addField = actions.addField
  return (before: number | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(FIELD_DRAG)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e: React.DragEvent) => {
      const dropped = e.dataTransfer.getData(FIELD_DRAG)
      if (!dropped) return
      e.preventDefault()
      e.stopPropagation()
      addField(child.kind, name, dropped, before)
    },
  })
}

type ControlProps = { type: string; editable: boolean; name: string }

// Only the HTML field is described in the reference (rich-text editor); every other type is drawn as a plain box.
function FieldControl({ type, editable, name }: ControlProps) {
  if (type === 'HTML') {
    return (
      <span className={`vp-field-box vp-html${editable ? ' is-edit' : ''}`} title={name}>
        <span className="vp-html-bar">B I U</span>
      </span>
    )
  }
  if (type === 'BOOLEAN' || type === 'CHECKBOX') return <span className={`vp-check${editable ? ' is-edit' : ''}`} title={name} />
  if (type === 'IMAGE' || type === 'FILE' || type === 'SIGNATURE') {
    return (
      <span className="vp-field-box vp-media" title={name}>
        {typeLabel(type)}
      </span>
    )
  }
  if (type === 'LONG_TEXT') return <span className={`vp-field-box vp-long${editable ? ' is-edit' : ''}`} title={name} />
  return (
    <span className={`vp-field-box${editable ? ' is-edit' : ''}`} title={name}>
      {editable ? '' : '—'}
    </span>
  )
}

function FieldBox({ name, editable, path, hideLabel, drop }: { name: string; editable: boolean; path?: string; hideLabel?: boolean; drop?: Record<string, unknown> }) {
  const fields = useContext(EntityFieldsContext)
  const type = fields?.get(name)?.type
  const inner = (
    <>
      {hideLabel ? null : (
        <span className="vp-field-label">
          {labelOf(name, fields)}
          {type ? <span className="vp-type">{typeLabel(type)}</span> : null}
        </span>
      )}
      <FieldControl type={type ?? 'TEXT'} editable={editable} name={name} />
    </>
  )
  return path ? (
    <Selectable path={path} label={name} className="vp-field" as="label" fieldDrop={drop && Object.keys(drop).length > 0 ? drop : undefined}>
      {inner}
    </Selectable>
  ) : (
    <label className="vp-field" {...drop}>
      {inner}
    </label>
  )
}

function Head({ kind, name, children }: { kind: string; name: string; children?: ReactNode }) {
  return (
    <header className="vp-card-head">
      <span>{`${humanize(kind.replace(/ViewTemplate$/, ''))}${name ? ` (${name})` : ''}`}</span>
      {children}
    </header>
  )
}

function SearchBar({ value }: { value: WireValue }) {
  return flag(value, 'hideContentSearch') ? null : (
    <div className="vp-search" aria-label="Content search">
      Search
    </div>
  )
}

function Drawer({ caption, fixed, children }: { caption: string; fixed: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="vp-drawer-box">
      <div className="vp-drawer-bar">
        <span>{caption}</span>
        {fixed ? null : (
          <button
            type="button"
            className="vp-drawer-toggle"
            aria-label={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation()
              setOpen(!open)
            }}
          >
            {open ? '^' : 'v'}
          </button>
        )}
      </div>
      {open || fixed ? <div className="vp-drawer-content">{children}</div> : null}
    </div>
  )
}

function Template({ child }: { child: Child }) {
  const fieldsMeta = useContext(EntityFieldsContext)
  const dropFor = useFieldDrop(child)
  const { kind, value } = child
  const name = textField(value, 'name') ?? ''
  const label = (f: string) => labelOf(f, fieldsMeta)
  const cols = listColumns(value)

  // Generic: the listed entity fields one below the other; HTML fields as rich-text editors; an optional drawer around them.
  if (kind === 'genericViewTemplate') {
    const editable = flag(value, 'editMode')
    const fields = fieldNames(value)
    const links = field(field(value, 'fields'), 'entityFieldLink')
    const linkPath = (i: number) => `${child.path}.fields.entityFieldLink${links?.kind === 'array' ? `[${i}]` : ''}`
    const info = textField(value, 'informationField')
    const body = (
      <div className={`vp-form${flag(value, 'isLabelPositionTop') ? ' is-top' : ''}`} {...dropFor(null)}>
        {editable && info ? <div className="vp-info">{label(info)}</div> : null}
        {fields.length === 0 ? (
          <span className="vp-muted">No fields</span>
        ) : (
          fields.map((f, i) => <FieldBox key={`${f}${i}`} name={f} editable={editable} path={linkPath(i)} hideLabel={flag(value, 'hideLabels')} drop={dropFor(i)} />)
        )}
      </div>
    )
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name}>
          {flag(value, 'hideEmptyFields') ? <span className="vp-chip">empty fields hidden</span> : null}
        </Head>
        {flag(value, 'showDrawer') ? (
          <Drawer caption={textField(value, 'drawerCaption') ?? ''} fixed={flag(value, 'fixedDrawer')}>
            {body}
          </Drawer>
        ) : (
          body
        )}
      </section>
    )
  }

  // Card: image area on top, then title, subtitle, description, the labelled information field and up to two action buttons.
  if (kind === 'cardViewTemplate') {
    const title = textField(value, 'titleField') ?? ''
    const sub = textField(value, 'subtitleField') ?? ''
    const desc = textField(value, 'descriptionField') ?? ''
    const info = textField(value, 'informationField') ?? ''
    const buttons = [textField(value, 'favoriteAction1'), textField(value, 'favoriteAction2')].filter((b): b is string => !!b)
    return (
      <section className="vp-card vp-bcard" data-template={kind}>
        <div className="vp-bcard-image" title={textField(value, 'iconField') ?? ''} />
        <div className="vp-bcard-text">
          <div className="vp-title">{label(title)}</div>
          {sub ? <div className="vp-sub">{label(sub)}</div> : null}
          {desc ? <div className="vp-muted">{label(desc)}</div> : null}
          {info ? (
            <div className="vp-bcard-info">
              <span className="vp-field-label">{label(info)}</span>
              <span className="vp-field-box">—</span>
            </div>
          ) : null}
        </div>
        {buttons.length > 0 ? (
          <div className="vp-actions">
            {buttons.map((b) => (
              <span key={b} className="vp-btn">
                {humanize(b)}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  // CardTable: a vertical list of cards in the style of the Card.
  if (kind === 'cardTableViewTemplate') {
    const title = textField(value, 'titleField') ?? ''
    const sub = textField(value, 'subtitleField') ?? ''
    const desc = textField(value, 'descriptionField') ?? ''
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-cardlist" {...dropFor(null)}>
          {[0, 1, 2].map((r) => (
            <div key={r} className="vp-listcard">
              <span className="vp-tile-icon" />
              <span className="vp-tile-text">
                <span className="vp-title">{label(title)}</span>
                {sub ? <span className="vp-sub">{label(sub)}</span> : null}
                {desc ? <span className="vp-muted">{label(desc)}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // ScoreCard: every listed field as a separate labelled card.
  if (kind === 'scoreCardViewTemplate') {
    const fields = fieldNames(value)
    const links = field(field(value, 'fields'), 'entityFieldLink')
    return (
      <section className="vp-scores" data-template={kind} {...dropFor(null)}>
        {fields.map((f, i) => (
          <Selectable key={`${f}${i}`} path={`${child.path}.fields.entityFieldLink${links?.kind === 'array' ? `[${i}]` : ''}`} label={f} className="vp-score">
            <div className="vp-score-value">0</div>
            <div className="vp-muted">{label(f)}</div>
          </Selectable>
        ))}
      </section>
    )
  }

  // TitledList: rows with the title on the left and the columns on the right; six rows by default, then "+ X more".
  if (kind === 'titledListViewTemplate') {
    const title = textField(value, 'titleField') ?? ''
    const highlight = textField(value, 'highlightingField')
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div {...dropFor(null)}>
          {[0, 1, 2].map((r) => (
            <div key={r} className="vp-tl-row">
              <span className={`vp-tl-title${highlight && r === 0 ? ' is-highlighted' : ''}`}>{label(title)}</span>
              <span className="vp-tl-values">
                {cols.map((c, i) => (
                  <span key={`${c}${i}`} className="vp-skeleton" title={c} {...dropFor(i)} />
                ))}
              </span>
            </div>
          ))}
          <div className="vp-muted vp-more">+ X more</div>
        </div>
      </section>
    )
  }

  // Tiles: icon left of the text (LANDSCAPE) or above it (PORTRAIT); a field without value leaves out its section.
  if (kind === 'tilesViewTemplate') {
    const portrait = (textField(value, 'tilePresentation') ?? 'LANDSCAPE').toUpperCase() === 'PORTRAIT'
    const lines = ['infoTopField', 'titleField', 'subtitleField', 'descriptionField', 'infoBottomField']
      .map((k) => [k, textField(value, k) ?? ''] as const)
      .filter(([, v]) => v)
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-tiles">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`vp-tile${portrait ? ' is-portrait' : ''}`}>
              {textField(value, 'iconField') !== undefined ? <span className="vp-tile-icon" /> : null}
              <span className="vp-tile-text">
                {lines.map(([k, v]) => (
                  <span key={k} className={k === 'titleField' ? 'vp-title' : 'vp-muted'}>
                    {label(v)}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // ActionList: icon, the title as a link and the description below it; one entry action for every row.
  if (kind === 'actionListViewTemplate') {
    const title = textField(value, 'titleField') ?? ''
    const desc = textField(value, 'descriptionField') ?? ''
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        {[0, 1].map((r) => (
          <div key={r} className="vp-al-row">
            <span className="vp-tile-icon" />
            <span className="vp-tile-text">
              <span className="vp-link">{label(title)}</span>
              {desc ? <span className="vp-muted">{label(desc)}</span> : null}
            </span>
          </div>
        ))}
      </section>
    )
  }

  // Actions: one button per action of the entity.
  if (kind === 'actionsViewTemplate') {
    const names = actionNames(value)
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-actions">
          {names.length === 0 ? (
            <span className="vp-muted">No actions</span>
          ) : (
            names.map((a) => (
              <span key={a} className="vp-btn">
                {humanize(a)}
              </span>
            ))
          )}
        </div>
      </section>
    )
  }

  // Table family: search bar, header row with the columns, rows. TreeTable adds expand arrows; GenericMultiple and MultiEditTable show editable cells.
  if (['tableViewTemplate', 'treeTableViewTemplate', 'genericMultipleViewTemplate', 'multiEditTableViewTemplate', 'basicTableViewTemplate'].includes(kind)) {
    const tree = kind === 'treeTableViewTemplate'
    const editable = kind === 'multiEditTableViewTemplate' || kind === 'genericMultipleViewTemplate'
    const showCount = tree && flag(value, 'showChildrenCount')
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name}>
          {kind === 'basicTableViewTemplate' ? <span className="vp-chip">experimental, paged</span> : null}
          {kind === 'genericMultipleViewTemplate' ? (
            <span className="vp-btn vp-add" aria-label="Add row">
              +
            </span>
          ) : null}
        </Head>
        <SearchBar value={value} />
        <table className="vp-table" {...dropFor(null)}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={`${c}${i}`} title={fieldsMeta?.get(c) ? `${c} (${typeLabel(fieldsMeta.get(c)!.type)})` : c} {...dropFor(i)}>
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((r) => (
              <tr key={r}>
                {cols.map((c, i) => (
                  <td key={`${c}${i}`}>
                    {tree && i === 0 ? <span className="vp-arrow">{r === 1 ? '' : '▸'}</span> : null}
                    {editable ? <span className="vp-field-box is-edit" /> : <span className="vp-skeleton" />}
                    {showCount && i === 0 && r !== 1 ? <span className="vp-muted"> (3)</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {kind === 'basicTableViewTemplate' ? <div className="vp-pager">‹ 1 2 3 ›</div> : null}
      </section>
    )
  }

  // Tree: hierarchical nodes with icon, title and description.
  if (kind === 'treeViewTemplate') {
    const title = textField(value, 'titleField') ?? ''
    const desc = textField(value, 'descriptionField') ?? ''
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <SearchBar value={value} />
        {[0, 1, 2].map((r) => (
          <div key={r} className="vp-tree-row" style={{ paddingLeft: r === 1 ? 22 : 0 }}>
            <span className="vp-arrow">{r === 1 ? '' : '▸'}</span>
            <span className="vp-tile-icon is-small" />
            <span className="vp-tile-text">
              <span className="vp-title">{label(title)}</span>
              {desc ? <span className="vp-muted">{label(desc)}</span> : null}
            </span>
          </div>
        ))}
      </section>
    )
  }

  // Timeline: date and icon on the left, title and descriptions in the middle, additional information on the right.
  if (kind === 'timelineViewTemplate') {
    const t = (k: string) => textField(value, k) ?? ''
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        {t('informationField') ? <div className="vp-info">{label(t('informationField'))}</div> : null}
        {[0, 1, 2].map((r) => (
          <div key={r} className="vp-timeline-row">
            <span className="vp-tl-left">
              <span className="vp-muted">{label(t('dateField'))}</span>
              {t('iconField') || t('iconIdField') ? <span className="vp-tile-icon is-small" /> : null}
            </span>
            <span className="vp-tile-text">
              <span className="vp-title">{label(t('titleField'))}</span>
              {t('descriptionField') ? <span className="vp-muted">{label(t('descriptionField'))}</span> : null}
              {t('subdescriptionField') ? <span className="vp-muted">{label(t('subdescriptionField'))}</span> : null}
            </span>
            {t('additionalInfoField') ? <span className="vp-muted vp-tl-right">{label(t('additionalInfoField'))}</span> : null}
          </div>
        ))}
      </section>
    )
  }

  // Gantt: the steps as a tree with the configured columns on the left, the durations as bars on the right.
  if (kind === 'ganttViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-gantt">
          <div className="vp-gantt-tree">
            {[0, 1, 2].map((r) => (
              <div key={r} style={{ paddingLeft: r === 2 ? 14 : 0 }}>
                {cols.length > 0 ? cols.map((c) => label(c)).join(' | ') : label(textField(value, 'titleField') ?? '')}
              </div>
            ))}
          </div>
          <div className="vp-gantt-bars">
            {[
              [0, 50],
              [20, 40],
              [45, 45],
            ].map(([left, width], r) => (
              <div key={r} className="vp-gantt-row">
                <span className="vp-gantt-bar" style={{ marginLeft: `${left}%`, width: `${width}%` }}>
                  {label(textField(value, 'titleField') ?? '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  // ResourceTimeline: resource tree on the left, entries on a timeline on the right.
  if (kind === 'resourceTimelineViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-gantt">
          <div className="vp-gantt-tree">
            {[0, 1, 2].map((r) => (
              <div key={r}>{label(textField(value, 'titleField') ?? 'Resource')}</div>
            ))}
          </div>
          <div className="vp-gantt-bars">
            {[
              [5, 30],
              [35, 25],
              [20, 40],
            ].map(([left, width], r) => (
              <div key={r} className="vp-gantt-row">
                <span className="vp-gantt-bar" style={{ marginLeft: `${left}%`, width: `${width}%` }} />
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  // Charts: SingleDataChart is a pie, donut, funnel or pyramid; the other chart templates are column, bar, line, spline or area charts.
  if (kind === 'singleDataChartViewTemplate' || kind === 'multiDataChartViewTemplate' || kind === 'dynamicSingleDataChartViewTemplate' || kind === 'dynamicMultiDataChartViewTemplate') {
    const type = textField(value, 'chartType') ?? (kind.startsWith('single') || kind.startsWith('dynamicSingle') ? 'PIE' : 'COLUMN')
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name}>
          <span className="vp-chip">{type}</span>
        </Head>
        <ChartSketch type={type} />
      </section>
    )
  }

  if (kind === 'stepperViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <Steps labels={['Step 1', 'Step 2', 'Step 3']} />
      </section>
    )
  }

  // DragAndDrop: a drop zone with the description text of the configured field.
  if (kind === 'dragAndDropViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <div className="vp-dropzone">{label(textField(value, 'descriptionField') ?? 'Drop files here')}</div>
      </section>
    )
  }

  // Favorite: star button and a text field for the tags.
  if (kind === 'favoriteViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Drawer caption="Tags" fixed={false}>
          <div className="vp-favorite">
            <span className="vp-star" aria-label="Favorite">
              ★
            </span>
            <span className="vp-field-box is-edit vp-grow" />
          </div>
        </Drawer>
      </section>
    )
  }

  // IndexSearch: a single text input with the magnifying glass.
  if (kind === 'indexSearchViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <div className="vp-search is-input">Search</div>
      </section>
    )
  }

  // Lookup: the lookup view of the target context, in a popup or embedded.
  if (kind === 'lookupViewTemplate') {
    const mode = (textField(value, 'consumerPresentationMode') ?? 'POPUP').toUpperCase()
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name}>
          <span className="vp-chip">{mode}</span>
        </Head>
        <Placeholder title={mode === 'EMBEDDED' ? 'Lookup view shown here' : 'Lookup view opens in a popup'}>Selected record is stored in {textField(value, 'consumerField') ?? 'the consumer field'}.</Placeholder>
      </section>
    )
  }

  if (kind === 'mapViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <MapSketch markers={3} />
      </section>
    )
  }

  if (kind === 'reportViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <Placeholder title="Report opens in a separate report window">Data from {textField(value, 'reportData') ?? 'the report field'}.</Placeholder>
      </section>
    )
  }

  if (kind === 'webContentViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <div className="vp-iframe" role="img" aria-label="Embedded web content" />
      </section>
    )
  }

  if (kind === 'pictureViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <div className="vp-picture" title={textField(value, 'pictureField') ?? ''} role="img" aria-label="Picture" />
      </section>
    )
  }

  if (kind === 'signatureViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <div className="vp-signature">
          <span className="vp-muted">Sign here</span>
          <span className="vp-signature-delete" aria-label="Delete signature">
            ✕
          </span>
        </div>
      </section>
    )
  }

  if (kind === 'dynamicFormViewTemplate') {
    return (
      <section className="vp-card" data-template={kind}>
        <Head kind={kind} name={name} />
        <Placeholder title="Form generated at run time">The fields come from the JSON of the form definition field.</Placeholder>
      </section>
    )
  }

  // Not described in the ViewTemplate reference (or not known to it): a placeholder with the name.
  return (
    <section className="vp-card" data-template={kind} data-undocumented="true">
      <Head kind={kind} name={name} />
      <Placeholder title={`${kind.replace(/ViewTemplate$/, '')} - no preview`}>This ViewTemplate is not described in the ViewTemplate reference; its fields are shown in Properties.</Placeholder>
    </section>
  )
}

function Reference({ api, child, depth, trail, order }: { api: ForgeApi; child: Child; depth: number; trail: string[]; order: number | null }) {
  const anchorOuter = useContext(AnchorContext)
  const viewName = textField(child.value, 'view') ?? ''
  const index = useProjectIndex()
  const node = index?.findObject('neonView', viewName) ?? null
  const [tree, setTree] = useState<WireValue | null>(null)
  const blocked = !node || depth >= MAX_DEPTH || trail.includes(viewName)
  // A referenced view of another context uses that context's entity; one without a known
  // context keeps the fields of the surrounding view.
  const inherited = useContext(EntityFieldsContext)
  const own = useEntityFields(api, blocked ? null : (index?.entityOfView?.(viewName) ?? null))

  useEffect(() => {
    if (blocked || !node) return
    let alive = true
    api
      .getPropertyTree(node.id)
      .then((t) => {
        if (alive) setTree(t)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [api, node, blocked])

  const anchor = anchorOuter ?? { path: child.path, label: viewName || 'View' }
  if (blocked || !tree) {
    return (
      <Selectable as="fieldset" path={child.path} label={viewName || 'View'} view={node ? viewName : undefined} className="vp-frame" order={order} title={node ? 'Nesting limit reached' : 'View not found in the open projects'}>
        <legend>{viewName || 'View'}</legend>
      </Selectable>
    )
  }
  return (
    <Selectable as="fieldset" path={child.path} label={viewName} view={viewName} className="vp-frame" order={order}>
      <legend>{viewName}</legend>
      <AnchorContext.Provider value={anchor}>
        <EntityFieldsContext.Provider value={own ?? inherited}>
          <ViewTree api={api} tree={tree} depth={depth + 1} trail={[...trail, viewName]} />
        </EntityFieldsContext.Provider>
      </AnchorContext.Provider>
    </Selectable>
  )
}

function ChildBlock({ api, child, depth, trail, order }: { api: ForgeApi; child: Child; depth: number; trail: string[]; order: number | null }) {
  if (child.kind === 'neonViewReference') return <Reference api={api} child={child} depth={depth} trail={trail} order={order} />
  return (
    <Selectable path={child.path} label={textField(child.value, 'name') || child.kind} className="vp-block" order={order}>
      <Template child={child} />
    </Selectable>
  )
}

export function ViewTree({ api, tree, depth = 0, trail = [] }: { api: ForgeApi; tree: WireValue; depth?: number; trail?: string[] }) {
  const actions = useContext(PreviewActionsContext)
  const anchored = useContext(AnchorContext) !== null
  const base = childrenOf(tree)
  // The open view follows the order of its file (the property tree groups children by kind).
  const order = !anchored && depth === 0 ? (actions?.order ?? null) : null
  const children = useMemo(() => {
    if (!order) return base
    const rank = (c: Child) => {
      const i = order.indexOf(`${c.kind}|${textField(c.value, 'name') ?? ''}`)
      return i < 0 ? order.length : i
    }
    return [...base].sort((a, b) => rank(a) - rank(b))
  }, [base, order])
  const layout = layoutOf(tree)
  const render = (c: Child): ReactNode => (
    <ChildBlock key={`${c.kind}${c.path}`} api={api} child={c} depth={depth} trail={trail} order={order ? order.indexOf(`${c.kind}|${textField(c.value, 'name') ?? ''}`) : null} />
  )

  return <Layout layout={layout} children={children} render={render} />
}

function labelOfChild(c: Child): string {
  return textField(c.value, 'title') || textField(c.value, 'view') || humanize(c.kind.replace(/ViewTemplate$|^neon/g, ''))
}

// The layouts of the ViewTemplate reference: None (one component), Box (direction and wrapping), Grid (columns), Group (one alternative at a time, picked
// with the button at the top right), Drawer (header bar with a collapse button), HeaderFooter (fixed top and bottom) and MasterDetail (master left, details in tabs).
function Layout({ layout, children, render }: { layout: { kind: string; value: WireValue | undefined }; children: Child[]; render: (c: Child) => ReactNode }) {
  const [picked, setPicked] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [detail, setDetail] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const named = (n: string | undefined) => children.find((c) => textField(c.value, 'name') === n)

  if (layout.kind === 'masterSlaveLayout' || layout.kind === 'masterDetailLayout') {
    const master = named(textField(layout.value, 'master'))
    const details = children.filter((c) => c !== master)
    const shown = details[Math.min(detail, details.length - 1)]
    return (
      <div className="vp-master-slave" data-layout="masterDetail">
        <div className="vp-stack">{master ? render(master) : null}</div>
        <div className="vp-stack">
          {details.length > 1 ? (
            <div className="vp-tabbar" role="tablist" aria-label="Detail views">
              {details.map((c, i) => (
                <button key={`${c.kind}${c.path}`} type="button" role="tab" aria-selected={i === detail} className={`vp-tab${i === detail ? ' is-active' : ''}`} onClick={() => setDetail(i)}>
                  {labelOfChild(c)}
                </button>
              ))}
            </div>
          ) : null}
          {shown ? render(shown) : null}
        </div>
      </div>
    )
  }
  if (layout.kind === 'headerFooterLayout') {
    const header = named(textField(layout.value, 'header'))
    const footer = named(textField(layout.value, 'footer'))
    const body = children.filter((c) => c !== header && c !== footer)
    return (
      <div className="vp-header-footer" data-layout="headerFooter">
        {header ? render(header) : null}
        <div className="vp-hf-body">{body.map((c) => render(c))}</div>
        {footer ? render(footer) : null}
      </div>
    )
  }
  if (layout.kind === 'gridLayout') {
    const columns = intField(layout.value, 'columnCount') ?? 0
    return (
      <div className="vp-grid" data-layout="grid" style={columns > 0 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
        {children.map(render)}
      </div>
    )
  }
  if (layout.kind === 'boxLayout') {
    const horizontal = (textField(layout.value, 'direction') ?? 'VERTICAL').toUpperCase() === 'HORIZONTAL'
    const max = intField(layout.value, 'maxDirectionElements') ?? 0
    const style =
      max > 0
        ? horizontal
          ? { display: 'grid', gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }
          : { display: 'grid', gridAutoFlow: 'column', gridTemplateRows: `repeat(${max}, auto)` }
        : horizontal
          ? { display: 'flex', flexDirection: 'row' as const }
          : undefined
    return (
      <div className="vp-stack vp-box" data-layout="box" data-direction={horizontal ? 'horizontal' : 'vertical'} style={style}>
        {children.map(render)}
      </div>
    )
  }
  if (layout.kind === 'drawerLayout') {
    const fixed = flag(layout.value, 'fixedDrawer')
    return (
      <div className="vp-drawer-box" data-layout="drawer">
        <div className="vp-drawer-bar">
          <span>{textField(layout.value, 'layoutCaption') ?? ''}</span>
          {fixed ? null : (
            <button type="button" className="vp-drawer-toggle" aria-label={drawerOpen ? 'Collapse' : 'Expand'} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>
              {drawerOpen ? '^' : 'v'}
            </button>
          )}
        </div>
        {drawerOpen || fixed ? <div className="vp-stack vp-drawer-content">{children.map(render)}</div> : null}
      </div>
    )
  }
  if (layout.kind === 'groupLayout') {
    const current = children[Math.min(picked, children.length - 1)]
    return (
      <div className="vp-group" data-layout="group">
        {children.length > 1 ? (
          <div className="vp-group-picker">
            <button type="button" className="vp-group-button" aria-haspopup="listbox" aria-expanded={pickerOpen} aria-label="Select view" onClick={() => setPickerOpen(!pickerOpen)}>
              {current ? labelOfChild(current) : ''} {'▾'}
            </button>
            {pickerOpen ? (
              <ul className="vp-group-list" role="listbox" aria-label="Views">
                {children.map((c, i) => (
                  <li key={`${c.kind}${c.path}`} role="option" aria-selected={i === picked}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(i)
                        setPickerOpen(false)
                      }}
                    >
                      {labelOfChild(c)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="vp-stack">{current ? render(current) : null}</div>
      </div>
    )
  }
  return <div className="vp-stack" data-layout="none">{children.map(render)}</div>
}

/** Entity fields of the context the view belongs to (null while loading or without a context). */
export function useViewEntityFields(api: ForgeApi, viewName: string): EntityFields | null {
  const index = useProjectIndex()
  return useEntityFields(api, index?.entityOfView?.(viewName) ?? null)
}

export function ViewPreview({ api, tree, name, actions }: { api: ForgeApi; tree: WireValue; name: string; actions?: PreviewActions }) {
  const index = useProjectIndex()
  const entity = index?.entityOfView?.(name) ?? null
  const fields = useEntityFields(api, entity)
  return (
    <div className="vp-root" aria-label="View preview">
      <PreviewActionsContext.Provider value={actions ?? null}>
        <EntityFieldsContext.Provider value={fields}>
          <ViewTree api={api} tree={tree} trail={[name]} />
        </EntityFieldsContext.Provider>
      </PreviewActionsContext.Provider>
      {entity && !fields ? null : !entity ? <p className="vp-muted vp-note">Field titles come from the entity of the view's context; this view is in no context of the open projects.</p> : null}
    </div>
  )
}
