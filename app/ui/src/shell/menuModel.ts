import type { PanelId } from './layoutState'
import type { TranspilerEngineId } from '../settings/transpilerEngine'
import { TOOLBAR_GROUPS, type ToolbarPrefs } from './toolbarPrefs'
import type { EditorPrefs } from '../theme/editorPrefs'

// Main menu as data. Content, order, separators and shortcuts follow the original Designer's
// menus (LAYOUT_SPEC §9.1a, screenshots 27-35). Entries Forge cannot do yet stay visible at their
// place but dimmed, so users find every command where they expect it. Forge additions are
// appended without moving or overriding original entries. Shortcuts marked "native" are handled
// by the focused text field itself (cut/copy/paste); the menu only shows them.

export const NOT_YET_AVAILABLE = 'Not available yet'

export interface MenuItemDef {
  id: string
  kind: 'item' | 'separator' | 'submenu'
  label: string
  command?: string
  arg?: string
  shortcut?: string
  extraShortcuts?: string[]
  nativeShortcut?: boolean
  enabled: boolean
  checked?: boolean
  // 'checkbox' toggles, 'radio' picks one of a group.
  check?: 'checkbox' | 'radio'
  hint?: string
  children?: MenuItemDef[]
}

export interface MenuDef {
  id: string
  label: string
  mnemonic: string
  items: MenuItemDef[]
}

export type ToolWindowId =
  | 'projects'
  | 'services'
  | 'scm'
  | 'properties'
  | 'navigator'
  | 'output'
  | 'scanservices'
  | 'editor'
  | 'search'
  | 'notifications'
  | 'refactoring'
  | 'problems'

// Tool windows Forge can show and the dock panel hosting each of them (the editor area is fixed).
export const TOOL_WINDOWS: { id: ToolWindowId; label: string; panel: PanelId | null }[] = [
  { id: 'projects', label: 'Projects', panel: 'projects' },
  { id: 'services', label: 'Services', panel: 'projects' },
  { id: 'scm', label: 'Source Control', panel: 'projects' },
  { id: 'properties', label: 'Properties', panel: 'properties' },
  { id: 'navigator', label: 'Navigator', panel: 'navigator' },
  { id: 'output', label: 'Output', panel: 'output' },
  { id: 'scanservices', label: 'Scan Services', panel: 'output' },
  { id: 'editor', label: 'Editor', panel: null },
  { id: 'search', label: 'Search Results', panel: 'output' },
  { id: 'notifications', label: 'Notifications', panel: 'output' },
  { id: 'refactoring', label: 'Refactoring', panel: 'output' },
  { id: 'problems', label: 'Problems', panel: 'output' },
]

const FLOAT_ENTRIES: [string, string][] = [
  ['scm', 'Source Control'],
  ['services', 'Services'],
  ['navigator', 'Navigator'],
  ['properties', 'Properties'],
]

export interface MenuContext {
  hasProject: boolean
  projectName: string | null
  /** Number of projects open in the Projects tree (LAYOUT_SPEC §4.2: several at once). */
  projectCount?: number
  hasSelection: boolean
  hasUnsaved: boolean
  canUndo: boolean
  canRedo: boolean
  recentProject: string | null
  theme: 'dark' | 'light'
  transpileRunning: boolean
  engine: TranspilerEngineId
  /** A code editor (Source tab, SQL, plain file) is open: Edit, Source and Navigate act on it. */
  hasCodeEditor?: boolean
  toolbar?: ToolbarPrefs
  editorPrefs?: EditorPrefs
  /** The selected object supports Find Usages / Safely Delete (entity, view, webservice of the project). */
  usageTarget?: boolean
  /** Git plugin switched on in Tools > Plugins (Team menu). */
  gitActive?: boolean
  /** Panels that float as windows of their own right now. */
  floating?: string[]
  /** The active editor tab can move into a window of its own. */
  canMoveEditor?: boolean
  /** How many editors live in windows of their own right now. */
  editorWindows?: number
  onlyEditor?: boolean
  fullScreen?: boolean
}

let separatorCount = 0
const sep = (): MenuItemDef => ({ id: `sep-${separatorCount++}`, kind: 'separator', label: '', enabled: false })

function item(id: string, label: string, enabled: boolean, extra: Partial<MenuItemDef> = {}): MenuItemDef {
  return { id, kind: 'item', label, command: id, enabled, hint: enabled ? undefined : NOT_YET_AVAILABLE, ...extra }
}

const later = (id: string, label: string, extra: Partial<MenuItemDef> = {}) => item(id, label, false, extra)

const laterSub = (id: string, label: string): MenuItemDef => ({
  id,
  kind: 'submenu',
  label,
  enabled: false,
  hint: NOT_YET_AVAILABLE,
  children: [],
})

const laterCheck = (id: string, label: string) => later(id, label, { check: 'checkbox', checked: false })

// Entry that runs a Monaco action on the code editor in use. The shortcut shown is Monaco's own.
const editorItem = (ctx: { hasCodeEditor?: boolean }, id: string, label: string, action: string, shortcut?: string) =>
  item(id, label, !!ctx.hasCodeEditor, {
    command: 'editor.action',
    arg: action,
    shortcut,
    nativeShortcut: true,
    hint: ctx.hasCodeEditor ? undefined : 'Open a code editor first',
  })

const editorPref = (ctx: { editorPrefs?: EditorPrefs }, key: keyof EditorPrefs, label: string) =>
  item('view.editorPref', label, true, { id: `view.editorPref.${key}`, arg: key, check: 'checkbox', checked: ctx.editorPrefs ? ctx.editorPrefs[key] : undefined })

const windowItem = (id: ToolWindowId, label: string, shortcut?: string) =>
  item('window.open', label, true, { id: `window.open.${id}`, arg: id, shortcut })

export function buildMenus(ctx: MenuContext): MenuDef[] {
  separatorCount = 0
  const noProjectHint = 'Open a project first'
  const transpileEnabled = ctx.hasProject && !ctx.transpileRunning
  const transpileHint = ctx.transpileRunning ? 'A transpile is already running' : noProjectHint
  const gitActive = ctx.gitActive !== false
  const teamOn = ctx.hasProject && gitActive
  const teamHint = !gitActive ? 'The Git plugin is deactivated (Tools > Plugins)' : ctx.hasProject ? undefined : noProjectHint

  return [
    {
      id: 'file',
      label: 'File',
      mnemonic: 'f',
      items: [
        item('file.new', 'New', ctx.hasProject, { shortcut: 'Mod+N', hint: ctx.hasProject ? undefined : noProjectHint }),
        later('file.newProject', 'New Project', { shortcut: 'Mod+Shift+N' }),
        sep(),
        item('file.find', 'Find', ctx.hasProject, { shortcut: 'Mod+O', hint: ctx.hasProject ? undefined : noProjectHint }),
        item('file.openProject', 'Open Project', true, { shortcut: 'Mod+Shift+O' }),
        {
          id: 'file.recent',
          kind: 'submenu',
          label: 'Open Recent Project',
          enabled: true,
          children: ctx.recentProject
            ? [item('file.openRecent', ctx.recentProject, true, { arg: ctx.recentProject, id: 'file.openRecent.0' })]
            : [item('file.openRecent', '(none)', false, { hint: 'No project opened yet', id: 'file.openRecent.none' })],
        },
        sep(),
        item('file.closeProject', 'Close Project', ctx.hasProject, {
          hint: ctx.hasProject ? (ctx.projectName ? `Closes ${ctx.projectName}` : undefined) : noProjectHint,
        }),
        item('file.closeOtherProjects', 'Close Other Projects', (ctx.projectCount ?? 0) > 1),
        item('file.closeAllProjects', 'Close All Projects', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        sep(),
        later('file.projectGroups', 'Project Groups...'),
        sep(),
        item('file.importProject', 'Import Project...', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        item('file.exportProject', 'Export Project...', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        sep(),
        // The original binds Save to Ctrl+Shift+S and Save All to Ctrl+S; kept that way on purpose.
        item('file.save', 'Save', ctx.hasSelection, { shortcut: 'Mod+Shift+S', hint: ctx.hasSelection ? undefined : 'No object open' }),
        later('file.saveAs', 'Save As...'),
        item('file.saveAll', 'Save All', ctx.hasUnsaved, { shortcut: 'Mod+S', hint: ctx.hasUnsaved ? undefined : 'Nothing to save' }),
        sep(),
        item('file.reloadAll', 'Reload All from Disk', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        sep(),
        item('file.exit', 'Exit', true),
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      mnemonic: 'e',
      items: [
        item('edit.undo', 'Undo', ctx.canUndo, { shortcut: 'Mod+Z', hint: ctx.canUndo ? undefined : 'Nothing to undo' }),
        // The original binds Redo to Ctrl+Y; Mod+Shift+Z stays as the usual macOS/Monaco alias.
        item('edit.redo', 'Redo', ctx.canRedo, {
          shortcut: 'Mod+Y',
          extraShortcuts: ['Mod+Shift+Z'],
          hint: ctx.canRedo ? undefined : 'Nothing to redo',
        }),
        sep(),
        item('edit.cut', 'Cut', true, { shortcut: 'Mod+X', nativeShortcut: true }),
        item('edit.copy', 'Copy', true, { shortcut: 'Mod+C', nativeShortcut: true }),
        item('edit.paste', 'Paste', true, { shortcut: 'Mod+V', nativeShortcut: true }),
        later('edit.pasteFormatted', 'Paste Formatted'),
        later('edit.pasteFromHistory', 'Paste from History'),
        later('edit.pasteAsLines', 'Paste as Lines'),
        editorItem(ctx, 'edit.delete', 'Delete', 'deleteRight', 'Delete'),
        editorItem(ctx, 'edit.selectAll', 'Select All', 'editor.action.selectAll', 'Mod+A'),
        later('edit.selectIdentifier', 'Select Identifier'),
        sep(),
        editorItem(ctx, 'edit.findSelection', 'Find Selection', 'actions.findWithSelection'),
        editorItem(ctx, 'edit.findNext', 'Find Next', 'editor.action.nextMatchFindAction', 'F3'),
        editorItem(ctx, 'edit.findPrevious', 'Find Previous', 'editor.action.previousMatchFindAction', 'Shift+F3'),
        sep(),
        editorItem(ctx, 'edit.find', 'Find...', 'actions.find', 'Mod+F'),
        editorItem(ctx, 'edit.replace', 'Replace...', 'editor.action.startFindReplace', 'Mod+H'),
        item('refactor.usages', 'Find Usages', !!ctx.usageTarget, { shortcut: 'Alt+F7', hint: ctx.usageTarget ? undefined : 'Select an entity, view or webservice of the project first' }),
        sep(),
        later('edit.findInProjects', 'Find in Projects...', { shortcut: 'Mod+Shift+F' }),
        later('edit.replaceInProjects', 'Replace in Projects...', { shortcut: 'Mod+Shift+H' }),
      ],
    },
    {
      id: 'view',
      label: 'View',
      mnemonic: 'v',
      items: [
        laterSub('view.editors', 'Editors'),
        laterSub('view.split', 'Split'),
        {
          id: 'view.codeFolds',
          kind: 'submenu',
          label: 'Code Folds',
          enabled: !!ctx.hasCodeEditor,
          hint: ctx.hasCodeEditor ? undefined : 'Open a code editor first',
          children: [
            editorItem(ctx, 'view.fold', 'Collapse Fold', 'editor.fold'),
            editorItem(ctx, 'view.unfold', 'Expand Fold', 'editor.unfold'),
            editorItem(ctx, 'view.foldAll', 'Collapse All', 'editor.foldAll'),
            editorItem(ctx, 'view.unfoldAll', 'Expand All', 'editor.unfoldAll'),
          ],
        },
        {
          id: 'view.toolbars',
          kind: 'submenu',
          label: 'Toolbars',
          enabled: true,
          children: [
            ...TOOLBAR_GROUPS.map((g) =>
              item('view.toolbarGroup', g.label, true, { id: `view.toolbar.${g.id}`, arg: g.id, check: 'checkbox', checked: ctx.toolbar ? ctx.toolbar.groups[g.id] : g.id !== 'performance' }),
            ),
            item('view.toolbarSmall', 'Small Toolbar Icons', true, { check: 'checkbox', checked: ctx.toolbar ? ctx.toolbar.smallIcons : true }),
            sep(),
            item('view.resetToolbars', 'Reset Toolbars', true),
            later('view.customizeToolbars', 'Customize'),
          ],
        },
        sep(),
        editorPref(ctx, 'lineNumbers', 'Toggle Line Numbers'),
        editorPref(ctx, 'nonPrintable', 'Toggle Non-printable Characters'),
        laterCheck('view.breadcrumbs', 'Show Breadcrumbs'),
        editorPref(ctx, 'indentGuides', 'Show Indent Guide Lines'),
        editorPref(ctx, 'inlineHints', 'Show Inline Hints'),
        laterCheck('view.diffSidebar', 'Show Diff Sidebar'),
        laterCheck('view.versioningLabels', 'Show Versioning Labels'),
        laterCheck('view.syncEditor', 'Synchronize Editor with Views'),
        sep(),
        item('view.onlyEditor', 'Show Only Editor', true, { shortcut: 'Mod+Shift+Enter', check: 'checkbox', checked: !!ctx.onlyEditor }),
        item('view.fullScreen', 'Full Screen', true, { shortcut: 'F11', check: 'checkbox', checked: !!ctx.fullScreen }),
      ],
    },
    {
      id: 'navigate',
      label: 'Navigate',
      mnemonic: 'n',
      items: [
        later('navigate.previous', 'Previous', { shortcut: 'Mod+Alt+ArrowLeft' }),
        later('navigate.next', 'Next', { shortcut: 'Mod+Alt+ArrowRight' }),
        item('file.find', 'Go to File...', ctx.hasProject, { id: 'navigate.goToFile', shortcut: 'Alt+Shift+O', extraShortcuts: ['Mod+P'], hint: ctx.hasProject ? undefined : noProjectHint }),
        later('navigate.goToType', 'Go to Type...', { shortcut: 'Mod+J' }),
        later('navigate.goToSymbol', 'Go to Symbol...', { shortcut: 'Mod+Alt+Shift+O' }),
        later('navigate.previousWindow', 'Go to Previous Window'),
        sep(),
        later('navigate.goToSource', 'Go to Source'),
        editorItem(ctx, 'navigate.goToDeclaration', 'Go to Declaration', 'editor.action.revealDefinition', 'F12'),
        later('navigate.goToSuper', 'Go to Super Implementation'),
        sep(),
        later('navigate.lastEdit', 'Last Edit Location'),
        editorItem(ctx, 'navigate.back', 'Back', 'cursorUndo'),
        editorItem(ctx, 'navigate.forward', 'Forward', 'cursorRedo'),
        sep(),
        editorItem(ctx, 'navigate.goToLine', 'Go to Line...', 'editor.action.gotoLine', 'Mod+G'),
        later('navigate.toggleBookmark', 'Toggle Bookmark', { shortcut: 'Mod+Shift+M' }),
        later('navigate.bookmarkNext', 'Bookmark History Popup Next', { shortcut: 'Mod+Shift+.' }),
        later('navigate.bookmarkPrevious', 'Bookmark History Popup Previous', { shortcut: 'Mod+Shift+,' }),
        sep(),
        editorItem(ctx, 'navigate.nextError', 'Next Error', 'editor.action.marker.next', 'F8'),
        editorItem(ctx, 'navigate.previousError', 'Previous Error', 'editor.action.marker.prev', 'Shift+F8'),
        sep(),
        later('navigate.selectInProjects', 'Select in Projects', { shortcut: 'Mod+Shift+1' }),
        later('navigate.selectInFiles', 'Select in Files', { shortcut: 'Mod+Shift+2' }),
        later('navigate.selectInFavorites', 'Select in Favorites', { shortcut: 'Mod+Shift+3' }),
      ],
    },
    {
      id: 'source',
      label: 'Source',
      mnemonic: 's',
      items: [
        editorItem(ctx, 'source.format', 'Format', 'editor.action.formatDocument', 'Alt+Shift+F'),
        editorItem(ctx, 'source.removeTrailing', 'Remove Trailing Spaces', 'editor.action.trimTrailingWhitespace'),
        editorItem(ctx, 'source.shiftLeft', 'Shift Left', 'editor.action.outdentLines'),
        editorItem(ctx, 'source.shiftRight', 'Shift Right', 'editor.action.indentLines'),
        editorItem(ctx, 'source.moveUp', 'Move Up', 'editor.action.moveLinesUpAction', 'Alt+ArrowUp'),
        editorItem(ctx, 'source.moveDown', 'Move Down', 'editor.action.moveLinesDownAction', 'Alt+ArrowDown'),
        later('source.moveElementUp', 'Move Code Element Up', { shortcut: 'Alt+Shift+PageUp' }),
        later('source.moveElementDown', 'Move Code Element Down', { shortcut: 'Alt+Shift+PageDown' }),
        editorItem(ctx, 'source.duplicateUp', 'Duplicate Up', 'editor.action.copyLinesUpAction'),
        editorItem(ctx, 'source.duplicateDown', 'Duplicate Down', 'editor.action.copyLinesDownAction'),
        editorItem(ctx, 'source.toggleComment', 'Toggle Comment', 'editor.action.commentLine', 'Mod+/'),
        sep(),
        editorItem(ctx, 'source.completeCode', 'Complete Code...', 'editor.action.triggerSuggest', 'Mod+Space'),
        later('source.insertCode', 'Insert Code...'),
        editorItem(ctx, 'source.fixCode', 'Fix Code...', 'editor.action.quickFix', 'Alt+Enter'),
        editorItem(ctx, 'source.showParameters', 'Show Method Parameters', 'editor.action.triggerParameterHints', 'Mod+Shift+Space'),
        later('source.showDocumentation', 'Show Documentation'),
        sep(),
        later('source.nextMatchingWord', 'Insert Next Matching Word'),
        later('source.previousMatchingWord', 'Insert Previous Matching Word'),
        sep(),
        later('source.scanExternal', 'Scan for External Changes'),
      ],
    },
    {
      id: 'refactor',
      label: 'Refactor',
      mnemonic: 'r',
      items: [
        item('refactor.rename', 'Rename...', !!ctx.usageTarget, { shortcut: 'Mod+R', hint: ctx.usageTarget ? undefined : 'Select an entity, view or webservice of the project first' }),
        later('refactor.move', 'Move...', { shortcut: 'Mod+M' }),
        later('refactor.copy', 'Copy...', { shortcut: 'Alt+C' }),
        item('refactor.safeDelete', 'Safely Delete...', !!ctx.usageTarget, { shortcut: 'Alt+Delete', hint: ctx.usageTarget ? undefined : 'Select an entity, view or webservice of the project first' }),
      ],
    },
    {
      id: 'team',
      label: 'Team',
      mnemonic: 't',
      items: [
        later('team.shelve', 'Shelve Changes'),
        sep(),
        {
          id: 'team.git',
          kind: 'submenu',
          label: 'Git',
          enabled: teamOn,
          hint: teamHint,
          children: [
            item('team.commit', 'Commit...', teamOn, { hint: teamHint }),
            item('team.pull', 'Pull...', teamOn, { hint: teamHint }),
            item('team.push', 'Push...', teamOn, { hint: teamHint }),
            item('team.switchBranch', 'Switch Branch...', teamOn, { hint: teamHint }),
          ],
        },
        sep(),
        {
          id: 'team.historyMenu',
          kind: 'submenu',
          label: 'History',
          enabled: teamOn,
          hint: teamHint,
          children: [item('team.history', 'Show Project History', teamOn, { hint: teamHint })],
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      mnemonic: 'o',
      items: [
        item('tools.generateUuid', 'Generate UUID', true, { shortcut: 'Mod+Shift+U' }),
        {
          id: 'tools.toolsMenu',
          kind: 'submenu',
          label: 'Tools',
          enabled: false,
          hint: NOT_YET_AVAILABLE,
          children: [later('tools.applyPatch', 'Apply Diff Patch...'), later('tools.diff', 'Diff...'), later('tools.addFavorites', 'Add to Favorites'), later('tools.openTerminal', 'Open in Terminal')],
        },
        later('tools.reportDatasources', 'Report Datasources'),
        later('tools.dtds', 'DTDs and XML Schemas'),
        laterSub('tools.palette', 'Palette'),
        later('tools.dependencyGraph', 'Create Dependency Graph...'),
        sep(),
        {
          id: 'tools.nativeTools',
          kind: 'submenu',
          label: 'Native Tools',
          enabled: false,
          hint: NOT_YET_AVAILABLE,
          children: [later('tools.refreshNativeTools', 'Re-fresh Native Tools'), later('tools.nativeToolsStatus', 'View Native Tools Status'), later('tools.nativeToolsDirectory', 'Open Native Tools Directory')],
        },
        sep(),
        // Vendira's own commands have no counterpart in the original menus; they sit in one block above Plugins.
        item('file.projectProperties', 'Project Properties', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        item('project.deploy', 'Deploy...', ctx.hasProject, { hint: ctx.hasProject ? undefined : noProjectHint }),
        item('project.buildDeploy', 'Build and Deploy...', ctx.hasProject && !ctx.transpileRunning, { shortcut: 'Mod+Shift+F9', hint: ctx.hasProject ? undefined : noProjectHint }),
        item('tools.transpilePartial', 'Transpile (Partial)', transpileEnabled, { hint: transpileEnabled ? undefined : transpileHint }),
        item('tools.transpileFull', 'Transpile (Full)', transpileEnabled, { hint: transpileEnabled ? undefined : transpileHint }),
        {
          id: 'tools.engine',
          kind: 'submenu',
          label: 'Transpiler',
          enabled: true,
          children: [
            item('tools.engine', 'Official ADITO transpiler', true, { id: 'tools.engine.official', arg: 'official', check: 'radio', checked: ctx.engine === 'official' }),
            item('tools.engine', 'Experimental Forge engine', true, { id: 'tools.engine.experimental', arg: 'experimental', check: 'radio', checked: ctx.engine === 'experimental' }),
          ],
        },
        later('tools.exportStructure', 'Export Project Structure'),
        {
          id: 'view.theme',
          kind: 'submenu',
          label: 'Theme',
          enabled: true,
          children: [
            item('view.theme', 'Dark (Night Owl)', true, { id: 'view.theme.dark', arg: 'dark', check: 'radio', checked: ctx.theme === 'dark' }),
            item('view.theme', 'Light', true, { id: 'view.theme.light', arg: 'light', check: 'radio', checked: ctx.theme === 'light' }),
          ],
        },
        item('help.localData', 'Local Data...', true),
        item('help.openLogFolder', 'Open Log Folder', true),
        item('help.openBackupFolder', 'Open Backup Folder', true),
        sep(),
        item('tools.plugins', 'Plugins', true),
        sep(),
        item('tools.options', 'Options', true),
      ],
    },
    {
      id: 'window',
      label: 'Window',
      mnemonic: 'w',
      items: [
        windowItem('projects', 'Projects', 'Mod+1'),
        later('window.files', 'Files', { shortcut: 'Mod+2' }),
        later('window.favorites', 'Favorites', { shortcut: 'Mod+3' }),
        windowItem('output', 'Output', 'Mod+4'),
        windowItem('services', 'Services', 'Mod+5'),
        windowItem('scanservices', 'Scan Services'),
        windowItem('navigator', 'Navigator', 'Mod+7'),
        windowItem('editor', 'Editor', 'Mod+0'),
        later('window.debugger', 'Debugger'),
        later('window.palette', 'Palette', { shortcut: 'Mod+Shift+8' }),
        later('window.userhelp', 'Userhelp'),
        windowItem('properties', 'Properties', 'Mod+Shift+7'),
        later('window.bookmarks', 'Bookmarks'),
        sep(),
        {
          id: 'window.ideTools',
          kind: 'submenu',
          label: 'IDE Tools',
          enabled: true,
          children: [
            later('window.ideLog', 'IDE Log'),
            sep(),
            windowItem('notifications', 'Notifications'),
            later('window.exceptionReporter', 'Exception Reporter'),
            later('window.terminal', 'Terminal'),
            later('window.processes', 'Processes'),
            sep(),
            windowItem('problems', 'Problems'),
            windowItem('scm', 'Source Control', 'Mod+Shift+G'),
          ],
        },
        laterSub('window.reportDesigner', 'Report designer'),
        sep(),
        {
          id: 'window.configure',
          kind: 'submenu',
          label: 'Configure Window',
          enabled: true,
          children: [
            later('window.maximize', 'Maximize', { shortcut: 'Shift+Escape' }),
            later('window.floatWindow', 'Float'),
            later('window.minimize', 'Minimize'),
            later('window.dockWindow', 'Dock', { shortcut: 'Alt+Shift+D' }),
            sep(),
            ...FLOAT_ENTRIES.map(([view, label]) => item('window.float', ctx.floating?.includes(view) ? `Dock ${label}` : `Float ${label}`, true, { id: `window.float.${view}`, arg: view })),
            item('window.dockAll', 'Dock All Floating Windows', (ctx.floating?.length ?? 0) > 0),
            item('window.moveEditor', 'Move Editor to New Window', !!ctx.canMoveEditor, { hint: ctx.canMoveEditor ? undefined : 'Open an object or file first' }),
            item('window.dockEditors', 'Dock All Editor Windows', (ctx.editorWindows ?? 0) > 0, { hint: (ctx.editorWindows ?? 0) > 0 ? undefined : 'No editor is in a window of its own' }),
            sep(),
            later('window.clone', 'Clone'),
            later('window.splitDocument', 'Split Document'),
          ],
        },
        item('window.resetLayout', 'Reset Windows', true),
        sep(),
        later('window.closeWindow', 'Close Window', { shortcut: 'Mod+W' }),
        later('window.closeAllDocuments', 'Close All Documents', { shortcut: 'Mod+Shift+W' }),
        later('window.closeOtherDocuments', 'Close Other Documents'),
        laterSub('window.documentGroups', 'Document Groups'),
        later('window.documents', 'Documents...', { shortcut: 'Shift+F4' }),
      ],
    },
    {
      id: 'help',
      label: 'Help',
      mnemonic: 'h',
      items: [
        item('help.checkUpdates', 'Check for Updates', true),
        later('help.bugReport', 'Send Bug Report'),
        sep(),
        later('help.userGuide', 'Show Documentation'),
        sep(),
        item('help.about', 'About Vendira Designer', true),
      ],
    },
  ]
}

/** Enabled entries reachable by a keyboard shortcut, including those inside submenus. */
export function shortcutItems(menus: MenuDef[]): MenuItemDef[] {
  const out: MenuItemDef[] = []
  const walk = (items: MenuItemDef[]) => {
    for (const i of items) {
      if (i.children) walk(i.children)
      if (i.kind === 'item' && i.enabled && i.shortcut && !i.nativeShortcut) out.push(i)
    }
  }
  for (const m of menus) walk(m.items)
  return out
}
