import { isTauriRuntime } from '../chrome/tauriWindow'
import { limitsConfig } from '../config/limitsConfig'
import { EVENTS, type Geometry, type WindowResultEvent } from './protocol'

// The one place that opens operating-system windows. The Tauri calls sit behind a small backend
// object so the callers (and their tests) never touch Tauri directly, and so a plain browser or the
// test runner can fall back to the embedded dialogs: `osWindowsAvailable()` tells which one applies.

export interface OpenWindowRequest {
  kind: 'float' | 'dialog' | 'editor'
  name: string
  title: string
  width: number
  height: number
  x?: number
  y?: number
  modal?: boolean
  resizable?: boolean
  payload?: unknown
}

export interface WindowBackend {
  available(): boolean
  open(req: OpenWindowRequest): Promise<void>
  payload(kind: 'float' | 'dialog' | 'editor', name: string): Promise<string | null>
  result(kind: 'float' | 'dialog' | 'editor', name: string, result: string | null): Promise<void>
  close(kind: 'float' | 'dialog' | 'editor', name: string): Promise<void>
  emit(event: string, payload: unknown): Promise<void>
  /** Asks before the window closes (unsaved changes); `kind` is `main` or a window kind. */
  closeGuard(kind: 'main' | 'float' | 'dialog' | 'editor', name: string, on: boolean): Promise<void>
  /** Whether a screen point lies inside the main window (an editor window dragged back onto it). */
  mainContains(x: number, y: number): Promise<boolean>
  /** Ends the application once the unsaved changes were dealt with. */
  exitApp(): Promise<void>
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>
}

function isMacOs(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
}

const payloadCache = new Map<string, Promise<string | null>>()

const tauriBackend: WindowBackend = {
  // macOS freezes the app when a second window opens from inside it, so there every dialog and
  // tool window stays embedded in the main window.
  available: () => isTauriRuntime() && !isMacOs(),
  async open(req) {
    const { commands } = await import('../api/bindings')
    // Aktuelle Hintergrundfarbe des Themes: das neue Fenster startet schon in dieser Farbe.
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    const background = /^#[0-9a-f]{6}$/i.test(bg) ? bg : null
    const { maxPopups, maxEditorWindows: maxEditors } = limitsConfig.windows
    try {
      await commands.windowOpen({ ...req, modal: !!req.modal, payload: req.payload === undefined ? null : JSON.stringify(req.payload), background, max_popups: maxPopups, max_editors: maxEditors })
    } catch (e) {
      if (String(e) === 'window-limit') throw new Error(`Too many windows are open (at most ${req.kind === 'editor' ? maxEditors : maxPopups}). Close one first.`)
      throw e
    }
  },
  // Das Backend gibt die Nutzlast nur einmal heraus (`remove`). Im Entwicklungsmodus startet React (StrictMode) jeden
  // Effekt zweimal; der zweite Aufruf bekäme `null` und das Fenster liefe mit leerer Nutzlast (z. B. leerer Projektordner).
  // Darum wird die Antwort je Fenster gemerkt: ein Fenster hat genau eine Nutzlast.
  payload(kind, name) {
    const key = `${kind}:${name}`
    let cached = payloadCache.get(key)
    if (!cached) {
      cached = import('../api/bindings').then(({ commands }) => commands.windowPayload(kind, name))
      payloadCache.set(key, cached)
    }
    return cached
  },
  async result(kind, name, result) {
    const { commands } = await import('../api/bindings')
    await commands.windowResult(kind, name, result)
  },
  async close(kind, name) {
    const { commands } = await import('../api/bindings')
    await commands.windowClose(kind, name)
  },
  async closeGuard(kind, name, on) {
    const { commands } = await import('../api/bindings')
    await commands.windowCloseGuard(kind, name, on)
  },
  async mainContains(x, y) {
    const { commands } = await import('../api/bindings')
    return commands.mainWindowContains(x, y)
  },
  async exitApp() {
    const { commands } = await import('../api/bindings')
    await commands.appExit()
  },
  async emit(event, payload) {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(event, payload)
  },
  async listen(event, handler) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<unknown>(event, (e) => handler(e.payload))
  },
}

let backend: WindowBackend = tauriBackend

export function setWindowBackend(next: WindowBackend | null): void {
  backend = next ?? tauriBackend
}

export function getWindowBackend(): WindowBackend {
  return backend
}

export function osWindowsAvailable(): boolean {
  return backend.available()
}

const openDialogNames = new Set<string>()

/** Dialog windows can open: OS windows exist and fewer than `max-popups` (limits.toml) are open. Otherwise the caller embeds the dialog in the main window. */
/** Noch Platz für ein weiteres Editor-Fenster (`max-editor-windows` in limits.toml)? `open` = Zahl der offenen Editor-Fenster. */
export function osEditorWindowAvailable(open: number): boolean {
  return backend.available() && open < limitsConfig.windows.maxEditorWindows
}

export function osPopupsAvailable(name?: string): boolean {
  return backend.available() && ((name !== undefined && openDialogNames.has(name)) || openDialogNames.size < limitsConfig.windows.maxPopups)
}

/**
 * Opens a dialog as its own window and waits for its result (null when it was cancelled or closed).
 * A modal dialog locks the main window until it is closed.
 */
export async function openDialogWindow<T>(
  name: string,
  title: string,
  size: { width: number; height: number },
  payload: unknown,
  options: { modal?: boolean; resizable?: boolean } = {},
): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    let stop: (() => void) | null = null
    void backend
      .listen(EVENTS.windowResult, (p) => {
        const e = p as WindowResultEvent
        if (e.kind !== 'dialog' || e.name !== name) return
        openDialogNames.delete(name)
        stop?.()
        try {
          resolve(e.result === null ? null : (JSON.parse(e.result) as T))
        } catch {
          resolve(null)
        }
      })
      .then(async (unlisten) => {
        stop = unlisten
        try {
          openDialogNames.add(name)
          await backend.open({ kind: 'dialog', name, title, ...size, modal: options.modal ?? true, resizable: options.resizable, payload })
        } catch (e) {
          openDialogNames.delete(name)
          unlisten()
          reject(e)
        }
      })
      .catch(reject)
  })
}

export function openFloatWindow(view: string, title: string, size: { width: number; height: number }, geometry?: Geometry | null): Promise<void> {
  return backend.open({
    kind: 'float',
    name: view,
    title,
    width: geometry?.w ?? size.width,
    height: geometry?.h ?? size.height,
    x: geometry?.x,
    y: geometry?.y,
    modal: false,
  })
}

export function closeFloatWindow(view: string): Promise<void> {
  return backend.close('float', view)
}
