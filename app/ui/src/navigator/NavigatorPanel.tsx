import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { NavNode } from '../wire/types'
import { setApplicationFilter, useApplicationFilter } from '../editors/applicationFilter'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'

// Navigator (LAYOUT_SPEC §7): the structure of the selected object. Selecting an element shows
// its properties in the Properties panel. Entities: RecordContainers with field bindings, Fields,
// Parameters, Providers, Consumers, Services; views: template hierarchy; contexts: entity and
// views; processes: the functions of the JDito code; application: the object-type filter.

function NavIcon({ icon }: { icon: string }) {
  const common = { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true }
  switch (icon) {
    case 'folder':
      return (
        <svg {...common}>
          <path d="M1 3.5h4l1 1h7v7.5H1z" fill="var(--icon-folder)" />
        </svg>
      )
    case 'container':
      return (
        <svg {...common}>
          <ellipse cx="7" cy="3.5" rx="5" ry="2" fill="none" stroke="var(--fg-muted)" />
          <path d="M2 3.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7" fill="none" stroke="var(--fg-muted)" />
        </svg>
      )
    case 'consumer':
      return (
        <svg {...common}>
          <path d="M12 7H3M6 4 3 7l3 3" fill="none" stroke="var(--fg)" strokeWidth="1.4" />
        </svg>
      )
    case 'provider':
      return (
        <svg {...common}>
          <path d="M2 7h9M8 4l3 3-3 3" fill="none" stroke="var(--fg)" strokeWidth="1.4" />
        </svg>
      )
    case 'function':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="4" fill="var(--error)" />
        </svg>
      )
    case 'table':
      return (
        <svg {...common}>
          <rect x="1.5" y="2.5" width="11" height="9" fill="none" stroke="var(--fg-muted)" />
          <path d="M1.5 5.5h11M5.5 2.5v9" stroke="var(--fg-muted)" />
        </svg>
      )
    case 'key':
      return (
        <svg {...common}>
          <circle cx="4.5" cy="8" r="2.3" fill="none" stroke="var(--icon-folder)" strokeWidth="1.3" />
          <path d="M6.6 7 12 2M10 4l1.5 1.5" stroke="var(--icon-folder)" strokeWidth="1.3" fill="none" />
        </svg>
      )
    case 'object':
    case 'entity':
      return (
        <svg {...common}>
          <rect x="2" y="1.5" width="10" height="11" fill="none" stroke="var(--icon-entity)" />
        </svg>
      )
    case 'view':
    case 'template':
      return (
        <svg {...common}>
          <rect x="1.5" y="2" width="11" height="10" fill="none" stroke="var(--icon-neonView)" />
          <path d="M1.5 5h11" stroke="var(--icon-neonView)" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" fill="none" stroke="var(--fg-muted)" />
        </svg>
      )
  }
}

const NEW_MARK = '#new:'

// Group that is open when an object is shown for the first time; every other group starts closed.
const MAIN_GROUP: Record<string, string> = { entity: 'Fields', neonDashboard: 'Dashlets' }

// Opened and closed groups per object, kept for the session.
const collapsedMemory = new Map<string, Set<string>>()

export function startsCollapsed(node: { icon: string; label: string }, depth: number, objectType: string | null): boolean {
  if (depth === 1 && node.icon === 'folder') return node.label !== (objectType ? MAIN_GROUP[objectType] : undefined)
  return depth >= 2 && node.icon !== 'container'
}
const NAV_ROW_HEIGHT = 19
const NAV_OVERSCAN = 15
const NAV_VIRTUAL_THRESHOLD = 400

function findByLabel(list: NavNode[], label: string): NavNode | null {
  for (const n of list) {
    if (n.label === label && n.path) return n
    const hit = findByLabel(n.children, label)
    if (hit) return hit
  }
  return null
}

function keyOf(parent: string, node: NavNode, index: number): string {
  return `${parent}/${index}:${node.label}`
}

export function NavigatorPanel({
  api,
  nodeId,
  objectType,
  origin,
  selectedPath,
  onSelect,
  version = 0,
  onReset,
  onActivate,
  readOnlyHint,
}: {
  api: ForgeApi
  nodeId: string | null
  objectType: string | null
  /** Origin of the object (`@scope/name:version (<last overriding package>)`), empty for own objects. */
  origin: string
  selectedPath: string | null
  onSelect: (path: string, label: string) => void
  /** Bumped when the object changed, so the outline is read again. */
  version?: number
  /** Set to Default of an element that has its own definition. */
  onReset?: (path: string, label: string) => void
  /** Activate of a grey entry: creates its definition so it can be edited. */
  onActivate?: (path: string, label: string) => void
  /** Why Set to Default is not available for this object (empty when it is). */
  readOnlyHint?: string
}) {
  const [nodes, setNodes] = useState<NavNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ node: NavNode; x: number; y: number } | null>(null)
  const lastNode = useRef<string | null>(null)
  // Large outlines (thousands of entries) only put the rows in view into the DOM.
  const [scroll, setScroll] = useState({ top: 0, height: 600 })
  const treeRef = useRef<HTMLDivElement | null>(null)
  const scrollFrame = useRef<number | null>(null)

  useEffect(() => {
    if (lastNode.current !== nodeId) {
      setCollapsed(new Set(nodeId ? (collapsedMemory.get(nodeId) ?? []) : []))
      setNodes(null)
    }
    lastNode.current = nodeId
    if (!nodeId || objectType === 'application') {
      setNodes(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .getNavigator(nodeId)
      .then((n) => {
        if (!cancelled) setNodes(n)
      })
      .catch(() => {
        if (!cancelled) setNodes([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, nodeId, objectType, version])

  // After the first edit of a grey entry its mapping exists: the selection follows to the real element.
  useEffect(() => {
    if (!nodes || !selectedPath || !selectedPath.includes(NEW_MARK)) return
    const label = selectedPath.slice(selectedPath.indexOf(NEW_MARK) + NEW_MARK.length)
    const hit = findByLabel(nodes, label)
    if (hit?.path && !hit.path.includes(NEW_MARK)) onSelect(hit.path, label)
  }, [nodes, selectedPath, onSelect])

  if (objectType === 'application') return <ApplicationFilter />
  if (!nodeId) return <div className="forge-panel-empty">&lt;No View Available&gt;</div>
  if (nodes === null || (loading && nodes.length === 0)) return <div className="forge-panel-empty">Please Wait…</div>
  if (nodes.length === 0) return <div className="forge-panel-empty">&lt;No View Available&gt;</div>

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      if (nodeId) collapsedMemory.set(nodeId, next)
      return next
    })

  const pick = (id: string, node: NavNode) => {
    if (id === 'reset' && node.path && onReset) onReset(node.path, node.label)
    else if (id === 'activate' && node.path && onActivate) onActivate(node.path, node.label)
    else if (id === 'copy') void navigator.clipboard?.writeText(node.label)
  }

  interface Row {
    node: NavNode
    key: string
    depth: number
    hasChildren: boolean
    isCollapsed: boolean
  }

  const rows: Row[] = []
  const collect = (list: NavNode[], parentKey: string, depth: number) => {
    list.forEach((node, i) => {
      const key = keyOf(parentKey, node, i)
      const hasChildren = node.children.length > 0
      // Deeper levels start collapsed so large entities stay readable; record containers stay
      // open like in the original (screenshot 44).
      const isCollapsed = collapsed.has(key) !== startsCollapsed(node, depth, objectType)
      rows.push({ node, key, depth, hasChildren, isCollapsed })
      if (hasChildren && !isCollapsed) collect(node.children, key, depth + 1)
    })
  }
  collect(nodes, '', 0)

  const renderRow = ({ node, key, depth, hasChildren, isCollapsed }: Row): ReactNode => {
    const isSelected = !!node.path && node.path === selectedPath
    return (
      <div
        key={key}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-selected={isSelected}
        className={`nav-row${node.dimmed ? ' is-dimmed' : ''}${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          if (node.path) onSelect(node.path, node.label)
          else if (hasChildren) toggle(key)
        }}
        title={node.tooltip}
        onDoubleClick={() => {
          if (hasChildren) toggle(key)
          else if (node.path?.includes(NEW_MARK) && onActivate) onActivate(node.path, node.label)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (node.path) onSelect(node.path, node.label)
          setMenu({ node, x: e.clientX, y: e.clientY })
        }}
      >
        <span
          className="nav-toggle"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) toggle(key)
          }}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
        </span>
        <span className="nav-icon" title={node.icon === 'function' ? 'JDito function found in the process file (a marker, not an error)' : undefined}>
          <NavIcon icon={node.icon} />
        </span>
        <span className="nav-label">{node.label}</span>
        {node.with_origin && origin ? <span className="nav-origin">{origin}</span> : null}
      </div>
    )
  }

  const windowed = rows.length > NAV_VIRTUAL_THRESHOLD
  const first = windowed ? Math.max(0, Math.floor(scroll.top / NAV_ROW_HEIGHT) - NAV_OVERSCAN) : 0
  const last = windowed ? Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / NAV_ROW_HEIGHT) + NAV_OVERSCAN) : rows.length

  return (
    <div
      className="nav-tree"
      role="tree"
      aria-label="Navigator"
      ref={treeRef}
      onScroll={(e) => {
        if (!windowed) return
        const el = e.currentTarget
        if (scrollFrame.current !== null) return
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = null
          setScroll({ top: el.scrollTop, height: el.clientHeight || 600 })
        })
      }}
    >
      {windowed ? <div style={{ height: first * NAV_ROW_HEIGHT }} aria-hidden="true" /> : null}
      {rows.slice(first, last).map(renderRow)}
      {windowed ? <div style={{ height: (rows.length - last) * NAV_ROW_HEIGHT }} aria-hidden="true" /> : null}
      {menu ? <TreeContextMenu entries={menuEntries(menu.node, !!onReset, !!onActivate, readOnlyHint ?? '')} x={menu.x} y={menu.y} onPick={(id) => pick(id, menu.node)} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}

// Entries of the Navigator context menu. The Manual does not describe this menu; Set to Default was asked for,
// Copy Name is Dito Designer's own choice. Entries without a function stay visible, dimmed, with the reason.
function menuEntries(node: NavNode, canReset: boolean, canActivate: boolean, readOnlyHint: string): MenuEntry[] {
  const isElement = !!node.path && node.path !== '$' && node.icon !== 'folder'
  let hint = ''
  if (!isElement) hint = 'Only an element can be set to default.'
  else if (node.path!.includes(NEW_MARK) || node.dimmed) hint = 'Already shows the defaults: this entry has no definition of its own.'
  else if (!canReset) hint = 'Not available here.'
  else if (readOnlyHint) hint = readOnlyHint
  const virtual = !!node.path?.includes(NEW_MARK)
  return [
    { id: 'activate', label: 'Activate', enabled: virtual && canActivate, hint: virtual ? 'Not available here.' : 'This entry already has a definition.' },
    { id: 'reset', label: 'Set to Default', enabled: hint === '', hint },
    { id: 'sep', label: '', enabled: false, separator: true },
    { id: 'copy', label: 'Copy Name', enabled: true },
  ]
}

/** application: filter of the object types offered in the menu editor (shown only for now). */
function ApplicationFilter() {
  const shared = useApplicationFilter()
  const checked: Record<string, boolean> = { ...shared, 'Executables Only': shared.ExecutablesOnly }
  const entries: [string, string, number][] = [
    ['NeonContext', '--folder-context', 0],
    ['NeonDashboard', '--folder-dashboard', 0],
    ['Role', '--folder-role', 0],
    ['Process', '--folder-process', 0],
    ['Executables Only', '--folder-process', 1],
    ['Report', '--folder-report', 0],
  ]
  return (
    <div className="nav-filter" role="group" aria-label="Object filter">
      {entries.map(([label, color, indent]) => (
        <button
          key={label}
          type="button"
          role="checkbox"
          aria-checked={checked[label]}
          className={checked[label] ? 'nav-row nav-filter-row' : 'nav-row nav-filter-row is-dimmed'}
          style={{ paddingLeft: 6 + indent * 16 }}
          disabled={!(label in shared) && label !== 'Executables Only'}
          title={label === 'Process' || label === 'Report' ? 'Shown in the list for orientation; the node kind in the menu is not documented, so it cannot be dragged.' : label === 'Executables Only' ? 'Only processes of the tree group executables (variant EXECUTABLE)' : undefined}
          onClick={() => {
            const k = (label === 'Executables Only' ? 'ExecutablesOnly' : label) as keyof typeof shared
            setApplicationFilter(k, !shared[k])
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1 3.5h4l1 1h7v7.5H1z" fill={`var(${color})`} opacity={checked[label] ? 1 : 0.35} />
          </svg>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </div>
  )
}
