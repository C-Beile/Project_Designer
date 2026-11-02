// Which toolbar groups are shown (View > Toolbars, right click on the toolbar) and whether the
// icons are small. Kept per user in localStorage; storage problems only mean the defaults apply.

export type ToolbarGroup = 'analytics' | 'convert' | 'open' | 'undoredo' | 'git' | 'deploy' | 'run' | 'performance' | 'build'

export const TOOLBAR_GROUPS: { id: ToolbarGroup; label: string }[] = [
  { id: 'analytics', label: 'analytics' },
  { id: 'convert', label: 'convert' },
  { id: 'open', label: 'open' },
  { id: 'undoredo', label: 'undoredo' },
  { id: 'git', label: 'git' },
  { id: 'deploy', label: 'deploy' },
  { id: 'run', label: 'Run' },
  { id: 'performance', label: 'Performance' },
  { id: 'build', label: 'Transpiler' },
]

export interface ToolbarPrefs {
  groups: Record<ToolbarGroup, boolean>
  smallIcons: boolean
}

export const TOOLBAR_KEY = 'forge.toolbar.v1'

export function defaultToolbarPrefs(): ToolbarPrefs {
  return { groups: { analytics: true, convert: true, open: true, undoredo: true, git: true, deploy: true, run: true, performance: false, build: true }, smallIcons: true }
}

export function loadToolbarPrefs(): ToolbarPrefs {
  const out = defaultToolbarPrefs()
  try {
    const raw = window.localStorage.getItem(TOOLBAR_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<ToolbarPrefs>) : {}
    for (const g of TOOLBAR_GROUPS) if (typeof parsed.groups?.[g.id] === 'boolean') out.groups[g.id] = parsed.groups[g.id]
    if (typeof parsed.smallIcons === 'boolean') out.smallIcons = parsed.smallIcons
  } catch {
    // defaults
  }
  return out
}

export function saveToolbarPrefs(prefs: ToolbarPrefs): void {
  try {
    window.localStorage.setItem(TOOLBAR_KEY, JSON.stringify(prefs))
  } catch {
    // the choice still applies for this session
  }
}
