import { getOptions, saveOptions } from './options'

// Zoom: Ctrl + plus/minus/0 and Ctrl + mouse wheel change the editor text size (stored in the
// editor options, so the Options dialog shows the same value); Ctrl + Shift + plus/minus/0 scale
// the whole interface. The interface zoom is kept per user and applies to every window.

export const EDITOR_FONT_MIN = 9
export const EDITOR_FONT_MAX = 28
export const UI_ZOOM_MIN = 0.5
export const UI_ZOOM_MAX = 2
export const UI_ZOOM_KEY = 'forge.uiZoom.v1'

export const clampFont = (n: number) => Math.max(EDITOR_FONT_MIN, Math.min(EDITOR_FONT_MAX, Math.round(n)))
export const clampZoom = (z: number) => Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, Math.round(z * 10) / 10))

/** Changes the editor font size by `delta` steps; `null` resets to the default. */
export function stepEditorFont(delta: number | null): number {
  const options = getOptions()
  const next = delta === null ? 13 : clampFont(options.editor.fontSize + delta)
  if (next !== options.editor.fontSize) saveOptions({ ...options, editor: { ...options.editor, fontSize: next } })
  return next
}

export function loadUiZoom(): number {
  try {
    const raw = Number(window.localStorage.getItem(UI_ZOOM_KEY))
    return raw > 0 ? clampZoom(raw) : 1
  } catch {
    return 1
  }
}

async function applyWebviewZoom(zoom: number): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview().setZoom(zoom)
  } catch {
    // Outside Tauri (browser dev mode, tests) the CSS zoom of the page is the fallback.
    document.documentElement.style.setProperty('zoom', String(zoom))
  }
}

/** Changes the zoom of the whole interface by `delta` steps of 10 %; `null` resets it to 100 %. */
export function stepUiZoom(delta: number | null): number {
  const next = delta === null ? 1 : clampZoom(loadUiZoom() + delta * 0.1)
  try {
    window.localStorage.setItem(UI_ZOOM_KEY, String(next))
  } catch {
    // the zoom still applies for this session
  }
  void applyWebviewZoom(next)
  return next
}

export function setUiZoom(value: number): number {
  const next = clampZoom(value)
  try {
    window.localStorage.setItem(UI_ZOOM_KEY, String(next))
  } catch {
    // the zoom still applies for this session
  }
  void applyWebviewZoom(next)
  return next
}

type Step = number | null

/** Which zoom a key press asks for, if any. */
export function zoomKeyAction(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): { target: 'editor' | 'ui'; step: Step } | null {
  if ((!e.ctrlKey && !e.metaKey) || e.altKey) return null
  const target = e.shiftKey ? 'ui' : 'editor'
  if (['+', '=', 'Add'].includes(e.key)) return { target, step: 1 }
  if (['-', '_', 'Subtract'].includes(e.key)) return { target, step: -1 }
  if (e.key === '0' || e.key === 'Insert') return { target, step: null }
  return null
}

/** Installs the keys and the Ctrl + wheel gesture for one window. Returns the cleanup. */
export function installZoomControls(): () => void {
  void applyWebviewZoom(loadUiZoom())
  const onKey = (e: KeyboardEvent) => {
    const action = zoomKeyAction(e)
    if (!action) return
    e.preventDefault()
    if (action.target === 'ui') stepUiZoom(action.step)
    else stepEditorFont(action.step)
  }
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey || e.deltaY === 0) return
    e.preventDefault()
    const step = e.deltaY < 0 ? 1 : -1
    if (e.shiftKey) stepUiZoom(step)
    else stepEditorFont(step)
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('wheel', onWheel, true)
  }
}
