import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps } from './registry'
import { useProjectIndex } from './projectIndex'
import { setApplicationFilter, useApplicationFilter } from './applicationFilter'
import { AppKindIcon, type AppIconKind } from './AppKindIcon'
import { useIconSvgs } from './useIconSvgs'
import {
  KIND_CONTEXT,
  KIND_DASHBOARD,
  KIND_GROUP,
  KIND_ROLE,
  addChild,
  moveNode,
  nextGroupName,
  nodeAt,
  parseApplicationTree,
  removeNode,
  setNodeField,
  validateReferences,
  type AppNode,
} from './applicationTree'

// Global menu of the Web Client (`____SYSTEM_APPLICATION_NEON`), as in the original Designer
// (shot 49): left the menu as nested group tiles, right the list of everything that can be put into
// the menu. Entries are dragged from the list into a group, between entries, or within the tree;
// the buttons of a selected tile do the same without the mouse (up, down, indent, outdent, remove).
// The tree is edited as text of the .aod file, so untouched lines stay byte for byte as they are.
//
// Node kinds (read from the real files): 123 group (title, icon), 10077 context, 10090 dashboard,
// 159 role. Process and report kinds are not documented, they are not offered.

const DRAG_TYPE = 'application/x-forge-app-menu'

type PaletteType = 'NeonContext' | 'NeonDashboard' | 'Role' | 'Process' | 'Report' | 'Entity'
// `kind` null: the node kind of this type in the menu is not documented, the entry is listed but cannot be dragged.
const PALETTE: { type: PaletteType; objectType: string; kind: number | null; label: string; icon: AppIconKind }[] = [
  { type: 'NeonContext', objectType: 'neonContext', kind: KIND_CONTEXT, label: 'Context', icon: 'context' },
  { type: 'NeonDashboard', objectType: 'neonDashboard', kind: KIND_DASHBOARD, label: 'Dashboard', icon: 'dashboard' },
  { type: 'Role', objectType: 'role', kind: KIND_ROLE, label: 'Role', icon: 'role' },
  { type: 'Process', objectType: 'process', kind: null, label: 'Process', icon: 'process' },
  { type: 'Report', objectType: 'report', kind: null, label: 'Report', icon: 'report' },
  { type: 'Entity', objectType: 'entity', kind: null, label: 'Entity', icon: 'entity' },
]

interface DragData {
  type: 'new' | 'move'
  kind?: number
  name?: string
  path?: number[]
}

const key = (path: number[]) => path.join('.')

function kindClass(kind: number | null): string {
  if (kind === KIND_CONTEXT) return 'context'
  if (kind === KIND_DASHBOARD) return 'dashboard'
  if (kind === KIND_ROLE) return 'role'
  return 'group'
}

export function ApplicationEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  const index = useProjectIndex()
  const iconSvgs = useIconSvgs(api)
  // An object with an own icon (a context or entity) shows it; the others show the colour symbol of their type.
  const ownIcon = (objectType: string, name: string) => {
    const id = index?.iconOf?.(objectType, name)
    const svg = id ? iconSvgs.get(id) : undefined
    return svg ? <span className="app-own-icon" title={id} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} /> : null
  }
  const filter = useApplicationFilter()
  const [source, setSource] = useState<{ text: string; read_only: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number[] | null>(null)
  const [search, setSearch] = useState('')
  const [dropMark, setDropMark] = useState<string | null>(null)
  const [hover, setHover] = useState<{ name: string; label: string; used: boolean; draggable: boolean; x: number; y: number } | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    api
      .getObjectSource(nodeId)
      .then((s) => !cancelled && setSource(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [api, nodeId, tree])

  const root = useMemo(() => (source ? parseApplicationTree(source.text) : null), [source])
  const readOnly = source?.read_only ?? true

  const apply = useCallback(
    async (next: string | null) => {
      if (next === null || !source || next === source.text || busy.current) return
      busy.current = true
      try {
        const outcome = await api.setObjectSource(nodeId, next)
        setError(null)
        setSource({ text: next, read_only: false })
        onTreeChange(outcome.tree)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        busy.current = false
      }
    },
    [api, nodeId, onTreeChange, source],
  )

  const names = useMemo(() => {
    const out: Record<PaletteType, Set<string>> = { NeonContext: new Set(), NeonDashboard: new Set(), Role: new Set(), Process: new Set(), Report: new Set(), Entity: new Set() }
    for (const p of PALETTE) for (const n of index?.namesOf?.(p.type === 'Process' && filter.ExecutablesOnly ? 'process:executables' : p.objectType) ?? []) out[p.type].add(n)
    return out
  }, [index, filter.ExecutablesOnly])

  const issues = useMemo(
    () => (root ? validateReferences(root, { contexts: names.NeonContext, dashboards: names.NeonDashboard, roles: names.Role }) : []),
    [root, names],
  )
  const issueByPath = useMemo(() => new Map(issues.map((i) => [key(i.path), i.message])), [issues])

  const used = useMemo(() => {
    const set = new Set<string>()
    const walk = (n: AppNode) => {
      if (n.kind !== null && n.kind !== KIND_GROUP && n.kind !== 200) set.add(`${n.kind}:${n.name}`)
      n.children.forEach(walk)
    }
    if (root) walk(root)
    return set
  }, [root])

  const palette = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const items: { kind: number | null; name: string; type: PaletteType; icon: AppIconKind }[] = []
    for (const p of PALETTE) {
      if (!filter[p.type]) continue
      const all = new Set(names[p.type])
      if (p.type === 'Role' && root) {
        const walk = (n: AppNode) => {
          if (n.kind === KIND_ROLE && n.name.startsWith('INTERNAL_')) all.add(n.name)
          n.children.forEach(walk)
        }
        walk(root)
      }
      for (const name of all) if (!needle || name.toLowerCase().includes(needle)) items.push({ kind: p.kind, name, type: p.type, icon: p.type === 'Process' && /_test$/i.test(name) ? 'test' : p.icon })
    }
    return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [filter, names, root, search])

  const paletteTotal = useMemo(() => PALETTE.reduce((n, p) => n + (filter[p.type] ? names[p.type].size : 0), 0), [filter, names])

  function jumpToFirstIssue() {
    const first = issues[0]
    if (!first) return
    setSelected(first.path)
    window.setTimeout(() => document.querySelector(`[data-p="${key(first.path)}"]`)?.scrollIntoView?.({ block: 'center' }), 0)
  }

  if (error && !source) return <div className="application-editor"><p role="alert">{error}</p></div>
  if (!root) {
    return (
      <div className="application-editor">
        <p>This application object has no root entityNode.</p>
      </div>
    )
  }

  function dropAt(parentPath: number[], at: number, data: DragData) {
    if (readOnly || !source) return
    if (data.type === 'new' && data.kind !== undefined && data.name) void apply(addChild(source.text, parentPath, at, data.kind, data.name))
    else if (data.type === 'move' && data.path) void apply(moveNode(source.text, data.path, parentPath, at))
  }

  function readDrag(e: React.DragEvent): DragData | null {
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return null
    try {
      return JSON.parse(raw) as DragData
    } catch {
      return null
    }
  }

  function dropProps(parentPath: number[], at: (() => number) | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (readOnly) return
        e.preventDefault()
        e.stopPropagation()
        setDropMark((e.currentTarget as HTMLElement).dataset.p ?? '')
      },
      onDragLeave: () => setDropMark(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDropMark(null)
        const data = readDrag(e)
        if (!data) return
        const parent = nodeAt(root!, parentPath)
        dropAt(parentPath, at ? at() : (parent?.children.length ?? 0), data)
      },
    }
  }

  function parentOf(path: number[]) {
    return { parentPath: path.slice(0, -1), i: path[path.length - 1] }
  }

  function step(kind: 'up' | 'down' | 'indent' | 'outdent', path: number[]) {
    if (readOnly || !source || path.length === 0) return
    const { parentPath, i } = parentOf(path)
    const parent = nodeAt(root!, parentPath)
    if (!parent) return
    let next: string | null = null
    if (kind === 'up' && i > 0) next = moveNode(source.text, path, parentPath, i - 1)
    if (kind === 'down' && i < parent.children.length - 1) next = moveNode(source.text, path, parentPath, i + 2)
    if (kind === 'indent' && i > 0 && parent.children[i - 1].kind === KIND_GROUP) {
      const target = [...parentPath, i - 1]
      next = moveNode(source.text, path, target, parent.children[i - 1].children.length)
      if (next) setSelected([...target, parent.children[i - 1].children.length])
    }
    if (kind === 'outdent' && parentPath.length > 0) {
      const grand = parentPath.slice(0, -1)
      const at = parentPath[parentPath.length - 1] + 1
      next = moveNode(source.text, path, grand, at)
      if (next) setSelected([...grand, at])
    }
    if (kind === 'up' && next) setSelected([...parentPath, i - 1])
    if (kind === 'down' && next) setSelected([...parentPath, i + 1])
    void apply(next)
  }

  function remove(path: number[]) {
    if (readOnly || !source) return
    setSelected(null)
    void apply(removeNode(source.text, path))
  }

  function addGroup() {
    if (readOnly || !source) return
    const target = selected && nodeAt(root!, selected)?.kind === KIND_GROUP ? selected : []
    const parent = nodeAt(root!, target)
    if (parent) void apply(addChild(source.text, target, parent.children.length, KIND_GROUP, nextGroupName(root!), ''))
  }

  function addToSelected(item: { kind: number; name: string }) {
    if (readOnly || !source) return
    const target = selected && nodeAt(root!, selected)?.kind === KIND_GROUP ? selected : root!.children.length > 0 ? [0] : []
    const parent = nodeAt(root!, target)
    if (parent) void apply(addChild(source.text, target, parent.children.length, item.kind, item.name))
  }

  function commitField(path: number[], field: 'title' | 'icon', value: string) {
    if (readOnly || !source) return
    void apply(setNodeField(source.text, path, field, value))
  }

  function renderNode(node: AppNode, path: number[]) {
    const id = key(path)
    const isGroup = node.kind === KIND_GROUP
    const isSelected = selected !== null && key(selected) === id
    const issue = issueByPath.get(id)
    const { parentPath, i } = parentOf(path)
    const siblings = nodeAt(root!, parentPath)?.children.length ?? 0
    const buttons = isSelected && !readOnly ? (
      <span className="app-tools">
        <button type="button" aria-label="Move up" disabled={i === 0} onClick={(e) => (e.stopPropagation(), step('up', path))}>{'↑'}</button>
        <button type="button" aria-label="Move down" disabled={i >= siblings - 1} onClick={(e) => (e.stopPropagation(), step('down', path))}>{'↓'}</button>
        <button type="button" aria-label="Indent" disabled={i === 0 || nodeAt(root!, [...parentPath, i - 1])?.kind !== KIND_GROUP} onClick={(e) => (e.stopPropagation(), step('indent', path))}>{'⇥'}</button>
        <button type="button" aria-label="Outdent" disabled={path.length < 2} onClick={(e) => (e.stopPropagation(), step('outdent', path))}>{'⇤'}</button>
      </span>
    ) : null
    const removeButton = readOnly ? null : (
      <button type="button" className="app-remove" aria-label={`Remove ${node.name}`} onClick={(e) => (e.stopPropagation(), remove(path))}>
        {'⊗'}
      </button>
    )
    const dragProps = readOnly
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation()
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'move', path } satisfies DragData))
            e.dataTransfer.effectAllowed = 'move'
          },
        }
    if (!isGroup) {
      return (
        <div
          key={id}
          className={`app-entry app-${kindClass(node.kind)}${isSelected ? ' is-selected' : ''}${issue ? ' is-broken' : ''}${dropMark === id ? ' is-drop' : ''}`}
          title={issue}
          data-p={id}
          role="treeitem"
          aria-selected={isSelected}
          tabIndex={0}
          onClick={(e) => (e.stopPropagation(), setSelected(path))}
          onKeyDown={(e) => {
            if (e.key === 'Delete') remove(path)
          }}
          {...dragProps}
          {...dropProps(parentPath, () => i)}
        >
          {(node.kind === KIND_CONTEXT ? ownIcon('neonContext', node.name) : null) ?? null}
          {node.kind === KIND_CONTEXT && ownIcon('neonContext', node.name) ? null : (
            <AppKindIcon kind={node.kind === KIND_CONTEXT ? 'context' : node.kind === KIND_DASHBOARD ? 'dashboard' : node.kind === KIND_ROLE ? 'role' : 'group'} invalid={!!issue} />
          )}
          <span className="app-name">{issue ? <span className="app-invalid">{'<invalid> '}</span> : null}{node.name}</span>
          {buttons}
          {removeButton}
        </div>
      )
    }
    return (
      <div
        key={id}
        className={`app-tile${isSelected ? ' is-selected' : ''}${dropMark === id ? ' is-drop' : ''}`}
        role="group"
        aria-label={`Group ${node.name}`}
        data-p={id}
        onClick={(e) => (e.stopPropagation(), setSelected(path))}
        {...dropProps(path, null)}
      >
        <div className="app-tile-head" {...dragProps}>
          <input
            className="app-title"
            aria-label={`${node.name} title`}
            placeholder="(no title)"
            defaultValue={node.title ?? ''}
            key={`${id}:${node.title ?? ''}`}
            readOnly={readOnly}
            onBlur={(e) => e.currentTarget.value !== (node.title ?? '') && commitField(path, 'title', e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span className="app-name">[{node.name}]</span>
          {node.icon !== null || path.length === 1 ? (
            <input
              className="app-icon-field"
              aria-label={`${node.name} icon`}
              placeholder="icon"
              defaultValue={node.icon ?? ''}
              key={`${id}:icon:${node.icon ?? ''}`}
              readOnly={readOnly}
              onBlur={(e) => e.currentTarget.value !== (node.icon ?? '') && commitField(path, 'icon', e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          ) : null}
          {buttons}
          {removeButton}
        </div>
        <div className="app-children">{node.children.map((c, ci) => renderNode(c, [...path, ci]))}</div>
        {node.children.length === 0 ? <div className="app-empty">Drop entries here</div> : null}
      </div>
    )
  }

  return (
    <div className="application-editor app-split" aria-label="Application navigation tree">
      <div className="app-left">
        <div className="app-bar">
          <button type="button" onClick={addGroup} disabled={readOnly}>
            Add group
          </button>
          {issues.length > 0 ? (
            <button type="button" className="app-issues" title="Jump to the first broken reference" onClick={jumpToFirstIssue}>
              {issues.length} broken reference{issues.length === 1 ? '' : 's'}
            </button>
          ) : null}
          {readOnly ? <span className="app-readonly">Read only: this object belongs to a module.</span> : null}
        </div>
        {error ? <p className="forge-field-error" role="alert">{error}</p> : null}
        <div className="app-tree" role="tree" {...dropProps([], null)}>
          {root.children.map((c, ci) => renderNode(c, [ci]))}
          {root.children.length === 0 ? <div className="app-empty">Drop entries here</div> : null}
        </div>
      </div>
      <div className="app-right">
        <div className="app-filter-row">
          <input type="search" aria-label="Filter list" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="app-chips" role="group" aria-label="Types">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                role="checkbox"
                aria-checked={filter[p.type]}
                className={`app-chip${filter[p.type] ? ' is-on' : ''}`}
                title={p.kind === null ? 'Listed for orientation only: the node kind in the menu is not documented, so it cannot be dragged.' : undefined}
                onClick={() => setApplicationFilter(p.type, !filter[p.type])}
              >
                <AppKindIcon kind={p.icon} />
                {p.label}
              </button>
            ))}
            <button type="button" role="checkbox" aria-checked={filter.ExecutablesOnly} className={`app-chip${filter.ExecutablesOnly ? ' is-on' : ''}`} title="Only processes of the tree group executables (variant EXECUTABLE)" onClick={() => setApplicationFilter('ExecutablesOnly', !filter.ExecutablesOnly)}>
              Executables Only
            </button>
          </span>
          <span className="app-count" role="status">
            {palette.length} of {paletteTotal}
          </span>
        </div>
        <ul className="app-palette" aria-label="Available entries">
          {palette.map((item) => {
            const isUsed = item.kind !== null && used.has(`${item.kind}:${item.name}`)
            const canDrag = !readOnly && item.kind !== null
            return (
              <li
                key={`${item.type}:${item.name}`}
                className={`${isUsed ? 'is-used ' : ''}${item.kind === null ? 'is-static' : ''}`}
                draggable={canDrag}
                tabIndex={0}
                onMouseEnter={(e) => setHover({ name: item.name, label: PALETTE.find((p) => p.type === item.type)?.label ?? '', used: isUsed, draggable: canDrag, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onDragStart={(e) => {
                  if (item.kind === null) return
                  setHover(null)
                  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'new', kind: item.kind, name: item.name } satisfies DragData))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDoubleClick={() => item.kind !== null && addToSelected({ kind: item.kind, name: item.name })}
                onKeyDown={(e) => e.key === 'Enter' && item.kind !== null && addToSelected({ kind: item.kind, name: item.name })}
              >
                {ownIcon(PALETTE.find((p) => p.type === item.type)?.objectType ?? '', item.name) ?? <AppKindIcon kind={item.icon} />}
                {item.name}
              </li>
            )
          })}
        </ul>
        {hover ? (
          <div className="app-popup" role="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <strong>{hover.name}</strong>
            <div>{hover.label}</div>
            <div>{hover.used ? 'Already in the menu' : hover.draggable ? 'Drag into a group' : 'Cannot be dragged (node kind not documented)'}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
