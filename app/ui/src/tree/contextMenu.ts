import { formatShortcut } from '../shell/shortcuts'
import type { TreeNode } from '../wire/types'

// Context menus of the Projects tree, entry for entry as in the original (LAYOUT_SPEC section 10a).
// Entries Forge cannot run yet stay in place but dimmed with a reason (section 10), so the menu
// looks the same as the original's. Separators are the only addition.

export interface MenuEntry {
  id: string
  label: string
  enabled: boolean
  hint?: string
  shortcut?: string
  separator?: boolean
  children?: MenuEntry[]
}

export interface TreeMenuContext {
  /** Object copied with "Copy": its object file, type folder and name. */
  clipboard: { path: string; folder: string; name: string } | null
  /** A project folder is open and under Git. */
  hasProject: boolean
  /** File copied or cut in the tree ("Copy" / "Cut" of a file). */
  fileClipboard?: { path: string; cut: boolean } | null
}

const LATER = 'Not available yet'
const READ_ONLY = 'Objects of modules are read-only'
const READ_ONLY_FILE = 'Files of modules are read-only'
const SERVER = 'Server control is not evidenced: the start/stop and cache protocol of the original is unknown (needs a screenshot or trace of it)'

// Models the original refuses to copy (Copy needs a single parent and none of these types).
export const COPY_BLOCKED_TYPES = ['context', 'neonContext', 'preferences', 'application', 'language']
const USAGE_TYPES = ['entity', 'neonView', 'entityWebservice']
// Objects Rename can follow with a reference update (same set as Find Usages).
const RENAME_TYPES = USAGE_TYPES
const FOLDER_ON_DISK: Record<string, string> = {
  context: 'neonContext',
  notificationtype: 'neonNotificationType',
  dashboard: 'neonDashboard',
  renderer: 'rendererDefinition',
  service: 'serviceDefinition',
  alias: 'aliasDefinition',
}

/** Folder on disk behind a type folder of the tree (context -> 
eonContext); null for folders without objects of their own. */
export function diskFolderOf(treeKey: string | undefined): string | null {
  if (!treeKey || treeKey === 'test' || treeKey === 'others') return null
  return FOLDER_ON_DISK[treeKey] ?? treeKey
}
const sep = (n: number): MenuEntry => ({ id: `sep-${n}`, label: '', enabled: false, separator: true })
const entry = (id: string, label: string, enabled: boolean, hint?: string): MenuEntry => ({ id, label, enabled, hint: enabled ? undefined : (hint ?? LATER) })
const later = (id: string, label: string): MenuEntry => entry(id, label, false)

/** `<root>/<type>/<Name>/<Name>.aod` -> its type folder and name; null for any other layout. */
export function objectLayout(path: string): { folder: string; name: string } | null {
  const m = /[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]\2\.aod$/i.exec(path)
  return m ? { folder: m[1], name: m[2] } : null
}

function inModule(path: string): boolean {
  return /[\\/]node_modules[\\/]/i.test(path)
}

const historyMenu = (enabled: boolean): MenuEntry => ({
  id: 'history',
  label: 'History',
  enabled,
  hint: enabled ? undefined : LATER,
  children: [entry('history.show', 'Show History', enabled)],
})

const gitMenu = (enabled: boolean): MenuEntry => ({
  id: 'git',
  label: 'Git',
  enabled,
  hint: enabled ? undefined : 'Open a project first',
  children: [
    entry('git.commit', 'Commit...', enabled),
    entry('git.pull', 'Pull...', enabled),
    entry('git.push', 'Push...', enabled),
    entry('git.branches', 'Switch Branch...', enabled),
    entry('git.history', 'History...', enabled),
  ],
})

// Liquibase submenu of a database alias (manual 14.5.2). Update runs the changelogs of
// `.liquibase/<alias>`; the two drop actions delete every table and stay off until a tested,
// confirmed write path exists.
const DROP_HINT = 'Drops every table of the database and cannot be undone; not available yet'
const liquibaseMenu = (enabled: boolean): MenuEntry => ({
  id: 'liquibase',
  label: 'Liquibase',
  enabled,
  hint: enabled ? undefined : 'Open a project first',
  children: [entry('liquibase.update', 'Update...', enabled, 'Open a project first'), entry('liquibase.dropAll', 'Drop All...', false, DROP_HINT), entry('liquibase.dropAllUpdate', 'Drop All & Update...', false, DROP_HINT)],
})

const NODEJS_ACTIONS: [string, string][] = [
  ['install', 'npm install'],
  ['clean-install', 'npm clean-install'],
  ['outdated', 'npm outdated'],
  ['update', 'npm update'],
  ['login', 'npm login'],
  ['publish', 'npm publish'],
]

// NodeJS submenu of package.json (original Designer, reference shot 94). Other nodes do not show it:
// the original menu of a project node or folder is not documented (needs a screenshot).
const nodeJsMenu = (enabled: boolean): MenuEntry => ({
  id: 'nodejs',
  label: 'NodeJS',
  enabled,
  hint: enabled ? undefined : 'Open a project first',
  children: NODEJS_ACTIONS.map(([id, label]) => entry(`nodejs.${id}`, label, enabled, 'Open a project first')),
})

const OPEN_AS_HINT = 'The submenu of Open As... is not documented (needs a screenshot of it)'
const TOOLS_HINT = 'The Tools submenu of a file is not documented (needs a screenshot of it)'
const TEMPLATE_HINT = 'Save As Template is not documented (needs a screenshot of its dialog)'

const toolsMenu = (): MenuEntry => ({ id: 'tools', label: 'Tools', enabled: false, hint: LATER, children: [] })

export function treeNodeKind(n: TreeNode): string {
  return n.kind ?? (n.object_type ? 'object' : 'folder')
}

export function buildTreeMenu(node: TreeNode, ctx: TreeMenuContext): MenuEntry[] {
  const kind = treeNodeKind(node)
  const git = ctx.hasProject
  let s = 0

  if (kind === 'project' || kind === 'module') {
    const isProject = kind === 'project'
    return [
      later('upgradeModels', 'Upgrade All Models'),
      later('upgradeJdito', 'Upgrade JDito'),
      sep(s++),
      isProject ? entry('transpile.partial', 'Partial Transpile', true) : later('transpile.partial', 'Partial Transpile'),
      isProject ? entry('transpile.full', 'Full Transpile', true) : later('transpile.full', 'Full Transpile'),
      // Deploy entries are Vendira's way to reach the deploy window from the tree.
      isProject ? entry('deploy.project', 'Deploy...', true) : later('deploy.project', 'Deploy...'),
      isProject ? entry('buildDeploy', 'Build and Deploy...', true) : later('buildDeploy', 'Build and Deploy...'),
      sep(s++),
      later('find', 'Find...'),
      isProject ? entry('closeProject', 'Close', true) : later('closeModule', 'Close'),
      later('rename', 'Rename...'),
      historyMenu(false),
      gitMenu(git),
      entry('refresh', 'Refresh Folder', true),
      sep(s++),
      entry('properties', 'Properties', true),
    ]
  }

  if (kind === 'object') {
    const layout = objectLayout(node.id)
    const missing = node.id.startsWith('missing:')
    const readOnly = !!node.read_only || inModule(node.id)
    const type = node.object_type ?? ''
    const copyBlocked = COPY_BLOCKED_TYPES.includes(type)
    const copyHint = copyBlocked ? 'Context, Preferences, Application and Language models cannot be copied' : 'Only objects in the standard folder layout can be copied'
    const items: MenuEntry[] = [
      entry('open', 'Open', !missing),
      entry('copy', 'Copy', !!layout && !missing && !copyBlocked, copyHint),
      entry('paste', 'Paste', !!ctx.clipboard && !!layout && ctx.clipboard.folder === layout.folder, ctx.clipboard ? `Only ${ctx.clipboard.folder} objects can be pasted here` : 'Nothing copied yet'),
      entry('openSource', 'Open Model Source', !missing),
    ]
    if (inModule(node.id)) items.splice(1, 0, entry('createModification', 'Create Modification', !missing))
    items.push(sep(s++))
    if (type === 'system') items.push(later('setDefault', 'Set Default'))
    items.push(later('deploy', `Deploy "${node.label}"`))
    if (type === 'system') {
      items.push(
        sep(s++),
        entry('runServer', 'Start Server', false, SERVER),
        entry('clearCache', 'Clear Cache', false, SERVER),
        entry('openNeon', 'Open Neon Client', false, SERVER),
        sep(s++),
        later('openTunnels', 'Open Tunnels'),
        later('closeTunnels', 'Close Opened Tunnels'),
      )
    }
    items.push(
      sep(s++),
      later('find', 'Find...'),
      entry('findUsages', 'Find Usages', !!layout && !missing && USAGE_TYPES.includes(type), 'Usages can be listed for entities, views and webservices'),
      later('replace', 'Replace'),
      sep(s++),
      entry('delete', 'Delete', !!layout && !readOnly && !missing, readOnly ? READ_ONLY : 'Only objects in the standard folder layout can be deleted'),
      entry('rename', 'Rename...', !!layout && !missing && !readOnly && RENAME_TYPES.includes(type), readOnly ? READ_ONLY : 'Rename updates the references of entities, views and entity webservices only'),
      sep(s++),
      historyMenu(!missing),
      gitMenu(git),
      ...(type === 'aliasDefinition' ? [liquibaseMenu(git && !!layout && !missing)] : []),
      entry('refresh', 'Refresh Folder', true),
      sep(s++),
      toolsMenu(),
      entry('properties', 'Properties', true),
    )
    if (type === 'context' || type === 'neonContext' || type === 'neonView') items.push(sep(s++), later('new', 'New'))
    if (type === 'neonView') items.push(later('executeTests', 'Execute Tests'))
    return items
  }

  if (kind === 'file') {
    const readOnly = !!node.read_only || inModule(node.id)
    const hasClip = !!ctx.fileClipboard
    const isPackageJson = /[\\/]package\.json$/i.test(node.id) && !readOnly
    const items: MenuEntry[] = [
      entry('open', 'Open', true),
      entry('file.openAs', 'Open As...', false, OPEN_AS_HINT),
      entry('file.openSystem', 'Open in System', true),
      sep(s++),
      { ...entry('file.cut', 'Cut', !readOnly, READ_ONLY_FILE), shortcut: formatShortcut('Mod+X') },
      { ...entry('file.copy', 'Copy', true), shortcut: formatShortcut('Mod+C') },
      { ...entry('file.paste', 'Paste', hasClip && !readOnly, hasClip ? READ_ONLY_FILE : 'Nothing copied yet'), shortcut: formatShortcut('Mod+V') },
      { ...entry('file.delete', 'Delete', !readOnly, READ_ONLY_FILE), shortcut: 'Delete' },
      entry('file.rename', 'Rename...', !readOnly, READ_ONLY_FILE),
      sep(s++),
      historyMenu(true),
      gitMenu(git),
    ]
    if (isPackageJson) items.push(nodeJsMenu(ctx.hasProject))
    items.push(
      { id: 'tools', label: 'Tools', enabled: false, hint: TOOLS_HINT, children: [] },
      entry('file.saveTemplate', 'Save As Template...', false, TEMPLATE_HINT),
      entry('properties', 'Properties', true),
    )
    return items
  }

  if (kind === 'dir') {
    const readOnly = !!node.read_only || inModule(node.id)
    const hasClip = !!ctx.fileClipboard
    return [
      { ...entry('file.paste', 'Paste', hasClip && !readOnly, hasClip ? READ_ONLY_FILE : 'Nothing copied yet'), shortcut: formatShortcut('Mod+V') },
      entry('refresh', 'Refresh Folder', true),
      sep(s++),
      historyMenu(false),
      gitMenu(git),
      entry('properties', 'Properties', true),
    ]
  }

  // Type folders (entity, process, ...) and plain directories.
  const key = node.folder ?? ''
  const pasteOk = !!ctx.clipboard && kind === 'folder' && !!key && ctx.clipboard.folder === key
  return [
    entry('new', 'New', kind === 'folder' && !!diskFolderOf(key) && ctx.hasProject, 'Open a project first'),
    entry('paste', 'Paste', pasteOk, ctx.clipboard ? `Only ${ctx.clipboard.folder} objects can be pasted here` : 'Nothing copied yet'),
    later('find', 'Find...'),
    sep(s++),
    historyMenu(false),
    gitMenu(git),
    entry('refresh', 'Refresh Folder', true),
    sep(s++),
    toolsMenu(),
  ]
}
