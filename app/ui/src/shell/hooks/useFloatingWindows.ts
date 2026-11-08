import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { notify } from '../../core/notifications'
import { refreshScm } from '../../features/git'
import { normId } from '../../problems/problemStore'
import { codeTabNode } from '../../properties/codeSave'
import { objectRoot } from '../../properties/objectRoot'
import { findObject } from '../../core/treeIndex'
import type { DiffTarget, TreeNode, WireValue } from '../../wire/types'
import type { useEditorWindows } from '../../windows/useEditorWindows'
import { useFloatBridge } from '../../windows/useFloatBridge'
import { EVENTS, type FloatAction, type FloatView, type Geometry, type MainState } from '../../windows/protocol'
import { getWindowBackend } from '../../windows/windowService'
import type { AliasConfigDto } from '../../wire/types'
import type { LayoutState } from '../layoutState'
import type { OutputLine, OutputSubTab } from '../OutputPanel'
import { baseName, findNodeByPath, nodeKind, originLabel } from '../shellHelpers'
import type { CommandMap } from './commandTypes'
import type { NavSelection } from './useNavElements'

export interface FloatingDeps {
  api: ForgeApi
  root: string
  tree: TreeNode[]
  treeRef: MutableRefObject<TreeNode[]>
  selectedId: string | null
  handleOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
  openDiff: (target: DiffTarget) => void
  openSql: (sql: string) => void
  markUnsaved: (nodeId: string, dirty: boolean) => void
  refreshDiagnostics: (nodeId: string) => void
  resetNavRef: MutableRefObject<(path: string, label: string) => Promise<void>>
  activateNavRef: MutableRefObject<(path: string, label: string) => Promise<void>>
  editorWindowsRef: MutableRefObject<ReturnType<typeof useEditorWindows> | null>
  setNavSel: (sel: NavSelection) => void
  setAliasSel: (sel: { config: AliasConfigDto; system: string } | null) => void
  setTreeSelection: (node: TreeNode | null) => void
  setValue: (v: WireValue | null) => void
  setSheetVersion: Dispatch<SetStateAction<number>>
  setCanUndo: (v: boolean) => void
  setStatus: (text: string) => void
  setReloadToken: (update: (t: number) => number) => void
  // Zustand, aus dem die schwebenden Panels zeichnen
  inspected: TreeNode | null
  inspectedKind: ReturnType<typeof nodeKind> | null
  inspectedObject: TreeNode | null
  focusLabel: string | null
  elementSel: NavSelection
  sheetVersion: number
  objectsByType: ReadonlyMap<string, ReadonlySet<string>>
  layout: LayoutState
  projectsTab: 'projects' | 'services'
  setProjectsTab: (tab: 'projects' | 'services') => void
  logs: Record<OutputSubTab, OutputLine[]>
}

// Panels in windows of their own: what they draw from, and what they send back.
export function useFloatingWindows(d: FloatingDeps) {
  const { api, root, tree, treeRef, selectedId, handleOpen, openDiff, openSql, markUnsaved, refreshDiagnostics, resetNavRef, activateNavRef, editorWindowsRef } = d
  const { setNavSel, setAliasSel, setTreeSelection, setValue, setSheetVersion, setCanUndo, setStatus, setReloadToken } = d
  const { inspected, inspectedKind, inspectedObject, focusLabel, elementSel, sheetVersion, objectsByType, layout, projectsTab, setProjectsTab, logs } = d
  const [floatingViews, setFloatingViews] = useState<string[]>([])
  const floatApiRef = useRef<{ floating: FloatView[]; floatView: (v: FloatView, g?: Geometry | null) => Promise<void>; dockView: (v: FloatView) => Promise<void>; dockAll: () => Promise<void> } | null>(null)

  const propsFloating = floatingViews.includes('properties')
  const objectsRecord = useMemo(
    () => (propsFloating ? Object.fromEntries([...objectsByType.entries()].map(([type, names]) => [type, [...names]])) : {}),
    [objectsByType, propsFloating],
  )
  const mainState = useMemo<MainState>(
    () => ({
      root,
      kind: !inspected ? 'none' : inspectedKind === 'project' || inspectedKind === 'module' ? inspectedKind : inspectedObject ? 'object' : 'none',
      objectId: inspectedObject?.id ?? null,
      objectType: inspectedObject?.object_type ?? null,
      origin: inspectedObject ? originLabel(inspectedObject) : '',
      title: focusLabel ?? '',
      projectName: inspected ? (inspected.type_label ?? inspected.label) : '',
      projectPath: inspected ? (inspected.path ?? inspected.id) : '',
      linkedRoot: inspectedObject ? objectRoot(inspectedObject.id) : '',
      readOnlyHint: '',
      selectedPath: elementSel?.path ?? null,
      version: sheetVersion,
      objectsByType: objectsRecord,
    }),
    [root, inspected, inspectedKind, inspectedObject, focusLabel, elementSel, sheetVersion, objectsRecord],
  )

  const onFloatAction = useCallback(
    (a: FloatAction) => {
      switch (a.type) {
        case 'navSelect':
          setNavSel(a.path === '$' ? null : { nodeId: a.nodeId, path: a.path, label: a.label })
          return
        case 'navReset':
          void resetNavRef.current(a.path, a.label)
          return
        case 'navActivate':
          void activateNavRef.current(a.path, a.label)
          return
        case 'edited':
          void api.getPropertyTree(a.nodeId).then((v) => {
            if (a.nodeId === selectedId) setValue(v)
            setSheetVersion((x) => x + 1)
            setCanUndo(true)
            markUnsaved(a.nodeId, true)
            refreshDiagnostics(a.nodeId)
          })
          return
        case 'status':
          setStatus(a.text)
          return
        case 'goTo': {
          const target = findObject(tree, a.objectType, a.name)
          if (target) void handleOpen(target)
          else setStatus(`${a.name} not found in the open projects.`)
          return
        }
        case 'openCode':
          void handleOpen(codeTabNode(a.code, false))
          return
        case 'openFile':
          void handleOpen({ id: a.path, label: baseName(a.path), object_type: null, kind: 'file', is_leaf: true, children: [] })
          return
        case 'modificationChanged':
        case 'reload':
          setReloadToken((t) => t + 1)
          return
        case 'openDiff':
          openDiff(a.target)
          return
        case 'openSql':
          openSql(a.sql)
          return
        case 'scmChanged':
          if (root.trim()) void refreshScm(api, root)
          return
        case 'editorDirty':
          markUnsaved(a.id, a.dirty)
          return
        case 'editorSaved':
          editorWindowsRef.current?.saved(a.id, a.ok)
          return
        case 'inspect': {
          const target = findNodeByPath(treeRef.current, normId(a.nodeId))
          setAliasSel(null)
          if (target) setTreeSelection(target)
          setNavSel(a.path === '$' ? null : { nodeId: a.nodeId, path: a.path, label: a.label })
          return
        }
      }
    },
    [api, root, selectedId, tree, handleOpen, openDiff, openSql, markUnsaved, refreshDiagnostics],
  )
  const bridge = useFloatBridge({ root, state: mainState, onAction: onFloatAction, onError: (m) => notify(m, { kind: 'error', timeoutMs: 10000 }) })
  floatApiRef.current = bridge
  useEffect(() => setFloatingViews(bridge.floating), [bridge.floating])
  useEffect(() => {
    if (bridge.floating.includes(projectsTab as FloatView)) setProjectsTab('projects')
  }, [bridge.floating, projectsTab])
  // The floating Output window gets the log lines of the main window.
  useEffect(() => {
    if (!bridge.floating.includes('output')) return
    const t = window.setTimeout(() => void getWindowBackend().emit(EVENTS.outputLines, logs), 100)
    return () => window.clearTimeout(t)
  }, [bridge.floating, logs])
  const effectiveLayout = useMemo(
    () => ({
      ...layout,
      panels: {
        ...layout.panels,
        navigator: bridge.floating.includes('navigator') ? ('closed' as const) : layout.panels.navigator,
        properties: bridge.floating.includes('properties') ? ('closed' as const) : layout.panels.properties,
        output: bridge.floating.includes('output') ? ('closed' as const) : layout.panels.output,
      },
    }),
    [layout, bridge.floating],
  )

  const commands: CommandMap = {
    'window.float': async (arg) => {
      const v = arg as FloatView
      const f = floatApiRef.current
      if (!f) return
      if (f.floating.includes(v)) await f.dockView(v)
      else await f.floatView(v)
    },
    'window.dockAll': async () => {
      await floatApiRef.current?.dockAll()
    },
  }

  return { bridge, floatingViews, effectiveLayout, commands }
}
