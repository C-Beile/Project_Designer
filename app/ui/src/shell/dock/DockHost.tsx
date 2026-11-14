import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from 'dockview-react'
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
      {panel.header ? (
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
  const title = content.panels[api.id as PanelId]?.tabTitle ?? api.title ?? api.id
  return (
    <div className="forge-dock-tab">
      <span className="forge-dock-tab-title">{title}</span>
      <button type="button" className="forge-panel-btn" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={() => api.close()}>
        {'×'}
      </button>
    </div>
  )
}

function FloatAction({ activePanel }: IDockviewHeaderActionsProps) {
  const content = useContext(ContentContext)!
  const id = activePanel?.id as PanelId | undefined
  if (!id || id === (EDITOR_ID as string) || !content.canFloat(id)) return null
  const title = activePanel?.title ?? id
  return (
    <button type="button" className="forge-panel-btn" aria-label={`Open ${title} in a new window`} title={`Open ${title} in a new window`} onClick={() => content.float(id)}>
      {'⧉'}
    </button>
  )
}

const COMPONENTS = { panel: PanelView }

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
    panel.group.locked = 'no-drop-target'
  }
}

function planFor(api: DockviewApi, uiFactor: number): Placement[] {
  // uiFactor enthält schon den Größenfaktor der Voreinstellung (siehe DockHost).
  return planDock({ panels: allPanels(), areas: layoutConfig.areas, centerId: EDITOR_ID, windowWidth: api.width, windowHeight: api.height, uiFactor })
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
    return !!api.getPanel(EDITOR_ID)
  } catch {
    return false
  }
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
          const place: Placement = neighbor && api.getPanel(neighbor) ? { id: cfg.id, direction: 'within', reference: neighbor } : (planFor(api, uiFactor).find((p) => p.id === cfg.id) ?? { id: cfg.id, direction: 'right' })
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
      api.onDidLayoutChange(() => {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => latest.current.onLayoutChange((prev) => ({ ...prev, dock: api.toJSON() })), SAVE_DELAY_MS)
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
        <DockviewReact className="forge-dockview" components={COMPONENTS} defaultTabComponent={PanelTab} rightHeaderActionsComponent={FloatAction} disableFloatingGroups onReady={onReady} />
      </div>
    </ContentContext.Provider>
  )
}
