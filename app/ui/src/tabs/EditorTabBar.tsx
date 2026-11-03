import { normId } from '../problems/problemStore'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { NodeIcon } from '../tree/treeIcons'
import { TunnelStateIcon } from '../tree/TunnelStateIcon'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import { canMoveToWindow } from '../windows/editorWindows'
import type { EditorTab } from './tabModel'

function canMove(tab: EditorTab | undefined): boolean {
  return !!tab && canMoveToWindow(tab.node)
}

// Tab strip of the editor area (LAYOUT_SPEC §6): one row only; what does not fit is reached
// through the overflow menu that lists every open tab.

export function EditorTabBar({
  tabs,
  activeId,
  dirtyIds,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  problemCounts,
  badgeFor,
  gitFor,
  onMoveToWindow,
}: {
  /** Moves the tab's document into a window of its own; `at` is the screen position it was dropped at. */
  onMoveToWindow?: (id: string, at?: { x: number; y: number }) => void
  gitFor?: (tab: EditorTab) => { code: string; title: string } | null
  badgeFor?: (tab: EditorTab) => { state: string; title: string } | null
  problemCounts?: ReadonlyMap<string, { errors: number; warnings: number }>
  onCloseOthers?: (id: string) => void
  onCloseAll?: () => void
  tabs: EditorTab[]
  activeId: string | null
  dirtyIds: ReadonlySet<string>
  onActivate: (id: string) => void
  onClose: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

  function onKeyDown(e: KeyboardEvent<HTMLElement>, index: number) {
    let target = -1
    if (e.key === 'ArrowRight') target = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') target = 0
    else if (e.key === 'End') target = tabs.length - 1
    else if (e.key === 'Delete') {
      e.preventDefault()
      onClose(tabs[index].id)
      return
    }
    if (target < 0) return
    e.preventDefault()
    onActivate(tabs[target].id)
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
          ]}
          x={tabMenu.x}
          y={tabMenu.y}
          onPick={(pick) => {
            if (pick === 'close') onClose(tabMenu.id)
            else if (pick === 'moveToWindow') onMoveToWindow?.(tabMenu.id)
            else if (pick === 'closeOthers') onCloseOthers?.(tabMenu.id)
            else if (pick === 'closeAll') onCloseAll?.()
          }}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
      <div className="forge-tabbar-strip" role="tablist" aria-label="Open editors">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId
          const dirty = dirtyIds.has(tab.id)
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={dirty ? `${tab.node.label} (unsaved)` : tab.node.label}
              tabIndex={active ? 0 : -1}
              title={tab.id}
              className={`forge-tab${active ? ' is-active' : ''}`}
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
              <button
                type="button"
                className="forge-tab-close"
                tabIndex={-1}
                aria-label={`Close ${tab.node.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="forge-tabbar-more"
        aria-label="Show all open editors"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        ▾
      </button>
      {menuOpen ? (
        <div className="forge-tabbar-menu" role="menu" aria-label="Open editors">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
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
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
