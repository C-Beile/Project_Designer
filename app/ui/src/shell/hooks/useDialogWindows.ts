import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { errorText } from '../../core/errorText'
import { findObject } from '../../core/treeIndex'
import { notify } from '../../core/notifications'
import { reloadPluginPrefs } from '../../settings/plugins'
import { reloadOptions } from '../../settings/options'
import { reloadCustomThemes } from '../../theme/customThemes'
import { reloadColorOverrides } from '../../theme/colorOverrides'
import { reloadEditorPrefs } from '../../theme/editorPrefs'
import type { ThemeName } from '../../theme/useTheme'
import type { TranspilerEngineId } from '../../settings/transpilerEngine'
import type { TreeNode } from '../../wire/types'
import type { OptionsWindowResult } from '../../windows/DialogWindowApp'
import { useOsDialog } from '../../windows/useOsDialog'
import { openDialogWindow, osWindowsAvailable } from '../../windows/windowService'
import type { MenuDef, MenuItemDef } from '../menuModel'
import type { KeymapEntry } from '../OptionsDialog'
import type { ShellDialog } from './dialogTypes'

export function keymapEntries(menus: MenuDef[]): KeymapEntry[] {
  const out: KeymapEntry[] = []
  const walk = (group: string, items: MenuItemDef[]) => {
    for (const i of items) {
      if (i.children) walk(group, i.children)
      if (i.kind === 'item' && i.shortcut) out.push({ group, label: i.label.replace(/…$/, ''), shortcut: i.shortcut })
    }
  }
  for (const m of menus) walk(m.label, m.items)
  return out
}

export interface DialogWindowsDeps {
  dialog: ShellDialog
  setDialog: Dispatch<SetStateAction<ShellDialog>>
  hasProject: boolean
  root: string
  engine: TranspilerEngineId
  setEngine: (e: TranspilerEngineId) => void
  theme: ThemeName
  toggleTheme: (t: ThemeName) => void
  menus: MenuDef[]
  setInstallDir: (dir: string | null) => void
  openableModels: { type: string; name: string }[]
  tree: TreeNode[]
  handleOpen: (node: TreeNode) => Promise<void>
  setStatus: (text: string) => void
}

// Dialoge des Hauptfensters, die als Fenster des Betriebssystems aufgehen (modal).
export function useDialogWindows({ dialog, setDialog, hasProject, root, engine, setEngine, theme, toggleTheme, menus, setInstallDir, openableModels, tree, handleOpen, setStatus }: DialogWindowsDeps) {
  const openWindowOpen = useRef(false)
  const optionsWindowOpen = useRef(false)

  // Options and Open open as windows of their own (modal: the main window is locked meanwhile); in a plain browser the embedded dialogs below are used.
  // Apply in the Options window stores the choices at once; this window reads them without waiting for the window to close.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key?.startsWith('forge.')) return
      reloadCustomThemes()
      reloadColorOverrides()
      reloadOptions()
      reloadEditorPrefs()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (dialog !== 'options' || !osWindowsAvailable() || optionsWindowOpen.current) return
    optionsWindowOpen.current = true
    void openDialogWindow<OptionsWindowResult>('options', 'Options', { width: 860, height: 640 }, { engine, theme, keymap: keymapEntries(menus) }, { modal: true })
      .then((r) => {
        if (!r) return
        reloadCustomThemes()
        reloadColorOverrides()
        reloadOptions()
        reloadEditorPrefs()
        setInstallDir(r.installDir)
        if (r.engine !== engine) setEngine(r.engine)
        if (r.theme !== theme) toggleTheme(r.theme)
      })
      .catch((e) => notify(errorText(e), { kind: 'error' }))
      .finally(() => {
        optionsWindowOpen.current = false
        setDialog(null)
      })
    // Opens once per request; the values it was given are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])
  useEffect(() => {
    if (dialog !== 'openModel' || !hasProject || !osWindowsAvailable() || openWindowOpen.current) return
    openWindowOpen.current = true
    void openDialogWindow<{ type: string; name: string }>('open', 'Open', { width: 680, height: 540 }, { models: openableModels }, { modal: true })
      .then((m) => {
        if (!m) return
        const node = findObject(tree, m.type, m.name)
        if (node) void handleOpen(node)
      })
      .catch((e) => notify(errorText(e), { kind: 'error' }))
      .finally(() => {
        openWindowOpen.current = false
        setDialog(null)
      })
  }, [dialog, hasProject, openableModels, tree, handleOpen])

  // Further dialogs also open as windows of their own (modal); the embedded versions below stay for a plain browser.
  useOsDialog<{ message: string }>(
    dialog === 'deploy' && hasProject,
    () => ({ name: 'deployplan', title: 'Deploy', size: { width: 900, height: 660 }, payload: { project: root } }),
    (r) => {
      if (r) setStatus(r.message)
    },
    () => setDialog((d) => (d === 'deploy' ? null : d)),
  )
  useOsDialog<unknown>(dialog === 'about', () => ({ name: 'about', title: 'About Dito Designer', size: { width: 600, height: 560 }, payload: {} }), () => {}, () => setDialog((d) => (d === 'about' ? null : d)))
  useOsDialog<unknown>(
    dialog === 'plugins',
    () => ({ name: 'plugins', title: 'Plugins', size: { width: 760, height: 560 }, payload: {} }),
    () => reloadPluginPrefs(),
    () => setDialog((d) => (d === 'plugins' ? null : d)),
  )
  useOsDialog<unknown>(dialog === 'localData', () => ({ name: 'localdata', title: 'Local Data', size: { width: 720, height: 560 }, payload: {} }), () => {}, () => setDialog((d) => (d === 'localData' ? null : d)))
  useOsDialog<{ tableCenter?: boolean }>(
    dialog === 'updates',
    () => ({ name: 'updates', title: 'Check for Updates', size: { width: 600, height: 560 }, payload: {} }),
    (r) => {
      if (r?.tableCenter) setDialog('tableCenter')
    },
    () => setDialog((d) => (d === 'updates' ? null : d)),
  )
}
