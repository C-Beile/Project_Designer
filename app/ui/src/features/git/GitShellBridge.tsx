import { useEffect, useMemo, useRef, useState } from 'react'
import { notify } from '../../core/notifications'
import { registerCommand, setPluginData, type ShellExtensionContext } from '../../core/plugins/registry'
import { refreshScm, useScm } from '../../core/scm'
import type { DiffTarget } from '../../wire/types'
import { osWindowsAvailable } from '../../windows/windowService'
import { GitDialog } from './GitDialog'
import type { GitStatusAction, GitStatusData } from './GitStatusItem'
import { SyncDialog } from './SyncDialog'
import { PullResultDialog } from './PullResultDialog'
import { useGit } from './useGit'

/**
 * Shell-Beitrag des Git-Plugins (die Shell rendert ihn über das Register): hält den Git-Zustand,
 * meldet die `team.*`-Befehle an, füllt das Statusfeld und zeigt die eingebetteten Dialoge.
 */
export function GitShellBridge({ api, root, hasProject, reloadToken, setReloadToken, dialog, setDialog, handleOpen, isPluginActive }: ShellExtensionContext) {
  const gitActive = isPluginActive('git')
  const scm = useScm()
  const [branch, setBranch] = useState<string | null>(null)
  const { gitView, syncMode, pulling, pullResult, setPullResult, notifySync, openGit, quickBranch, openDiff, commands } = useGit({ api, root, branch, dialog, setDialog, setReloadToken, handleOpen })

  // Aktueller Branch des Projekts.
  useEffect(() => {
    setBranch(null)
    if (!root.trim()) return
    let cancelled = false
    api
      .getCurrentBranch(root)
      .then((b) => {
        if (!cancelled) setBranch(b)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api, root, reloadToken])

  // Git status of the active project: after opening, after reloads, after saves and when the window gets focus.
  useEffect(() => {
    if (gitActive && root.trim()) void refreshScm(api, root)
  }, [api, root, reloadToken, gitActive])
  useEffect(() => {
    if (!gitActive) return
    let timer: number | undefined
    const onFocus = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => root.trim() && void refreshScm(api, root), 300)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [api, root, gitActive])

  // Befehle einmal anmelden; sie rufen die Handler der letzten Render-Runde.
  const handlers = useRef({ commands, openDiff, quickBranch })
  handlers.current = { commands, openDiff, quickBranch }
  useEffect(() => {
    const offs = Object.keys(handlers.current.commands).map((id) => registerCommand(id, (arg) => handlers.current.commands[id]?.(arg as string | undefined), 'git'))
    offs.push(registerCommand('git.openDiff', (target) => handlers.current.openDiff(target as DiffTarget), 'git'))
    return () => offs.forEach((off) => off())
  }, [])

  // Daten des Branch-Knopfes in der Statusleiste.
  const statusData = useMemo<GitStatusData>(
    () => ({
      branch: scm.root === root && scm.overview ? scm.overview.branch : branch,
      gitEnabled: gitActive && hasProject && !(scm.root === root && scm.error),
      pulling,
      loadBranches: () => api.gitOverview(root),
      onCheckoutBranch: (t) => void quickBranch(t),
      onGit: (a: GitStatusAction) => (a === 'newBranch' ? void quickBranch({}) : openGit('branches')),
    }),
    [scm.root, scm.overview, scm.error, root, branch, gitActive, hasProject, pulling, api, quickBranch, openGit],
  )
  useEffect(() => {
    setPluginData('git', statusData)
  }, [statusData])
  useEffect(() => () => void setPluginData('git', undefined), [])

  return (
    <>
      {dialog === 'git' && hasProject && !osWindowsAvailable() ? (
        <GitDialog api={api} projectRoot={root} initialTab={gitView.tab} initialTarget={gitView.target} onClose={() => setDialog(null)} onChanged={() => setReloadToken((t) => t + 1)} onResult={(message, ok) => notify(message, { kind: ok ? 'success' : 'error', timeoutMs: ok ? undefined : 12000 })} />
      ) : null}
      {pullResult ? <PullResultDialog api={api} root={root} result={pullResult} onClose={() => setPullResult(null)} /> : null}
      {dialog === 'sync' && hasProject && !osWindowsAvailable() ? <SyncDialog api={api} projectRoot={root} mode={syncMode} onClose={() => setDialog(null)} onDone={() => setReloadToken((t) => t + 1)} onResult={(r) => notifySync(syncMode, r)} /> : null}
    </>
  )
}
