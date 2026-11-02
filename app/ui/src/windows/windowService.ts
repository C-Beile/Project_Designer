import { isTauriRuntime } from '../chrome/tauriWindow'
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

const tauriBackend: WindowBackend = {
  available: () => isTauriRuntime(),
  async open(req) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('window_open', { req: { ...req, modal: !!req.modal, payload: req.payload === undefined ? null : JSON.stringify(req.payload) } })
  },
  async payload(kind, name) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string | null>('window_payload', { kind, name })
  },
  async result(kind, name, result) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('window_result', { kind, name, result })
  },
  async close(kind, name) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('window_close', { kind, name })
  },
  async closeGuard(kind, name, on) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('window_close_guard', { kind, name, on })
  },
  async mainContains(x, y) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<boolean>('main_window_contains', { x, y })
  },
  async exitApp() {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('app_exit')
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
          await backend.open({ kind: 'dialog', name, title, ...size, modal: options.modal ?? true, resizable: options.resizable, payload })
        } catch (e) {
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
