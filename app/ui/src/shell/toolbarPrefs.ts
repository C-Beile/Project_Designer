import { configGet, configSet } from '../settings/appConfig'
// Which toolbar groups are shown (View > Toolbars, right click on the toolbar) and whether the
// icons are small. Kept per user in designer.conf ([toolbar]); a missing value means the defaults apply.

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

const TOOLBAR_PATH = ['toolbar'] as const

export function defaultToolbarPrefs(): ToolbarPrefs {
  return { groups: { analytics: true, convert: true, open: true, undoredo: true, git: true, deploy: true, run: true, performance: false, build: true }, smallIcons: true }
}

export function loadToolbarPrefs(): ToolbarPrefs {
  const out = defaultToolbarPrefs()
  const parsed = configGet<Partial<ToolbarPrefs>>(...TOOLBAR_PATH) ?? {}
  for (const g of TOOLBAR_GROUPS) if (typeof parsed.groups?.[g.id] === 'boolean') out.groups[g.id] = parsed.groups[g.id]
  if (typeof parsed.smallIcons === 'boolean') out.smallIcons = parsed.smallIcons
  return out
}

export function saveToolbarPrefs(prefs: ToolbarPrefs): void {
  configSet(TOOLBAR_PATH, prefs)
}
