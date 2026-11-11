import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { promptDialog } from '../../core/dialogService'
import { errorText } from '../../core/errorText'
import { dismissToast, notify } from '../../core/notifications'
import { refreshScm } from '../../core/scm'
import { diffTitle } from './diffTitle'
import type { SyncResult } from './SyncDialog'
import type { DiffTarget, GitCommit, GitOutput, TreeNode } from '../../wire/types'
import type { PullResult } from './PullResultDialog'
import { useOsDialog } from '../../windows/useOsDialog'
import type { CommandMap } from '../../shell/hooks/commandTypes'
import type { ShellDialog } from '../../shell/hooks/dialogTypes'
import type { SyncWindowResult } from './GitWindows'

export interface GitDeps {
  api: ForgeApi
  root: string
  branch: string | null
  dialog: ShellDialog
  setDialog: Dispatch<SetStateAction<ShellDialog>>
  setReloadToken: (update: (t: number) => number) => void
  handleOpen: (node: TreeNode, top?: TreeNode) => Promise<void>
}

export type GitTarget = { local?: string; remote?: string } | null

// Team > Git: the Commit dialog and the history and branch views open as dialogs, Pull and Push run
// directly from the menu click, as in the original Designer.
export function useGit({ api, root, branch, dialog, setDialog, setReloadToken, handleOpen }: GitDeps) {
  const [gitView, setGitView] = useState<{ tab: 'changes' | 'history' | 'branches'; target: GitTarget }>({ tab: 'changes', target: null })
  const [syncMode, setSyncMode] = useState<'pull' | 'push'>('pull')
  const hasProject = root.trim() !== ''
  const [pulling, setPulling] = useState(false)
  const pullingRef = useRef(false)
  const [pullResult, setPullResult] = useState<PullResult | null>(null)

  const openGit = useCallback((tab: 'changes' | 'history' | 'branches', target: { local?: string; remote?: string } | null = null) => {
    setGitView({ tab, target })
    setDialog('git')
  }, [setDialog])
  const notifySync = useCallback((mode: 'pull' | 'push', r: SyncResult) => {
    const label = mode === 'pull' ? 'Pull' : 'Push'
    const onBranch = branch ? ` on branch ${branch}` : ''
    if (r.ok) {
      const what = mode === 'pull' ? 'merged' : 'pushed'
      notify(r.commits > 0 ? `${label} finished${onBranch}: ${r.commits} commit${r.commits === 1 ? '' : 's'} ${what}.` : `${label} finished${onBranch}: nothing to ${mode === 'pull' ? 'merge' : 'push'}.`, { kind: 'success' })
    } else {
      notify(`${label} failed${onBranch}: ${r.text.split('\n').find((l) => l.trim()) || 'see the output'}`, { kind: 'error', timeoutMs: 12000 })
    }
  }, [branch])
  const runGit = useCallback(
    async (label: string, action: () => Promise<GitOutput>) => {
      try {
        const result = await action()
        if (result.ok) {
          notify(`${label} finished.`, { kind: 'success' })
          setReloadToken((t) => t + 1)
        } else notify(result.text.split('\n')[0] || `${label} failed.`, { kind: 'error', timeoutMs: 10000 })
      } catch (e) {
        notify(errorText(e), { kind: 'error', timeoutMs: 10000 })
      }
      if (root.trim()) void refreshScm(api, root)
    },
    [api, root, setReloadToken],
  )

  // Pull without a window: the notification says whether anything new came in, and when the dependency files
  // changed it says so too, so the user knows right away that `npm install` is due.
  const runPull = useCallback(async () => {
    if (pullingRef.current) return
    pullingRef.current = true
    setPulling(true)
    const onBranch = branch ? ` on branch ${branch}` : ''
    // Shown until the pull is over, so it is clear that something is happening.
    const progress = notify(`Pulling${onBranch}...`, { kind: 'info', timeoutMs: 0 })
    try {
      // What is coming in, read before the pull (it fetches first): who changed what.
      const incoming: GitCommit[] = await api.gitIncoming(root).catch(() => [])
      const r = await api.gitPull(root)
      dismissToast(progress)
      if (!r.ok) {
        notify(`Pull failed${onBranch}: ${r.text.split('\n').find((l) => l.trim()) || 'see the output'}`, { kind: 'error', timeoutMs: 12000 })
      } else if (/already up[ -]to[ -]date/i.test(r.text)) {
        notify(`Pull finished${onBranch}: nothing new, everything is up to date.`, { kind: 'success' })
      } else {
        const touched = await Promise.all(incoming.slice(0, 30).map((c) => api.scmCommitFiles(root, c.hash).catch(() => [])))
        const dependencies = /(^|[\s/|])package(-lock)?\.json\b/.test(r.text) || touched.some((files) => files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f.path)))
        const authors = [...new Set(incoming.map((c) => c.author))]
        const summary = incoming.length > 0 ? `${incoming.length} new commit${incoming.length === 1 ? '' : 's'} from ${authors.join(', ')}` : 'new changes were merged'
        notify(`Pull finished${onBranch}: ${summary}.${dependencies ? ' package.json changed: run npm install.' : ''}`, {
          kind: 'success',
          timeoutMs: 20000,
          actions: [{ label: 'Show changes', run: () => setPullResult({ branch, commits: incoming, dependenciesChanged: dependencies }) }],
        })
        setReloadToken((t) => t + 1)
      }
    } catch (e) {
      dismissToast(progress)
      notify(errorText(e), { kind: 'error', timeoutMs: 10000 })
    } finally {
      pullingRef.current = false
      setPulling(false)
    }
    if (root.trim()) void refreshScm(api, root)
  }, [api, root, branch, setReloadToken])

  // Diff of a Source Control file as an editor tab (service-like tab: no file behind it).
  const openDiff = useCallback(
    (target: DiffTarget) => {
      const node: TreeNode = {
        id: `diff:${target.side}:${target.hash ?? ''}:${target.path}`,
        label: diffTitle(target),
        object_type: null,
        is_leaf: true,
        children: [],
        kind: 'service',
        diff: target,
      }
      void handleOpen(node)
    },
    [handleOpen],
  )

  // Status bar branch quick pick: a click on a branch is the confirmation, so it switches right away.
  const quickBranch = useCallback(
    async (t: { local?: string; remote?: string }) => {
      if (!root.trim()) return
      try {
        if (t.local) {
          const r = await api.gitCheckout(root, t.local)
          if (r.ok) notify(`Switched to ${t.local}.`, { kind: 'success' })
          else notify(r.text.split('\n')[0] || 'The branch could not be switched.', { kind: 'error', timeoutMs: 10000 })
        } else {
          const name = await promptDialog(t.remote ? `Create a local branch from ${t.remote}.` : 'Create a new branch from the current commit and switch to it.', {
            title: 'New Branch',
            label: 'Branch name',
            initial: t.remote ? t.remote.replace(/^[^/]+\//, '') : '',
            okLabel: 'Create',
            validate: (v) => (v.trim() === '' || /^[A-Za-z0-9._/-]+$/.test(v.trim()) ? null : 'Use letters, digits and _ - . / only.'),
          })
          if (!name) return
          const r = await api.gitCreateBranch(root, name.trim(), t.remote ?? null)
          if (r.ok) notify(`Created and switched to ${name.trim()}.`, { kind: 'success' })
          else notify(r.text.split('\n')[0] || 'The branch could not be created.', { kind: 'error', timeoutMs: 10000 })
        }
      } catch (e) {
        notify(errorText(e), { kind: 'error', timeoutMs: 10000 })
      }
      setReloadToken((x) => x + 1)
      void refreshScm(api, root)
    },
    [api, root, setReloadToken],
  )

  useOsDialog<{ changed?: boolean; message?: string; ok?: boolean }>(
    dialog === 'git' && hasProject,
    () => ({ name: 'git', title: gitView.tab === 'changes' ? 'Commit' : gitView.tab === 'history' ? 'Log' : 'Branches', size: { width: 1100, height: 760 }, payload: { project: root, tab: gitView.tab, target: gitView.target } }),
    (r) => {
      if (r?.changed) setReloadToken((t) => t + 1)
      if (r?.message) notify(r.message, { kind: r.ok ? 'success' : 'error', timeoutMs: r.ok ? undefined : 12000 })
      if (root.trim()) void refreshScm(api, root)
    },
    () => setDialog((d) => (d === 'git' ? null : d)),
  )

  useOsDialog<SyncWindowResult>(
    dialog === 'sync' && hasProject,
    () => ({ name: 'sync', title: syncMode === 'pull' ? 'Pull' : 'Push', size: { width: 1200, height: 800 }, payload: { project: root, mode: syncMode } }),
    (r) => {
      if (r) {
        if (r.changed) setReloadToken((t) => t + 1)
        notifySync(r.mode, r.result)
      }
      if (root.trim()) void refreshScm(api, root)
    },
    () => setDialog((d) => (d === 'sync' ? null : d)),
  )

  const commands: CommandMap = {
    'team.commit': () => {
      openGit('changes')
    },
    'team.pullView': () => {
      setSyncMode('pull')
      setDialog('sync')
    },
    'team.pushView': () => {
      setSyncMode('push')
      setDialog('sync')
    },
    'team.pull': () => {
      void runPull()
    },
    'team.push': () => {
      void runGit('Push', () => api.gitPush(root))
    },
    'team.switchBranch': () => {
      openGit('branches')
    },
    'team.history': () => {
      openGit('history')
    },
  }

  return { gitView, syncMode, pulling, pullResult, setPullResult, openGit, notifySync, runGit, openDiff, quickBranch, commands }
}
