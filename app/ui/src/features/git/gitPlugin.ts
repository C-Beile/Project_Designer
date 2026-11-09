import { createElement } from 'react'
import { registerDialog, registerMenuContribution, registerOptionsPage, registerPlugin, registerShellExtension, registerToolbarItem, type ToolbarContext } from '../../core/plugins/registry'
import { setScmProvider } from '../../core/scm'
import { IconCommit, IconHistory, IconPull, IconPush } from '../../shell/icons'
import { item, NO_PROJECT_HINT, type MenuContext, type MenuItemDef } from '../../shell/menuModel'
import { CommitDiffDialog } from './CommitDiffDialog'
import { GitOptionsPage } from './GitOptionsPage'
import { GitShellBridge } from './GitShellBridge'
import { GitWindow, SyncWindow } from './GitWindows'
import { LazyDiffView } from './LazyDiffView'
import { ScmPanel } from './ScmPanel'
import { registerGitStatusItem } from './GitStatusItem'

/** Menü Team: Git und History. Aktiv-Zustand und Hinweise wie vorher aus `hasProject`/`gitActive`. */
function teamItems(ctx: MenuContext): MenuItemDef[] {
  const gitActive = ctx.gitActive !== false
  const teamOn = ctx.hasProject && gitActive
  const teamHint = !gitActive ? 'The Git plugin is deactivated (Tools > Plugins)' : ctx.hasProject ? undefined : NO_PROJECT_HINT
  return [
    { id: 'team.sep.git', kind: 'separator', label: '', enabled: false },
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
    { id: 'team.sep.history', kind: 'separator', label: '', enabled: false },
    {
      id: 'team.historyMenu',
      kind: 'submenu',
      label: 'History',
      enabled: teamOn,
      hint: teamHint,
      children: [item('team.history', 'Show Project History', teamOn, { hint: teamHint })],
    },
  ]
}

/** Toolbar-Knopf der Gruppe 'git': aktiv mit Projekt und eingeschaltetem Plugin, sonst mit Grund im Tooltip. */
function gitButton(what: string) {
  return (ctx: ToolbarContext) => ({
    enabled: ctx.hasProject && ctx.pluginActive,
    hint: !ctx.pluginActive ? `${what} (Git plugin deactivated)` : ctx.hasProject ? what : `${what} (open a project first)`,
  })
}

/** Meldet das Git-Plugin und seine UI-Beiträge im Register an (einmal beim Start). */
export function registerGitPlugin(): () => void {
  const offs = [
    registerPlugin({
      id: 'git',
      name: 'Git',
      category: 'ADITO / VCS',
      version: '1.0.0-rc11',
      description: 'Commit, Pull, Push, Switch Branch and History through the Team menu.',
      switchable: true,
    }),
    registerMenuContribution({ plugin: 'git', menu: 'team', order: 10, items: teamItems }),
    // Zwischen Keymap (40) und Appearance (50) wie die feste Kategorie vorher.
    registerOptionsPage({ plugin: 'git', id: 'git', category: 'team', title: 'Team', order: 45, component: GitOptionsPage }),
    registerToolbarItem({ plugin: 'git', id: 'git.pull', group: 'git', order: 10, label: 'Pull', icon: createElement(IconPull), command: 'team.pull', state: gitButton('Pull: fetch and merge new commits of the remote, the result shows as a notification') }),
    registerToolbarItem({ plugin: 'git', id: 'git.commit', group: 'git', order: 20, label: 'Commit Changed Files', icon: createElement(IconCommit), command: 'team.commit', state: gitButton('Commit Changed Files') }),
    registerToolbarItem({ plugin: 'git', id: 'git.push', group: 'git', order: 30, label: 'Push', icon: createElement(IconPush), command: 'team.pushView', state: gitButton('Push: choose the local commits to push') }),
    registerToolbarItem({ plugin: 'git', id: 'git.history', group: 'git', order: 40, label: 'Show Project History', icon: createElement(IconHistory), command: 'team.history', state: gitButton('Show Project History') }),
    registerGitStatusItem(),
    // Quelle des Source-Control-Standes im Kern (`core/scm`).
    setScmProvider((api, root) => api.scmStatus(root)),
    // Dialoge und Panels, die der Kern über `getDialog(id)` holt.
    registerDialog({ plugin: 'git', id: 'git.window', component: GitWindow }),
    registerDialog({ plugin: 'git', id: 'git.syncWindow', component: SyncWindow }),
    registerDialog({ plugin: 'git', id: 'git.commitDiff', component: CommitDiffDialog }),
    registerDialog({ plugin: 'git', id: 'git.scmPanel', component: ScmPanel }),
    registerDialog({ plugin: 'git', id: 'git.diffView', component: LazyDiffView }),
    registerShellExtension({ plugin: 'git', id: 'git.shell', order: 10, component: GitShellBridge }),
  ]
  return () => offs.forEach((off) => off())
}
