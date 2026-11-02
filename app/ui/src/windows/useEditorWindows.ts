import { useCallback, useEffect, useRef, useState } from 'react'
import { pathKey } from '../platform/pathKey'
import type { EditorTab, SubTab } from '../tabs/tabModel'
import type { TreeNode } from '../wire/types'
import { canMoveToWindow, editorWindowName, forgetEditorWindow, loadEditorWindows, rememberEditorWindow } from './editorWindows'
import { EVENTS, type EditorCommand, type EditorDockResult, type EditorWindowPayload, type Geometry, type WindowResultEvent } from './protocol'
import { getWindowBackend, osWindowsAvailable } from './windowService'

// Main-window side of the editors that live in windows of their own: which documents moved out,
// where their windows are, bringing them back, and asking them to save. A document is open in one
// window only: its tab leaves the main window while the editor window exists, and opening it
// again just focuses that window.

export interface DetachedEditor {
  name: string
  node: TreeNode
  project: string
  sub: SubTab
}

export const EDITOR_WINDOW_SIZE = { width: 920, height: 660 }

interface Options {
  root: string
  projectLabel: (project: string) => string
  isDirty: (id: string) => boolean
  /** Makes the tab ready to leave: applies pending text, saves a file draft. False: stay. */
  prepareMove: (tab: EditorTab) => Promise<boolean>
  removeTab: (id: string) => void
  restoreTab: (node: TreeNode, project: string, sub: SubTab) => void
  onError: (message: string) => void
  onStatus: (message: string) => void
}

export function useEditorWindows(options: Options) {
  const [detached, setDetached] = useState<Record<string, DetachedEditor>>({})
  const detachedRef = useRef(detached)
  detachedRef.current = detached
  const optionsRef = useRef(options)
  optionsRef.current = options
  const geometryTimers = useRef(new Map<string, number>())
  const saveWaiters = useRef(new Map<string, (ok: boolean) => void>())

  const byName = (name: string): DetachedEditor | undefined => Object.values(detachedRef.current).find((d) => d.name === name)

  const drop = useCallback((id: string) => {
    setDetached((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _gone, ...rest } = prev
      detachedRef.current = rest
      return rest
    })
  }, [])

  const openWindow = useCallback(async (entry: DetachedEditor, dirty: boolean, geometry: Geometry | null, at?: { x: number; y: number }) => {
    const payload: EditorWindowPayload = { node: entry.node, project: entry.project, sub: entry.sub, dirty }
    await getWindowBackend().open({
      kind: 'editor',
      name: entry.name,
      title: `${entry.node.label} - ${optionsRef.current.projectLabel(entry.project)}`,
      width: geometry?.w ?? EDITOR_WINDOW_SIZE.width,
      height: geometry?.h ?? EDITOR_WINDOW_SIZE.height,
      x: geometry?.x ?? at?.x,
      y: geometry?.y ?? at?.y,
      modal: false,
      payload,
    })
  }, [])

  const moveToWindow = useCallback(
    async (tab: EditorTab, at?: { x: number; y: number }): Promise<boolean> => {
      const o = optionsRef.current
      if (!osWindowsAvailable()) return false
      if (!canMoveToWindow(tab.node)) {
        o.onStatus('This tab cannot be moved into a window of its own.')
        return false
      }
      if (detachedRef.current[tab.id]) return true
      if (!(await o.prepareMove(tab))) return false
      const entry: DetachedEditor = { name: editorWindowName(tab.id), node: tab.node, project: tab.project, sub: tab.sub }
      setDetached((prev) => {
        const next = { ...prev, [tab.id]: entry }
        detachedRef.current = next
        return next
      })
      optionsRef.current.removeTab(tab.id)
      try {
        await openWindow(entry, o.isDirty(tab.id), null, at)
        rememberEditorWindow(tab.project, { node: tab.node, sub: tab.sub, geometry: null })
        return true
      } catch (e) {
        drop(tab.id)
        o.restoreTab(tab.node, tab.project, tab.sub)
        o.onError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [drop, openWindow],
  )

  const dock = useCallback(
    (id: string, sub?: SubTab) => {
      const entry = detachedRef.current[id]
      if (!entry) return
      drop(id)
      forgetEditorWindow(entry.project, id)
      optionsRef.current.restoreTab(entry.node, entry.project, sub ?? entry.sub)
    },
    [drop],
  )

  // The menu and the toolbar ask the window itself, so it can first deal with unsaved text.
  const requestDock = useCallback((id: string) => {
    const command: EditorCommand = { type: 'dock', id }
    void getWindowBackend().emit(EVENTS.editorCommand, command)
  }, [])

  const focus = useCallback(async (id: string) => {
    const entry = detachedRef.current[id]
    if (!entry) return
    await getWindowBackend().open({ kind: 'editor', name: entry.name, title: entry.node.label, ...EDITOR_WINDOW_SIZE, modal: false })
  }, [])

  // Closes the window without any question: the document was deleted or its project closed.
  const closeFor = useCallback(
    async (id: string) => {
      const entry = detachedRef.current[id]
      if (!entry) return
      drop(id)
      forgetEditorWindow(entry.project, id)
      await getWindowBackend().close('editor', entry.name).catch(() => {})
    },
    [drop],
  )

  const refresh = useCallback((id: string) => {
    if (!detachedRef.current[id]) return
    const command: EditorCommand = { type: 'refresh', id }
    void getWindowBackend().emit(EVENTS.editorCommand, command)
  }, [])

  /** Asks the editor window to save its document; resolves with the outcome. */
  const saveDetached = useCallback((id: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        saveWaiters.current.delete(id)
        resolve(false)
      }, 20000)
      saveWaiters.current.set(id, (ok) => {
        window.clearTimeout(timer)
        resolve(ok)
      })
      const command: EditorCommand = { type: 'save', id }
      void getWindowBackend().emit(EVENTS.editorCommand, command)
    })
  }, [])

  const saved = useCallback((id: string, ok: boolean) => {
    const waiter = saveWaiters.current.get(id)
    saveWaiters.current.delete(id)
    waiter?.(ok)
  }, [])

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
        if (e.kind !== 'editor') return
        const entry = byName(e.name)
        if (!entry) return
        const id = entry.node.id
        if (e.result === null) {
          drop(id)
          forgetEditorWindow(entry.project, id)
          return
        }
        try {
          const result = JSON.parse(e.result) as EditorDockResult
          dock(id, result.sub)
        } catch {
          dock(id)
        }
      }),
    )
    add(
      backend.listen(EVENTS.windowGeometry, (p) => {
        const { kind, name, geometry } = p as { kind?: string; name: string; geometry: Geometry }
        if (kind !== 'editor') return
        const entry = byName(name)
        if (!entry) return
        window.clearTimeout(geometryTimers.current.get(name))
        geometryTimers.current.set(
          name,
          window.setTimeout(() => rememberEditorWindow(entry.project, { node: entry.node, sub: entry.sub, geometry }), 400),
        )
      }),
    )
    return () => {
      dead = true
      unsubs.forEach((u) => u())
      for (const t of geometryTimers.current.values()) window.clearTimeout(t)
    }
    // The listeners read the current windows through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop, dock])

  // A project comes back with the editor windows it had the last time it was open.
  const restored = useRef(new Set<string>())
  const { root } = options
  const ready = options.root.trim() !== ''
  useEffect(() => {
    if (!ready || !osWindowsAvailable()) return
    const key = pathKey(root)
    if (restored.current.has(key)) return
    restored.current.add(key)
    for (const saved of loadEditorWindows(root)) {
      const entry: DetachedEditor = { name: editorWindowName(saved.node.id), node: saved.node, project: root, sub: saved.sub }
      if (detachedRef.current[saved.node.id]) continue
      setDetached((prev) => {
        const next = { ...prev, [saved.node.id]: entry }
        detachedRef.current = next
        return next
      })
      void openWindow(entry, optionsRef.current.isDirty(saved.node.id), saved.geometry).catch(() => {
        drop(saved.node.id)
        forgetEditorWindow(root, saved.node.id)
      })
    }
  }, [root, ready, openWindow, drop])

  return { detached, detachedRef, moveToWindow, dock, requestDock, focus, closeFor, refresh, saveDetached, saved }
}
