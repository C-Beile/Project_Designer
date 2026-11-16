import { pathKey } from '../platform/pathKey'
import { normId } from '../problems/problemStore'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { NodeIcon } from '../tree/treeIcons'
import { TunnelStateIcon } from '../tree/TunnelStateIcon'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { canMoveToWindow } from '../windows/editorWindows'
import type { EditorTab } from './tabModel'
import { Button } from '../core/ui/controls'
import { CaretDown } from '../core/icons/Icon'
import { projectColor } from '../core/projectColor'
import { useTabGrouping, useTabOverflow } from '../theme/appearanceSettings'

function canMove(tab: EditorTab | undefined): boolean {
  return !!tab && canMoveToWindow(tab.node)
}

// Tab strip of the editor area (LAYOUT_SPEC §6). Too many tabs (setting `tabOverflow`): hidden ones in a dropdown
// on the right (the active tab always stays visible), a scrollable bar, or stacked rows.

export function EditorTabBar({
  tabs,
  activeId,
  dirtyIds,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseProject,
  problemCounts,
  badgeFor,
  gitFor,
  onMoveToWindow,
  projects = [],
}: {
  /** Die offenen Projekte. Bei mehreren trägt jeder Reiter oben einen Streifen in der Projektfarbe. */
  projects?: string[]
  /** Moves the tab's document into a window of its own; `at` is the screen position it was dropped at. */
  onMoveToWindow?: (id: string, at?: { x: number; y: number }) => void
  gitFor?: (tab: EditorTab) => { code: string; title: string } | null
  badgeFor?: (tab: EditorTab) => { state: string; title: string } | null
  problemCounts?: ReadonlyMap<string, { errors: number; warnings: number }>
  onCloseOthers?: (id: string) => void
  onCloseAll?: () => void
  /** Schließt alle Reiter eines Projekts. */
  onCloseProject?: (project: string) => void
  tabs: EditorTab[]
  activeId: string | null
  dirtyIds: ReadonlySet<string>
  onActivate: (id: string) => void
  onClose: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const grouped = useTabGrouping() === 'grouped' && projects.length > 1
  // Gruppiert: die Reiter eines Projekts stehen zusammen (Reihenfolge der Projekte, innerhalb davon wie geöffnet).
  const base = useMemo(() => {
    if (!grouped) return tabs
    const rank = (t: EditorTab) => Math.max(0, projects.findIndex((p) => pathKey(p) === pathKey(t.project)))
    return [...tabs].sort((a, b) => rank(a) - rank(b))
  }, [grouped, tabs, projects])
  const overflow = useTabOverflow()
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  // Dropdown: ist der aktive Reiter nicht sichtbar, tauscht er den Platz des letzten sichtbaren.
  const [promote, setPromote] = useState<{ id: string; slot: number } | null>(null)
  const list = useMemo(() => {
    if (overflow !== 'dropdown' || !promote) return base
    const tab = base.find((t) => t.id === promote.id)
    if (!tab) return base
    const rest = base.filter((t) => t !== tab)
    rest.splice(Math.min(promote.slot, rest.length), 0, tab)
    return rest
  }, [base, overflow, promote])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(strip)
    return () => ro.disconnect()
  }, [])

  // Misst nach jedem Zeichnen, welche Reiter rechts über den Rand ragen (nur Dropdown-Modus).
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (overflow !== 'dropdown' || !strip) {
      if (hidden.length > 0) setHidden([])
      if (promote) setPromote(null)
      return
    }
    const limit = strip.getBoundingClientRect().right + 1
    const ids: string[] = []
    strip.querySelectorAll<HTMLElement>('[role="tab"]').forEach((el) => {
      if (el.getBoundingClientRect().right > limit && el.dataset.tabId) ids.push(el.dataset.tabId)
    })
    if (ids.join('|') !== hidden.join('|')) setHidden(ids)
    if (activeId && ids.includes(activeId)) {
      const slot = Math.max(0, list.length - ids.length - 1)
      if (promote?.id !== activeId || promote.slot !== slot) setPromote({ id: activeId, slot })
    } else if (promote && promote.id !== activeId) setPromote(null)
  })
  void tick

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Scroll-Modus: der aktive Reiter rutscht ins Bild; das Mausrad scrollt die Leiste seitwärts.
  useEffect(() => {
    if (overflow !== 'scroll') return
    const el = rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [overflow, activeId, tabs.length])
  useEffect(() => {
    const strip = stripRef.current
    if (overflow !== 'scroll' || !strip) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      strip.scrollLeft += e.deltaY
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [overflow])

  function onKeyDown(e: KeyboardEvent<HTMLElement>, index: number) {
    let target = -1
    if (e.key === 'ArrowRight') target = (index + 1) % list.length
    else if (e.key === 'ArrowLeft') target = (index - 1 + list.length) % list.length
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = list.length - 1
    else if (e.key === 'Delete') {
      e.preventDefault()
      onClose(list[index].id)
      return
    }
    if (target < 0) return
    e.preventDefault()
    onActivate(list[target].id)
    rootRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus()
  }

  if (tabs.length === 0) return null

  return (
    <div className="forge-tabbar" ref={rootRef}>
      {tabMenu ? (
        <TreeContextMenu
          entries={[
            { id: 'close', label: 'Close', enabled: true },
            ...(onMoveToWindow
              ? [{ id: 'moveToWindow', label: 'Move to New Window', enabled: canMove(tabs.find((t) => t.id === tabMenu.id)) }]
              : []),
            { id: 'closeOthers', label: 'Close Other Documents', enabled: tabs.length > 1 && !!onCloseOthers, hint: 'Only one document is open' },
            { id: 'closeAll', label: 'Close All Documents', enabled: !!onCloseAll },
            ...(projects.length > 1 && onCloseProject ? [{ id: 'closeProject', label: 'Close All Documents of This Project', enabled: true }] : []),
          ]}
          x={tabMenu.x}
          y={tabMenu.y}
          onPick={(pick) => {
            if (pick === 'close') onClose(tabMenu.id)
            else if (pick === 'moveToWindow') onMoveToWindow?.(tabMenu.id)
            else if (pick === 'closeOthers') onCloseOthers?.(tabMenu.id)
            else if (pick === 'closeAll') onCloseAll?.()
            else if (pick === 'closeProject') onCloseProject?.(tabs.find((x) => x.id === tabMenu.id)?.project ?? '')
          }}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
      <div ref={stripRef} className={`forge-tabbar-strip is-${overflow}`} role="tablist" aria-label="Open editors">
        {(() => {
          const renderTab = (tab: EditorTab, index: number) => {
          const active = tab.id === activeId
          const dirty = dirtyIds.has(tab.id)
          const color = projects.length > 1 && !grouped ? projectColor(tab.project, projects) : undefined
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={dirty ? `${tab.node.label} (unsaved)` : tab.node.label}
              tabIndex={active ? 0 : -1}
              title={tab.id}
              className={`forge-tab${active ? ' is-active' : ''}${color ? ' has-project' : ''}`}
              style={color ? ({ '--tab-project': color } as CSSProperties) : undefined}
              draggable={!!onMoveToWindow && canMove(tab)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', tab.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={(e) => {
                // Released away from the tab strip: the tab becomes a window of its own at that spot.
                const strip = rootRef.current?.getBoundingClientRect()
                if (!onMoveToWindow || !strip || e.dataTransfer.dropEffect !== 'none') return
                const away = e.clientY < strip.top - 24 || e.clientY > strip.bottom + 24 || e.clientX < strip.left - 24 || e.clientX > strip.right + 24
                if (away) onMoveToWindow(tab.id, { x: Math.max(0, e.screenX - 60), y: Math.max(0, e.screenY - 20) })
              }}
              data-tab-id={tab.id}
              data-git={gitFor?.(tab)?.code}
              onClick={() => onActivate(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(tab.id)
                }
              }}
              onKeyDown={(e) => onKeyDown(e, index)}
              onContextMenu={(e) => {
                e.preventDefault()
                onActivate(tab.id)
                setTabMenu({ id: tab.id, x: e.clientX, y: e.clientY })
              }}
            >
              <NodeIcon node={tab.node} expanded={false} />
              <span className="forge-tab-label">{tab.node.label}</span>
              {(() => {
                const badge = badgeFor?.(tab)
                return badge ? <TunnelStateIcon state={badge.state} title={badge.title} /> : null
              })()}
              {(problemCounts?.get(normId(tab.id))?.errors ?? 0) > 0 ? (
                <span className="forge-tab-error" role="img" aria-label="Has errors" title="This object has errors">
                  ●
                </span>
              ) : null}
              {dirty ? (
                <span className="forge-tab-dirty" role="img" aria-label="Unsaved changes">
                  ●
                </span>
              ) : null}
              <Button variant="bare"

                className="forge-tab-close"
                tabIndex={-1}
                aria-label={`Close ${tab.node.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                ×
              </Button>
            </div>
          )
          }
          if (!grouped) return list.map(renderTab)
          const groups: { project: string; items: { tab: EditorTab; index: number }[] }[] = []
          list.forEach((tab, index) => {
            const last = groups[groups.length - 1]
            if (last && pathKey(last.project) === pathKey(tab.project)) last.items.push({ tab, index })
            else groups.push({ project: tab.project, items: [{ tab, index }] })
          })
          return groups.map((g) => (
            <div key={g.project} className="forge-tabgroup" role="presentation" style={{ '--tab-project': projectColor(g.project, projects) } as CSSProperties}>
              <span
                className="forge-tabgroup-label"
                title={g.project}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const first = g.items[0]?.tab
                  if (first) setTabMenu({ id: first.id, x: e.clientX, y: e.clientY })
                }}
              >
                {g.project.split(/[\\/]/).filter(Boolean).pop() ?? g.project}
              </span>
              <div className="forge-tabgroup-tabs" role="presentation">
                {g.items.map((i) => renderTab(i.tab, i.index))}
              </div>
            </div>
          ))
        })()}
      </div>
      {overflow === 'dropdown' && hidden.length > 0 ? (
        <Button variant="bare" className="forge-tabbar-more" aria-label="Show hidden editors" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
          <CaretDown />
        </Button>
      ) : null}
      {menuOpen && overflow === 'dropdown' && hidden.length > 0 ? (
        <div className="forge-tabbar-menu" role="menu" aria-label="Open editors">
          {list.filter((t) => hidden.includes(t.id)).map((tab) => (
            <Button variant="bare"
              key={tab.id}

              role="menuitemradio"
              aria-checked={tab.id === activeId}
              className={`forge-tabbar-menuitem${tab.id === activeId ? ' is-active' : ''}`}
              onClick={() => {
                onActivate(tab.id)
                setMenuOpen(false)
              }}
            >
              <NodeIcon node={tab.node} expanded={false} />
              <span>
                {tab.node.label}
                {dirtyIds.has(tab.id) ? ' ●' : ''}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
