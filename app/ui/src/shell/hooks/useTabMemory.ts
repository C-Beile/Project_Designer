import { useEffect, useRef } from 'react'
import { normId } from '../../problems/problemStore'
import { configGet, configSet } from '../../settings/appConfig'
import { isAliasConfigNode, isRestNode, isServiceNode, isTunnelNode, isViewNode, type TabState } from '../../tabs/tabModel'
import type { TreeNode } from '../../wire/types'
import { findNodeByPath } from '../shellHelpers'

export interface TabMemoryDeps {
  projects: string[]
  trees: Record<string, TreeNode[]>
  loadingProjects: Set<string>
  tabState: TabState
  handleOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
}

/** Gemerkt je Projekt in `designer.conf` unter `[tabs."<Projektordner>"]`: offene Tabs in Reihenfolge und der aktive. */
interface SavedTabs {
  open?: string[]
  active?: string
}

const readSaved = (project: string) => configGet<SavedTabs>('tabs', project)

// Tabs mit einer Datei oder einem Objekt dahinter; SQL-, REST-, Alias- und Tunnel-Tabs sind virtuell und kommen nicht wieder.
const isRememberable = (node: TreeNode) => !(isServiceNode(node) || isRestNode(node) || isAliasConfigNode(node) || isTunnelNode(node) || isViewNode(node) || node.code)

// Merkt offene Editor-Tabs je Projekt und öffnet sie wieder, sobald der Baum des Projekts geladen ist.
export function useTabMemory({ projects, trees, loadingProjects, tabState, handleOpen }: TabMemoryDeps) {
  const handleOpenRef = useRef(handleOpen)
  handleOpenRef.current = handleOpen
  // Projekte, deren gemerkte Tabs schon wieder offen sind (erst dann wird für sie gespeichert, sonst überschreibt der leere Anfang den Stand).
  const ready = useRef(new Set<string>())
  const started = useRef(new Set<string>())

  useEffect(() => {
    for (const set of [ready.current, started.current]) for (const p of set) if (!projects.includes(p)) set.delete(p)
    for (const project of projects) {
      const tops = trees[project]
      if (started.current.has(project) || !tops || tops.length === 0 || loadingProjects.has(project)) continue
      started.current.add(project)
      const saved = readSaved(project)
      const ids = saved?.open ?? []
      if (ids.length === 0) {
        ready.current.add(project)
        continue
      }
      // Der aktive Tab zuletzt, damit er vorne liegt.
      const order = saved?.active && ids.includes(saved.active) ? [...ids.filter((i) => i !== saved.active), saved.active] : ids
      void (async () => {
        for (const id of order) {
          const wanted = normId(id)
          const top = tops.find((t) => findNodeByPath([t], wanted))
          const node = top ? findNodeByPath([top], wanted) : null
          if (node && top) await handleOpenRef.current(node, top)
        }
        ready.current.add(project)
      })()
    }
  }, [projects, trees, loadingProjects])

  useEffect(() => {
    for (const project of projects) {
      if (!ready.current.has(project)) continue
      const mine = tabState.tabs.filter((t) => t.project === project && isRememberable(t.node))
      const open = mine.map((t) => t.id)
      const previous = readSaved(project)?.active
      const active = mine.some((t) => t.id === tabState.activeId) ? tabState.activeId! : previous && open.includes(previous) ? previous : undefined
      configSet(['tabs', project], open.length > 0 ? { open, active } : null)
    }
  }, [tabState, projects])
}
