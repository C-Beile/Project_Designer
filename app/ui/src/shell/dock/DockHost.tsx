import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewWillShowOverlayLocationEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import { layoutConfig, type PanelConfig } from '../../config/layoutConfig'
import { registerCommand } from '../../core/plugins/registry'
import { getPanel, getPanels, panelRequests, usePanels } from '../../core/contrib/panels'
import { ErrorBoundary } from '../../core/errorHandling'
import type { LayoutState, PanelId } from '../layoutState'
import { planDock, type Placement } from './dockPlan'

export interface PanelContent {
  /** Kopfzeile über dem Inhalt (z. B. die Reiter von Projects/Services); der Titel steht im Dock-Reiter. */
  header: ReactNode
  /** Die Kopfzeile ersetzt den Titel im Dock-Reiter (eine Zeile statt zwei, z. B. Output). */
  headerInTab?: boolean
  /** Text des Dock-Reiters, wenn er sich mit der Auswahl ändert (z. B. "A_entity - Properties"); sonst der Titel aus layout.toml. */
  tabTitle?: string
  body: ReactNode
  /** Zugänglicher Name des Panels, z. B. "Activity_entity - Properties". */
  title: string
}

interface DockContent {
  panels: Record<PanelId, PanelContent>
  editor: ReactNode
  canFloat: (id: PanelId) => boolean
  float: (id: PanelId, at?: { x: number; y: number }) => void
}

const ContentContext = createContext<DockContent | null>(null)
const EDITOR_ID = 'editor'
const SAVE_DELAY_MS = 400
const RESIZE_STEP_PX = 40
/** Ein Panel, das als Leiste unter oder über den Editor gelegt wird, bekommt so viel der Fensterhöhe (sonst die zuletzt gemerkte Höhe). */
const BAND_SHARE = 0.15
const BAND_SPAN = 0.9
/** Ablegen am Fensterrand: auch ohne Panel an dieser Seite lässt sich dort ein neues andocken (breites Band, große Vorschau). */
const EDGE_DROP = { activationSize: { type: 'pixels', value: 48 }, size: { type: 'percentage', value: 25 } } as const

function PanelView({ api }: IDockviewPanelProps) {
  const content = useContext(ContentContext)!
  if (api.id === EDITOR_ID) {
    return (
      <main className="forge-editor-area" aria-label="Editor" tabIndex={-1}>
        {content.editor}
      </main>
    )
  }
  const extra = getPanel(api.id)
  if (extra) {
    const Extra = extra.component
    return (
      <div className="forge-panel" role="group" data-panel={api.id} aria-label={extra.title} tabIndex={-1}>
        <div className="forge-panel-body">
          <ErrorBoundary compact label={extra.title}>
            <Extra />
          </ErrorBoundary>
        </div>
      </div>
    )
  }
  const panel = content.panels[api.id as PanelId]
  if (!panel) return null // Panel eines Plugins, das sich abgemeldet hat
  return (
    <div className="forge-panel" role="group" data-panel={api.id} aria-label={panel.title} tabIndex={-1}>
      {panel.header && !panel.headerInTab ? (
        <div className="forge-panel-header">
          <ErrorBoundary compact label={`${api.title} header`}>
            {panel.header}
          </ErrorBoundary>
        </div>
      ) : null}
      <div className="forge-panel-body">
        <ErrorBoundary compact label={api.title ?? api.id}>
          {panel.body}
        </ErrorBoundary>
      </div>
    </div>
  )
}

function PanelTab({ api }: IDockviewPanelHeaderProps) {
  const content = useContext(ContentContext)!
  const panel = content.panels[api.id as PanelId]
  const title = panel?.tabTitle ?? api.title ?? api.id
  // Output: die Reiter im Dock-Reiter haben je ein eigenes x, der letzte nimmt das Panel mit.
  const inTab = !!(panel?.headerInTab && panel.header)
  return (
    <div
      className={`forge-dock-tab${inTab ? ' forge-dock-tab-multi' : ''}`}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && !inTab) api.close()
      }}
    >
      {inTab ? (
        <ErrorBoundary compact label={`${title} header`}>
          {panel.header}
        </ErrorBoundary>
      ) : (
        <span className="forge-dock-tab-title">{title}</span>
      )}
      {inTab ? null : (
        <button type="button" className="forge-panel-btn" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={() => api.close()}>
          {'×'}
        </button>
      )}
    </div>
  )
}

const COMPONENTS = { panel: PanelView }

/** Vorschau-Reiter: zeigt beim Ziehen über die Mitte eines Panels oben, dass es als neuer Reiter andockt. */
let ghostTab: HTMLElement | null = null
function clearTabPreview() {
  ghostTab?.remove()
  ghostTab = null
}
function showTabPreview(api: DockviewApi, e: DockviewWillShowOverlayLocationEvent) {
  const dragged = e.getData()
  const title = dragged ? api.getPanel(dragged.panelId ?? '')?.title : undefined
  const bar = e.group?.element.querySelector('.dv-tabs-container')
  const toOtherGroup = !!dragged && dragged.groupId !== e.group?.id
  if (e.position !== 'center' || e.edge || !bar || !title || !toOtherGroup) return clearTabPreview()
  if (ghostTab?.parentElement !== bar) {
    clearTabPreview()
    ghostTab = document.createElement('div')
    ghostTab.className = 'forge-dock-tab forge-dock-tab-ghost'
    ghostTab.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.className = 'forge-dock-tab-title'
    ghostTab.append(label)
    bar.append(ghostTab)
  }
  ghostTab.firstElementChild!.textContent = title
}
if (typeof window !== 'undefined') {
  for (const ev of ['dragend', 'drop', 'pointerup', 'pointercancel']) window.addEventListener(ev, () => window.setTimeout(clearTabPreview, 0), true)
}

function configOf(id: string) {
  return allPanels().find((p) => p.id === id)
}

/** Die Panels aus `layout.toml` und die der Plugins (Register). */
function allPanels(): PanelConfig[] {
  const fromPlugins = getPanels().map((p) => ({ id: p.id, title: p.title, area: p.area, group: p.group, opens: p.opens, closable: true }))
  return [...layoutConfig.panels, ...fromPlugins]
}

function isOpen(layout: LayoutState, cfg: PanelConfig): boolean {
  const mode = (layout.panels as Record<string, string | undefined>)[cfg.id]
  return mode ? mode === 'open' : cfg.opens === 'startup'
}

function placementOptions(api: DockviewApi, place: Placement) {
  const reference = place.reference && api.getPanel(place.reference) ? place.reference : undefined
  const direction = reference ? place.direction : place.direction === 'within' ? 'right' : place.direction
  return {
    position: reference ? { referencePanel: reference, direction } : { direction },
    initialWidth: place.width,
    initialHeight: place.height,
  } as const
}

function addPanel(api: DockviewApi, id: string, place?: Placement) {
  const title = id === EDITOR_ID ? 'Editor' : (configOf(id)?.title ?? id)
  const panel = api.addPanel({ id, component: 'panel', title, renderer: 'always', ...(place ? placementOptions(api, place) : {}) })
  if (id === EDITOR_ID) {
    panel.group.header.hidden = true
    panel.group.locked = true // kein Tab in den Editor, aber Panels lassen sich an seinen Rändern andocken
  }
}

function planFor(api: DockviewApi, uiFactor: number, includeOnDemand = false): Placement[] {
  // uiFactor enthält schon den Größenfaktor der Voreinstellung (siehe DockHost).
  // `includeOnDemand`: Platz für ein Panel, das erst später aufgeht (Output): so, als würde es beim Start offen sein.
  const panels = includeOnDemand ? allPanels().map((p) => ({ ...p, opens: 'startup' as const })) : allPanels()
  return planDock({ panels, areas: layoutConfig.areas, centerId: EDITOR_ID, windowWidth: api.width, windowHeight: api.height, uiFactor })
}

function buildDefault(api: DockviewApi, uiFactor: number) {
  api.clear()
  addPanel(api, EDITOR_ID)
  for (const place of planFor(api, uiFactor)) addPanel(api, place.id, place)
}

function tryRestore(api: DockviewApi, dock: unknown): boolean {
  if (!dock || typeof dock !== 'object') return false
  try {
    api.fromJSON(dock as never)
    const editor = api.getPanel(EDITOR_ID)
    // Ein älter gespeichertes Layout kann den Editor noch als 'no-drop-target' führen.
    if (editor) editor.group.locked = true
    return !!editor
  } catch {
    return false
  }
}

/** Zuletzt bekannte Größe der Gruppe eines einzelnen Panels (je Panel-Id). */
type PanelSizes = Map<string, { width: number; height: number }>

function rememberSizes(api: DockviewApi, sizes: PanelSizes) {
  for (const group of api.groups) {
    if (group.panels.length !== 1 || group.panels[0].id === EDITOR_ID) continue
    const { width, height } = group.api
    if (width > 0 && height > 0) sizes.set(group.panels[0].id, { width, height })
  }
}

/** Panel kam allein in eine neue Gruppe: Leisten über die ganze Breite werden 15 % hoch (oder wie zuletzt), Spalten über die ganze Höhe wieder so breit wie zuletzt. */
function sizeMovedPanel(api: DockviewApi, panelId: string, sizes: PanelSizes) {
  const group = api.getPanel(panelId)?.group
  if (!group || group.panels.length !== 1) return
  const last = sizes.get(panelId)
  if (group.api.width >= api.width * BAND_SPAN) group.api.setSize({ height: Math.round(last?.height ?? api.height * BAND_SHARE) })
  else if (group.api.height >= api.height * BAND_SPAN && last) group.api.setSize({ width: Math.round(last.width) })
}

export interface DockHostProps {
  layout: LayoutState
  onLayoutChange: (update: (prev: LayoutState) => LayoutState) => void
  panels: Record<PanelId, PanelContent>
  editor: ReactNode
  onFloat?: { canFloat: (id: PanelId) => boolean; float: (id: PanelId, at?: { x: number; y: number }) => void }
  /** Schriftgröße / 12, damit Config-Pixel mit der UI-Größe wachsen. */
  uiFactor?: number
}

/** Docking-Fläche des Hauptfensters (dockview): Panels andocken, stapeln, verschieben; die Anordnung steht in `layout.dock`. */
export function DockHost({ layout, onLayoutChange, panels, editor, onFloat, uiFactor: baseFactor = 1 }: DockHostProps) {
  const uiFactor = baseFactor * (layout.scale ?? 1)
  const apiRef = useRef<DockviewApi | null>(null)
  const syncing = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  // `reopen = "last-position"`: ein Panel, das mit anderen im selben Reiterstapel lag, kommt dort wieder hin (solange das Fenster läuft).
  const lastNeighbor = useRef(new Map<string, string>())
  const lastSizes = useRef<PanelSizes>(new Map())
  const latest = useRef({ layout, onLayoutChange })
  latest.current = { layout, onLayoutChange }

  const reconcile = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    syncing.current = true
    try {
      for (const cfg of allPanels()) {
        const open = isOpen(latest.current.layout, cfg)
        const existing = api.getPanel(cfg.id)
        if (open && !existing) {
          const neighbor = layoutConfig.reopen === 'last-position' ? lastNeighbor.current.get(cfg.id) : undefined
          const place: Placement = neighbor && api.getPanel(neighbor) ? { id: cfg.id, direction: 'within', reference: neighbor } : (planFor(api, uiFactor, true).find((p) => p.id === cfg.id) ?? { id: cfg.id, direction: 'right' })
          addPanel(api, cfg.id, place)
        }
        else if (!open && existing) api.removePanel(existing)
      }
    } finally {
      syncing.current = false
    }
  }, [uiFactor])

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api
      apiRef.current = api
      if (!tryRestore(api, latest.current.layout.dock)) buildDefault(api, uiFactor)
      reconcile()
      api.onDidRemovePanel((panel) => {
        if (syncing.current || panel.id === EDITOR_ID) return
        const neighbor = panel.group?.panels.find((p) => p.id !== panel.id && p.id !== EDITOR_ID)?.id
        if (neighbor) lastNeighbor.current.set(panel.id, neighbor)
        else lastNeighbor.current.delete(panel.id)
        latest.current.onLayoutChange((prev) => ({ ...prev, panels: { ...prev.panels, [panel.id]: 'closed' } }))
      })
      rememberSizes(api, lastSizes.current)
      api.onWillShowOverlay((e) => showTabPreview(api, e))
      api.onDidMovePanel((e) => {
        if (e.panel.id === EDITOR_ID || e.to === e.from) return
        window.requestAnimationFrame(() => sizeMovedPanel(api, e.panel.id, lastSizes.current))
      })
      api.onDidLayoutChange(() => {
        window.clearTimeout(saveTimer.current)
        // Erst nach der Pause merken: die 50 % direkt nach dem Andocken sollen die gemerkte Größe nicht überschreiben.
        saveTimer.current = window.setTimeout(() => {
          rememberSizes(api, lastSizes.current)
          latest.current.onLayoutChange((prev) => ({ ...prev, dock: api.toJSON() }))
        }, SAVE_DELAY_MS)
      })
    },
    [reconcile, uiFactor],
  )

  // Größe des aktiven Panels mit Menübefehlen ändern (Alternative zum Ziehen der Trennlinie, WCAG 2.5.7).
  useEffect(() => {
    const resize = (dx: number, dy: number) => {
      const group = apiRef.current?.activeGroup
      if (!group || group.panels.every((p) => p.id === EDITOR_ID)) return
      group.api.setSize({ width: Math.max(0, group.api.width + dx), height: Math.max(0, group.api.height + dy) })
    }
    const offs = [
      registerCommand('window.panel.wider', () => resize(RESIZE_STEP_PX, 0)),
      registerCommand('window.panel.narrower', () => resize(-RESIZE_STEP_PX, 0)),
      registerCommand('window.panel.taller', () => resize(0, RESIZE_STEP_PX)),
      registerCommand('window.panel.shorter', () => resize(0, -RESIZE_STEP_PX)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const registered = usePanels()
  useEffect(() => reconcile(), [layout.panels, reconcile, registered])

  // Window > <Panel eines Plugins>: öffnen oder schließen.
  const request = panelRequests.use()
  useEffect(() => {
    if (!request) return
    const cfg = allPanels().find((p) => p.id === request.id)
    if (!cfg) return
    onLayoutChange((prev) => ({ ...prev, panels: { ...prev.panels, [cfg.id]: isOpen(prev, cfg) ? 'closed' : 'open' } as LayoutState['panels'] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  // Reset, Voreinstellung oder gespeichertes Layout: ein neuer `reset`-Wert baut das Gitter neu (aus `dock`, sonst Standard).
  const lastReset = useRef(layout.reset)
  useEffect(() => {
    const api = apiRef.current
    if (!api || layout.reset === lastReset.current) return
    lastReset.current = layout.reset
    syncing.current = true
    if (!tryRestore(api, latest.current.layout.dock)) buildDefault(api, uiFactor)
    syncing.current = false
    reconcile()
  }, [layout.reset, reconcile, uiFactor])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  return (
    <ContentContext.Provider value={{ panels, editor, canFloat: onFloat?.canFloat ?? (() => false), float: onFloat?.float ?? (() => {}) }}>
      <div className="forge-dock">
        <DockviewReact className="forge-dockview" components={COMPONENTS} defaultTabComponent={PanelTab} disableFloatingGroups dndEdges={EDGE_DROP} onReady={onReady} />
      </div>
    </ContentContext.Provider>
  )
}
