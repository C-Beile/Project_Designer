import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { IconClose, IconMinimize } from './icons'
import { ErrorBoundary } from '../core/errorHandling'
import { LIMITS, PANEL_TITLES, clamp, type LayoutState, type PanelId } from './layoutState'

// Docking frame of the main window, arranged like the original Designer (LAYOUT_SPEC §3): the
// left column (Projects over Properties) runs the full height; editor and Navigator share the
// top right, Output spans below both. Every divider can be dragged or moved with the arrow keys.

const KEY_STEP = 10
const KEY_STEP_LARGE = 50

export function Splitter({
  orientation,
  label,
  value,
  min,
  max,
  onResize,
}: {
  // 'vertical' = a vertical bar that is dragged sideways.
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  min: number
  max: number
  onResize: (deltaPx: number) => void
}) {
  const last = useRef<number | null>(null)

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    last.current = orientation === 'vertical' ? e.clientX : e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (last.current === null) return
    const pos = orientation === 'vertical' ? e.clientX : e.clientY
    const delta = pos - last.current
    if (delta !== 0) {
      last.current = pos
      onResize(delta)
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    last.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const amount = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const forward = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === back) onResize(-amount)
    else if (e.key === forward) onResize(amount)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`forge-splitter forge-splitter-${orientation}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}

export interface PanelContent {
  // Header content left of the window buttons: a title or a row of register tabs.
  header: ReactNode
  body: ReactNode
  // Accessible name of the tool window, e.g. "Projects" or "Activity_entity - Properties".
  title: string
}

export function PanelFrame({
  id,
  content,
  onClose,
  onMinimize,
  onFloat,
}: {
  id: PanelId
  content: PanelContent
  onClose: () => void
  onMinimize: () => void
  /** Opens the panel in a window of its own; `at` is the screen position where it was dropped. */
  onFloat?: (at?: { x: number; y: number }) => void
}) {
  const name = PANEL_TITLES[id]
  return (
    <section className="forge-panel" data-panel={id} aria-label={content.title} tabIndex={-1}>
      <header
        className="forge-panel-header"
        draggable={!!onFloat}
        onDragEnd={(e) => {
          // Dropped outside the window: the panel becomes a window of its own at that spot.
          if (onFloat && (e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight)) onFloat({ x: e.screenX, y: e.screenY })
        }}
      >
        <div className="forge-panel-header-main">
          <ErrorBoundary compact label={`${name} header`}>
            {content.header}
          </ErrorBoundary>
        </div>
        {onFloat ? (
          <button type="button" className="forge-panel-btn" aria-label={`Open ${name} in a new window`} title={`Open ${name} in a new window (or drag the title out of the Designer)`} onClick={() => onFloat()}>
            {'⧉'}
          </button>
        ) : null}
        <button type="button" className="forge-panel-btn" aria-label={`Close ${name}`} title={`Close ${name}`} onClick={onClose}>
          <IconClose />
        </button>
        <button type="button" className="forge-panel-btn" aria-label={`Minimize ${name}`} title={`Minimize ${name}`} onClick={onMinimize}>
          <IconMinimize />
        </button>
      </header>
      <div className="forge-panel-body">
        <ErrorBoundary compact label={name}>
          {content.body}
        </ErrorBoundary>
      </div>
    </section>
  )
}

function MinimizedStrip({
  side,
  ids,
  onRestore,
}: {
  side: 'left' | 'right' | 'bottom'
  ids: PanelId[]
  onRestore: (id: PanelId) => void
}) {
  if (ids.length === 0) return null
  return (
    <div className={`forge-minimized-strip forge-minimized-${side}`} role="toolbar" aria-label={`Minimized windows ${side}`}>
      {ids.map((id) => (
        <button key={id} type="button" className="forge-minimized-btn" title={`Restore ${PANEL_TITLES[id]}`} onClick={() => onRestore(id)}>
          {PANEL_TITLES[id]}
        </button>
      ))}
    </div>
  )
}

export function DockLayout({
  layout,
  onLayoutChange,
  panels,
  editor,
  onFloat,
}: {
  layout: LayoutState
  onLayoutChange: (update: (prev: LayoutState) => LayoutState) => void
  panels: Record<PanelId, PanelContent>
  editor: ReactNode
  /** Floats a panel; absent or returning false from `canFloat` hides the button. */
  onFloat?: { canFloat: (id: PanelId) => boolean; float: (id: PanelId, at?: { x: number; y: number }) => void }
}) {
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const mode = layout.panels
  const setMode = (id: PanelId, m: 'open' | 'minimized' | 'closed') =>
    onLayoutChange((prev) => ({ ...prev, panels: { ...prev.panels, [id]: m } }))
  const frame = (id: PanelId) => (
    <PanelFrame
      id={id}
      content={panels[id]}
      onClose={() => setMode(id, 'closed')}
      onMinimize={() => setMode(id, 'minimized')}
      onFloat={onFloat?.canFloat(id) ? (at) => onFloat.float(id, at) : undefined}
    />
  )

  const projectsOpen = mode.projects === 'open'
  const propertiesOpen = mode.properties === 'open'
  const leftOpen = projectsOpen || propertiesOpen
  const minimizedLeft = (['projects', 'properties'] as PanelId[]).filter((id) => mode[id] === 'minimized')

  return (
    <div className="forge-dock">
      <MinimizedStrip side="left" ids={minimizedLeft} onRestore={(id) => setMode(id, 'open')} />
      {leftOpen ? (
        <>
          <div className="forge-dock-left" ref={leftColumnRef} style={{ width: layout.leftWidth }}>
            {projectsOpen ? (
              <div className="forge-dock-slot" style={{ flex: propertiesOpen ? `0 0 ${layout.leftSplit * 100}%` : '1 1 auto' }}>
                {frame('projects')}
              </div>
            ) : null}
            {projectsOpen && propertiesOpen ? (
              <Splitter
                orientation="horizontal"
                label="Resize Projects and Properties"
                value={layout.leftSplit * 100}
                min={LIMITS.leftSplit[0] * 100}
                max={LIMITS.leftSplit[1] * 100}
                onResize={(d) => {
                  const h = leftColumnRef.current?.clientHeight || 600
                  onLayoutChange((p) => ({ ...p, leftSplit: clamp(p.leftSplit + d / h, LIMITS.leftSplit) }))
                }}
              />
            ) : null}
            {propertiesOpen ? <div className="forge-dock-slot forge-dock-fill">{frame('properties')}</div> : null}
          </div>
          <Splitter
            orientation="vertical"
            label="Resize left column"
            value={layout.leftWidth}
            min={LIMITS.leftWidth[0]}
            max={LIMITS.leftWidth[1]}
            onResize={(d) => onLayoutChange((p) => ({ ...p, leftWidth: clamp(p.leftWidth + d, LIMITS.leftWidth) }))}
          />
        </>
      ) : null}
      <div className="forge-dock-center">
        <div className="forge-dock-top">
          <main className="forge-editor-area" aria-label="Editor" tabIndex={-1}>
            {editor}
          </main>
          {mode.navigator === 'open' ? (
            <>
              <Splitter
                orientation="vertical"
                label="Resize Navigator"
                value={layout.rightWidth}
                min={LIMITS.rightWidth[0]}
                max={LIMITS.rightWidth[1]}
                onResize={(d) => onLayoutChange((p) => ({ ...p, rightWidth: clamp(p.rightWidth - d, LIMITS.rightWidth) }))}
              />
              <div className="forge-dock-right" style={{ width: layout.rightWidth }}>
                {frame('navigator')}
              </div>
            </>
          ) : null}
          <MinimizedStrip side="right" ids={mode.navigator === 'minimized' ? ['navigator'] : []} onRestore={(id) => setMode(id, 'open')} />
        </div>
        {mode.output === 'open' ? (
          <>
            <Splitter
              orientation="horizontal"
              label="Resize Output"
              value={layout.bottomHeight}
              min={LIMITS.bottomHeight[0]}
              max={LIMITS.bottomHeight[1]}
              onResize={(d) => onLayoutChange((p) => ({ ...p, bottomHeight: clamp(p.bottomHeight - d, LIMITS.bottomHeight) }))}
            />
            <div className="forge-dock-bottom" style={{ height: layout.bottomHeight }}>
              {frame('output')}
            </div>
          </>
        ) : null}
        <MinimizedStrip side="bottom" ids={mode.output === 'minimized' ? ['output'] : []} onRestore={(id) => setMode(id, 'open')} />
      </div>
    </div>
  )
}
