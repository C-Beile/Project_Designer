import { normId } from '../problems/problemStore'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { isOpenable, type TreeNode } from '../wire/types'
import { NodeIcon } from './treeIcons'

// Projects tree like the original Designer (LAYOUT_SPEC §4.2/§4.4): several project roots, a
// single click selects (fills Properties/Navigator later), double-click or Enter opens. Keyboard
// follows the WAI-ARIA tree pattern (arrows, Left/Right collapse/expand, Home/End, type-ahead).
// Large projects (Pichler: thousands of rows) stay fluid through a small fixed-row-height
// virtualisation: only the rows in view (plus overscan and the focused row) are in the DOM.

export const ROW_HEIGHT = 19
const OVERSCAN = 12
const FALLBACK_VIEWPORT = 600
const TYPEAHEAD_RESET_MS = 600

interface FlatRow {
  key: string
  node: TreeNode
  depth: number
  parentKey: string | null
  top: TreeNode
}

function flatten(
  nodes: TreeNode[],
  depth: number,
  parentKey: string | null,
  top: TreeNode | null,
  expanded: Set<string>,
  loaded: Map<string, TreeNode[]>,
  out: FlatRow[],
) {
  // The same object may occur twice under one parent (a view a module inserts into a context a
  // second time), so row keys count repeats instead of relying on the id alone.
  const seen = new Map<string, number>()
  for (const node of nodes) {
    const n = seen.get(node.id) ?? 0
    seen.set(node.id, n + 1)
    const key = `${parentKey ?? ''}␟${node.id}${n ? `#${n}` : ''}`
    const rowTop = top ?? node
    out.push({ key, node, depth, parentKey, top: rowTop })
    if (!node.is_leaf && expanded.has(key)) {
      const children = node.lazy ? loaded.get(node.id) : node.children
      if (children) flatten(children, depth + 1, key, rowTop, expanded, loaded, out)
    }
  }
}

function fullText(node: TreeNode): string {
  const parts = [node.label]
  if (node.type_label) parts.push(`[${node.type_label}]`)
  if (node.path) parts.push(node.path)
  if (node.origin && node.kind !== 'module') parts.push(node.origin)
  if (node.overrides?.length) parts.push(`(${node.overrides.join(', ')})`)
  if (node.read_only) parts.push('- read-only')
  return parts.join(' ')
}

export function ProjectTree({
  roots,
  onSelect,
  onOpen,
  loadChildren,
  onContextMenu,
  problemCounts,
  badgeFor,
  gitFor,
  onFileKey,
}: {
  roots: TreeNode[]
  onSelect?: (node: TreeNode, project: TreeNode) => void
  onOpen?: (node: TreeNode, project: TreeNode) => void
  loadChildren?: (node: TreeNode) => Promise<TreeNode[]>
  /** Right click (or the context-menu key) on a row; the row is selected first. */
  onContextMenu?: (node: TreeNode, project: TreeNode, x: number, y: number) => void
  /** Errors and warnings per object (normalised node id); an error shows a red mark on the row. */
  problemCounts?: ReadonlyMap<string, { errors: number; warnings: number }>
  /** Small coloured dot behind the label of a node (the tunnel state of a system); null for none. */
  badgeFor?: (node: TreeNode) => { state: string; title: string } | null
  /** Git state of a node (colour and letter at the end of the row); null when unchanged. */
  gitFor?: (node: TreeNode) => { code: string; title: string } | null
  /** Ctrl+X, Ctrl+C, Ctrl+V and Delete on a file or folder row. */
  onFileKey?: (key: 'cut' | 'copy' | 'paste' | 'delete', node: TreeNode, project: TreeNode) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loaded, setLoaded] = useState<Map<string, TreeNode[]>>(() => new Map())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewHeight, setViewHeight] = useState(FALLBACK_VIEWPORT)
  const viewportRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const knownRoots = useRef<Set<string>>(new Set())
  const focusFromKeyboard = useRef(false)
  const typeahead = useRef({ text: '', at: 0 })
  const scrollFrame = useRef<number | null>(null)

  // Roots arrive asynchronously; each newly seen root opens once, a later manual collapse sticks.
  useEffect(() => {
    const keys = new Set<string>()
    const rootRows: FlatRow[] = []
    flatten(roots, 0, null, null, new Set(), new Map(), rootRows)
    for (const r of rootRows) keys.add(r.key)
    const fresh = [...keys].filter((k) => !knownRoots.current.has(k))
    knownRoots.current = keys
    if (fresh.length === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const k of fresh) next.add(k)
      return next
    })
  }, [roots])

  const rows = useMemo(() => {
    const out: FlatRow[] = []
    flatten(roots, 0, null, null, expanded, loaded, out)
    return out
  }, [roots, expanded, loaded])

  const indexByKey = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])
  const focusedIndex = focusedKey !== null && indexByKey.has(focusedKey) ? indexByKey.get(focusedKey)! : 0

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewHeight(el.clientHeight || FALLBACK_VIEWPORT)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keyboard moves keep the focused row inside the viewport and give it real DOM focus (roving
  // tabindex); mouse clicks must not scroll the tree under the pointer.
  useEffect(() => {
    if (!focusFromKeyboard.current || rows.length === 0) return
    focusFromKeyboard.current = false
    const el = viewportRef.current
    const top = focusedIndex * ROW_HEIGHT
    if (el) {
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_HEIGHT > el.scrollTop + viewHeight) el.scrollTop = top + ROW_HEIGHT - viewHeight
      setScrollTop(el.scrollTop)
    }
    itemRefs.current.get(rows[focusedIndex].key)?.focus()
  }, [focusedIndex, rows, viewHeight])

  const ensureLoaded = useCallback(
    (node: TreeNode) => {
      if (!node.lazy || loaded.has(node.id) || !loadChildren) return
      loadChildren(node)
        .then((children) => setLoaded((prev) => new Map(prev).set(node.id, children)))
        .catch(() => setLoaded((prev) => new Map(prev).set(node.id, [])))
    },
    [loaded, loadChildren],
  )

  const setOpen = useCallback(
    (row: FlatRow, open: boolean) => {
      if (row.node.is_leaf) return
      if (open) ensureLoaded(row.node)
      setExpanded((prev) => {
        if (prev.has(row.key) === open) return prev
        const next = new Set(prev)
        if (open) next.add(row.key)
        else next.delete(row.key)
        return next
      })
    },
    [ensureLoaded],
  )

  function moveTo(index: number) {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))]
    if (!row) return
    focusFromKeyboard.current = true
    setFocusedKey(row.key)
  }

  function select(row: FlatRow) {
    setSelectedKey(row.key)
    onSelect?.(row.node, row.top)
  }

  function open(row: FlatRow) {
    select(row)
    if (isOpenable(row.node)) onOpen?.(row.node, row.top)
    else setOpen(row, !expanded.has(row.key))
  }

  function onTypeahead(char: string, from: number) {
    const now = Date.now()
    const t = typeahead.current
    t.text = now - t.at > TYPEAHEAD_RESET_MS ? char : t.text + char
    t.at = now
    const needle = t.text.toLowerCase()
    // A repeated single letter cycles through the matches, like most native trees.
    const start = t.text.length === 1 ? from + 1 : from
    for (let i = 0; i < rows.length; i++) {
      const idx = (start + i) % rows.length
      if (rows[idx].node.label.toLowerCase().startsWith(needle)) {
        moveTo(idx)
        return
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLLIElement>, index: number) {
    const row = rows[index]
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveTo(index + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        moveTo(index - 1)
        return
      case 'Home':
        e.preventDefault()
        moveTo(0)
        return
      case 'End':
        e.preventDefault()
        moveTo(rows.length - 1)
        return
      case 'ArrowRight':
        e.preventDefault()
        if (!row.node.is_leaf && !expanded.has(row.key)) setOpen(row, true)
        else if (!row.node.is_leaf && rows[index + 1]?.parentKey === row.key) moveTo(index + 1)
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (!row.node.is_leaf && expanded.has(row.key)) setOpen(row, false)
        else if (row.parentKey) moveTo(indexByKey.get(row.parentKey) ?? index)
        return
      case 'Enter':
        e.preventDefault()
        open(row)
        return
      case ' ':
        e.preventDefault()
        select(row)
        return
      case 'Delete':
        if (onFileKey) {
          e.preventDefault()
          onFileKey('delete', row.node, row.top)
        }
        return
      default:
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && onFileKey && ['x', 'c', 'v'].includes(e.key.toLowerCase())) {
          e.preventDefault()
          onFileKey(({ x: 'cut', c: 'copy', v: 'paste' } as const)[e.key.toLowerCase() as 'x' | 'c' | 'v'], row.node, row.top)
          return
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          onTypeahead(e.key, index)
        }
    }
  }

  let first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  let last = Math.min(rows.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN)
  if (first > last) {
    first = 0
    last = -1
  }
  const visible: number[] = []
  for (let i = first; i <= last; i++) visible.push(i)
  if (rows.length > 0 && (focusedIndex < first || focusedIndex > last)) visible.push(focusedIndex)

  return (
    <div className="project-tree-viewport" ref={viewportRef} onScroll={(e) => {
        const el = e.currentTarget
        if (scrollFrame.current !== null) return
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = null
          setScrollTop(el.scrollTop)
        })
      }}>
      <ul role="tree" aria-label="Projects" className="project-tree" style={{ height: rows.length * ROW_HEIGHT }}>
        {visible.map((index) => {
          const row = rows[index]
          const { node } = row
          const isExpanded = expanded.has(row.key)
          const isFocused = index === focusedIndex
          return (
            <li
              key={row.key}
              ref={(el) => {
                if (el) itemRefs.current.set(row.key, el)
                else itemRefs.current.delete(row.key)
              }}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={selectedKey === row.key}
              aria-expanded={node.is_leaf ? undefined : isExpanded}
              aria-readonly={node.read_only ? true : undefined}
              tabIndex={isFocused ? 0 : -1}
              title={fullText(node)}
              data-kind={node.kind ?? (node.object_type ? 'object' : 'folder')}
              data-dimmed={node.dimmed ? 'true' : undefined}
              data-git={gitFor?.(node)?.code}
              data-read-only={node.read_only ? 'true' : undefined}
              style={{ top: index * ROW_HEIGHT, paddingLeft: 4 + row.depth * 16 }}
              onKeyDown={(e) => onKeyDown(e, index)}
              onClick={() => {
                setFocusedKey(row.key)
                select(row)
              }}
              onDoubleClick={() => open(row)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault()
                setFocusedKey(row.key)
                select(row)
                onContextMenu(node, row.top, e.clientX, e.clientY)
              }}
            >
              <span
                className="project-tree-toggle"
                aria-hidden="true"
                onClick={(e) => {
                  if (node.is_leaf) return
                  e.stopPropagation()
                  setFocusedKey(row.key)
                  setOpen(row, !isExpanded)
                }}
              >
                {node.is_leaf ? '' : isExpanded ? '⌄' : '›'}
              </span>
              <span className="project-tree-icon">
                <NodeIcon node={node} expanded={isExpanded} />
              </span>
              <span className={`project-tree-label${node.bold ? ' is-bold' : ''}`}>{node.label}</span>
              {(() => {
                const badge = badgeFor?.(node)
                return badge ? <span className="tunnel-dot" data-state={badge.state} role="img" aria-label={badge.title} title={badge.title} /> : null
              })()}
              {node.type_label ? <span className="project-tree-type is-bold">[{node.type_label}]</span> : null}
              {node.path ? <span className="project-tree-dim">{node.path}</span> : null}
              {node.origin && node.kind !== 'module' ? <span className="project-tree-dim project-tree-origin">{node.origin}</span> : null}
              {node.overrides?.length ? <span className="project-tree-dim">({node.overrides.join(', ')})</span> : null}
              {(() => {
                const g = gitFor?.(node)
                return g ? <span className="git-badge" data-git={g.code} role="img" aria-label={g.title} title={g.title}>{g.code}</span> : null
              })()}
              {(() => {
                const c = problemCounts?.get(normId(node.id))
                if (!c || (c.errors === 0 && c.warnings === 0)) return null
                return (
                  <span
                    className={`project-tree-problem ${c.errors > 0 ? 'is-error' : 'is-warning'}`}
                    role="img"
                    aria-label={c.errors > 0 ? `${c.errors} errors` : `${c.warnings} warnings`}
                    title={`${c.errors} error(s), ${c.warnings} warning(s)`}
                  >
                    {c.errors > 0 ? '●' : '▲'}
                  </span>
                )
              })()}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
