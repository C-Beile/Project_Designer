import { pathKey } from '../platform/pathKey'
import { useSyncExternalStore } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { ScmFile, ScmOverview } from '../wire/types'
import { errorText } from './errorText'

// Neutral im Kern: Ein Source-Control-Plugin (Git) setzt mit setScmProvider, woher der Stand kommt.
// Ohne Plugin bleibt der Store leer. One shared picture of the Git status of the active project: the Source Control panel, the colours
// in the project tree and the editor tabs, the status bar and the editor gutters all read it. It is
// refreshed when a project opens, after saves and Git actions, when the window gets focus and when
// the project files changed; never on a timer of its own.

export type GitCode = 'M' | 'A' | 'D' | 'U' | 'R' | 'C'

interface State {
  root: string
  overview: ScmOverview | null
  /** Why there is no overview (not a repository, git missing); null while it loads or when there is one. */
  error: string | null
  loading: boolean
  /** Bumped on every finished refresh: editors reload their gutter markers when it changes. */
  version: number
}

let state: State = { root: '', overview: null, error: null, loading: false, version: 0 }
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useScm(): State {
  return useSyncExternalStore(subscribe, () => state)
}

export function getScm(): State {
  return state
}

let inflight = 0

/** Liefert den Stand eines Projekts; das SCM-Plugin setzt sie (Git: `api.scmStatus`). */
export type ScmProvider = (api: ForgeApi, root: string) => Promise<ScmOverview>
let provider: ScmProvider | null = null

/** Meldet die Quelle des Standes an; gibt die Abmelde-Funktion zurück. */
export function setScmProvider(p: ScmProvider): () => void {
  provider = p
  return () => {
    if (provider === p) provider = null
  }
}

export async function refreshScm(api: ForgeApi, root: string): Promise<void> {
  const source = provider
  if (!source) return
  if (!root.trim()) {
    set({ root: '', overview: null, error: null, loading: false, version: state.version + 1 })
    return
  }
  const ticket = ++inflight
  set({ root, loading: true })
  try {
    const overview = await source(api, root)
    if (ticket === inflight) set({ overview, error: null, loading: false, version: state.version + 1 })
  } catch (e) {
    if (ticket === inflight) set({ overview: null, error: errorText(e), loading: false, version: state.version + 1 })
  }
}

export function normPath(p: string): string {
  return pathKey(p)
}

export function codeOf(f: ScmFile): GitCode {
  const pair = `${f.index}${f.worktree}`
  if (f.index === 'U' || f.worktree === 'U' || pair === 'AA' || pair === 'DD') return 'C'
  if (f.index === '?') return 'U'
  if (f.index === 'D' || f.worktree === 'D') return 'D'
  if (f.index === 'A') return 'A'
  if (f.index === 'R' || f.index === 'C') return 'R'
  return 'M'
}

export interface GitIndex {
  files: Map<string, GitCode>
  folders: Set<string>
}

const cache = new WeakMap<ScmOverview, GitIndex>()

export function indexOf(overview: ScmOverview | null): GitIndex | null {
  if (!overview) return null
  const hit = cache.get(overview)
  if (hit) return hit
  const root = normPath(overview.root)
  const files = new Map<string, GitCode>()
  const folders = new Set<string>()
  for (const f of overview.files) {
    const full = `${root}/${normPath(f.path)}`
    files.set(full, codeOf(f))
    let dir = full.slice(0, full.lastIndexOf('/'))
    while (dir.length >= root.length && !folders.has(dir)) {
      folders.add(dir)
      const cut = dir.lastIndexOf('/')
      if (cut < 0) break
      dir = dir.slice(0, cut)
    }
  }
  const built = { files, folders }
  cache.set(overview, built)
  return built
}

/**
 * Git state of a tree node or a file: its own change, for an object the changes inside its folder
 * (linked scripts), for a folder or project any change below it.
 */
export function decorationFor(index: GitIndex | null, id: string, kind?: string): GitCode | null {
  if (!index || !id) return null
  const n = normPath(id)
  const own = index.files.get(n)
  if (own) return own
  if (kind === 'object' && n.endsWith('.aod')) {
    const dir = n.slice(0, n.lastIndexOf('/'))
    if (index.folders.has(dir)) return 'M'
    return null
  }
  if ((kind === 'folder' || kind === 'project' || kind === 'module') && index.folders.has(n)) return 'M'
  return null
}

export const GIT_CODE_LABEL: Record<GitCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'New (not tracked)',
  R: 'Renamed',
  C: 'Conflict',
}

/** Test helper. */
export function _resetScmForTests(): void {
  inflight = 0
  state = { root: '', overview: null, error: null, loading: false, version: 0 }
  for (const l of listeners) l()
}
