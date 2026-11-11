import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { collectByType } from '../../core/treeIndex'
import { clearChannelsWhere } from '../../problems/problemStore'
import type { TreeNode } from '../../wire/types'
import { samePath } from '../shellHelpers'
import { getOptions } from '../../settings/options'

export interface ProjectsDeps {
  api: ForgeApi
  projectRoot: string
  setStatus: (text: string) => void
}

function collectSystems(nodes: TreeNode[], out: { name: string; isDefault: boolean }[] = []) {
  for (const n of nodes) {
    if (n.is_leaf && n.object_type === 'system' && !n.id.startsWith('missing:')) out.push({ name: n.label, isDefault: !!n.bold })
    collectSystems(n.children, out)
  }
  return out
}

// Die offenen Projekte: Liste, aktives Projekt, geladene Bäume, Symbole und die Systeme (Run-Konfiguration) des aktiven Projekts.
export function useProjects({ api, projectRoot, setStatus }: ProjectsDeps) {
  // Several projects at once (LAYOUT_SPEC §4.2). `projectRoot` is only an initial project (dev
  // "project" URL parameter / tests); the persisted list is restored on start.
  const [projects, setProjects] = useState<string[]>(() => (projectRoot.trim() ? [projectRoot] : []))
  const [activeProject, setActiveProject] = useState<string | null>(projectRoot.trim() ? projectRoot : null)
  const [reloadToken, setReloadToken] = useState(0)
  const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
  const loadedWith = useRef<Record<string, number>>({})
  const [runConfig, setRunConfig] = useState('')

  const root = activeProject && projects.some((p) => samePath(p, activeProject)) ? activeProject : (projects[0] ?? '')

  useEffect(() => {
    if (!getOptions().general.restoreProjects) return
    api
      .restoreOpenProjects()
      .then((restored) => {
        if (restored.length === 0) return
        setProjects((prev) => [...prev, ...restored.filter((r) => !prev.some((p) => samePath(p, r)))])
        setActiveProject((prev) => prev ?? restored[0])
      })
      .catch(() => {})
  }, [api])

  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(() => new Set())
  const [iconSvgs, setIconSvgs] = useState<ReadonlyMap<string, string>>(() => new Map())
  useEffect(() => {
    let cancelled = false
    void api
      .listIcons()
      .then((list) => !cancelled && setIconSvgs(new Map(list.map((i) => [i.id, i.svg]))))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api])

  useEffect(() => {
    for (const p of projects) {
      // Blank entries never reach the scanner (R41); each project is scanned once per refresh.
      if (!p.trim() || loadedWith.current[p] === reloadToken) continue
      loadedWith.current[p] = reloadToken
      setLoadingProjects((prev) => new Set(prev).add(p))
      api
        .openProject(p)
        .then((t) => setTrees((prev) => ({ ...prev, [p]: t })))
        .catch((e) => setStatus(String(e)))
        .finally(() =>
          setLoadingProjects((prev) => {
            const next = new Set(prev)
            next.delete(p)
            return next
          }),
        )
    }
  }, [api, projects, reloadToken])

  const tree = useMemo(() => projects.flatMap((p) => trees[p] ?? []), [projects, trees])
  const treeRef = useRef(tree)
  treeRef.current = tree
  const objectsByType = useMemo(() => collectByType(tree), [tree])
  const openableModels = useMemo(
    () =>
      [...objectsByType.entries()]
        .flatMap(([type, names]) => [...names].map((name) => ({ type, name })))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [objectsByType],
  )
  const activeTree = useMemo(() => trees[root] ?? [], [trees, root])

  const systemEntries = useMemo(() => collectSystems(activeTree), [activeTree])
  const systems = useMemo(() => systemEntries.map((s) => s.name), [systemEntries])
  const defaultSystem = systemEntries.find((s) => s.isDefault)?.name
  const activeSystem = systems.includes(runConfig) ? runConfig : (defaultSystem ?? systems[0] ?? '')

  const projectOf = useCallback(
    (top: TreeNode) => projects.find((p) => trees[p]?.includes(top)) ?? root,
    [projects, trees, root],
  )

  const openProjectAt = useCallback(
    (path: string) => {
      if (!path.trim()) return
      setProjects((prev) => (prev.some((p) => samePath(p, path)) ? prev : [...prev, path]))
      setActiveProject(path)
      setStatus('')
      api.addOpenProject(path).catch(() => {})
    },
    [api],
  )

  // Nimmt Projekte aus Liste, Bäumen und Scan; Tabs und Auswahl räumt der Aufrufer auf.
  const removeProjects = useCallback(
    (toClose: string[]) => {
      setProjects((prev) => prev.filter((p) => !toClose.some((c) => samePath(c, p))))
      setTrees((prev) => {
        const next = { ...prev }
        for (const c of toClose) delete next[c]
        return next
      })
      clearChannelsWhere((ch) => toClose.some((c) => ch === `scan:${c}`))
      for (const c of toClose) {
        delete loadedWith.current[c]
        api.removeOpenProject(c).catch(() => {})
      }
    },
    [api],
  )

  return {
    projects, activeProject, setActiveProject, reloadToken, setReloadToken, trees, loadingProjects, iconSvgs, root, tree, treeRef, objectsByType, openableModels, activeTree,
    systems, activeSystem, setRunConfig, projectOf, openProjectAt, removeProjects,
  }
}
