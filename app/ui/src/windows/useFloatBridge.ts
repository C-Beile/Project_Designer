import { pathKey } from '../platform/pathKey'
import { useCallback, useEffect, useRef, useState } from 'react'
import { forgetFloating, loadFloating, rememberFloating } from './floatStore'
import { EVENTS, FLOAT_SIZES, FLOAT_TITLES, FLOAT_VIEWS, isFloatView, type FloatAction, type FloatView, type Geometry, type MainState, type WindowResultEvent } from './protocol'
import { closeFloatWindow, getWindowBackend, openFloatWindow, osWindowsAvailable } from './windowService'
import { errorText } from '../core/errorText'

// Main-window side of the floating panels: which views float, the state they draw from, the
// actions they send back, and the arrangement per project. Panels that float are removed from the
// dock; closing the window or its Dock button brings them back.

export function useFloatBridge({ root, state, onAction, onError }: { root: string; state: MainState; onAction: (action: FloatAction) => void; onError: (message: string) => void }) {
  const [floating, setFloating] = useState<FloatView[]>([])
  const stateRef = useRef(state)
  stateRef.current = state
  const actionRef = useRef(onAction)
  actionRef.current = onAction
  const errorRef = useRef(onError)
  errorRef.current = onError
  const rootRef = useRef(root)
  rootRef.current = root
  const geometryTimers = useRef(new Map<string, number>())

  useEffect(() => {
    if (!osWindowsAvailable()) return
    const backend = getWindowBackend()
    const unsubs: (() => void)[] = []
    let dead = false
    const add = (p: Promise<() => void>) =>
      void p.then((u) => {
        if (dead) u()
        else unsubs.push(u)
      })
    add(
      backend.listen(EVENTS.windowResult, (p) => {
        const e = p as WindowResultEvent
        if (e.kind !== 'float' || !isFloatView(e.name)) return
        setFloating((f) => f.filter((v) => v !== e.name))
        forgetFloating(rootRef.current, e.name)
      }),
    )
    add(
      backend.listen(EVENTS.windowGeometry, (p) => {
        const { name, geometry } = p as { name: string; geometry: Geometry }
        if (!isFloatView(name)) return
        window.clearTimeout(geometryTimers.current.get(name))
        geometryTimers.current.set(
          name,
          window.setTimeout(() => rememberFloating(rootRef.current, name, geometry), 400),
        )
      }),
    )
    add(backend.listen(EVENTS.floatReady, () => void backend.emit(EVENTS.mainState, stateRef.current)))
    add(backend.listen(EVENTS.floatAction, (p) => actionRef.current(p as FloatAction)))
    return () => {
      dead = true
      unsubs.forEach((u) => u())
      for (const t of geometryTimers.current.values()) window.clearTimeout(t)
    }
  }, [])

  // Floating windows follow the main window's selection and versions.
  useEffect(() => {
    if (floating.length === 0 || !osWindowsAvailable()) return
    const t = window.setTimeout(() => void getWindowBackend().emit(EVENTS.mainState, state), 30)
    return () => window.clearTimeout(t)
  }, [floating, state])

  const floatView = useCallback(async (view: FloatView, geometry?: Geometry | null) => {
    if (!osWindowsAvailable()) return
    setFloating((f) => (f.includes(view) ? f : [...f, view]))
    rememberFloating(rootRef.current, view, geometry ?? null)
    try {
      await openFloatWindow(view, FLOAT_TITLES[view], FLOAT_SIZES[view], geometry)
    } catch (e) {
      setFloating((f) => f.filter((v) => v !== view))
      forgetFloating(rootRef.current, view)
      errorRef.current(errorText(e))
    }
  }, [])

  const dockView = useCallback(async (view: FloatView) => {
    setFloating((f) => f.filter((v) => v !== view))
    forgetFloating(rootRef.current, view)
    try {
      await closeFloatWindow(view)
    } catch {
      // The window was already gone.
    }
  }, [])

  const dockAll = useCallback(async () => {
    for (const v of FLOAT_VIEWS) await dockView(v)
  }, [dockView])

  // A project comes back with the panels that floated the last time it was open.
  const restored = useRef(new Set<string>())
  useEffect(() => {
    if (!root.trim() || !osWindowsAvailable()) return
    const key = pathKey(root)
    if (restored.current.has(key)) return
    restored.current.add(key)
    const saved = loadFloating(root)
    for (const view of FLOAT_VIEWS) if (view in saved) void floatView(view, saved[view] ?? null)
  }, [root, floatView])

  return { floating, floatView, dockView, dockAll }
}
