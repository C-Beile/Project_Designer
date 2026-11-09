import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { confirmDialog } from '../../core/dialogService'
import { errorText } from '../../core/errorText'
import { notify } from '../../core/notifications'
import { problemsFromBuildLog, setProblems } from '../../problems/problemStore'
import { DEFAULT_ENGINE, ENGINE_LABELS, transpileParams, type TranspileMode, type TranspilerEngineId } from '../../settings/transpilerEngine'
import type { CompareReport, TreeNode } from '../../wire/types'
import type { OutputLine, OutputSubTab } from '../OutputPanel'
import type { BuildProgress, BuildResult } from '../TranspileProgress'
import { listenBackend } from './backendEvent'
import type { CommandMap } from './commandTypes'
import { timestamp } from './timestamp'

const referenceKey = (project: string) => `dito.transpile.reference.${project}`
const storedReference = (project: string) => {
  try {
    return window.localStorage.getItem(referenceKey(project)) ?? ''
  } catch {
    return ''
  }
}

export interface TranspileDeps {
  api: ForgeApi
  root: string
  trees: Record<string, TreeNode[]>
  installDir: string | null
  appendLog: (sub: OutputSubTab, lines: OutputLine[]) => void
  showToolWindow: (id: 'output', focus?: boolean) => void
  setOutputSub: (sub: OutputSubTab) => void
  setStatus: (text: string) => void
}

// Transpile (Engine, Fortschritt, Ergebnis), Vergleich mit der Referenz und Abbruch.
export function useTranspile({ api, root, trees, installDir, appendLog, showToolWindow, setOutputSub, setStatus }: TranspileDeps) {
  const [engine, setEngine] = useState<TranspilerEngineId>(DEFAULT_ENGINE)
  const [transpileRunning, setTranspileRunning] = useState(false)
  const [matchView, setMatchView] = useState<{ report: CompareReport; reference: string; project: string } | null>(null)
  // Compares the transpiled output with the official output the user named for this project.
  const compareWithReference = async (project: string, choose: boolean): Promise<CompareReport | null> => {
    let reference = choose ? '' : storedReference(project)
    if (!reference) {
      const picked = await api.pickProjectFolder('Reference output of the official transpiler (dist)').catch(() => null)
      if (!picked) return null
      reference = picked
      try {
        window.localStorage.setItem(referenceKey(project), reference)
      } catch {
        // the choice is just not remembered
      }
    }
    const report = await api.transpileCompare(reference, project)
    setMatchView({ report, reference, project })
    return report
  }

  const busy = useRef(false)
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null)
  useEffect(() => {
    if (!buildResult?.ok) return
    const timer = window.setTimeout(() => setBuildResult(null), 25000)
    return () => window.clearTimeout(timer)
  }, [buildResult])
  // How far the built-in transpiler is: a bar with the percentage in the corner panel.
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null)
  const lastProgressLog = useRef({ step: '', percent: -10 })

  const transpile = useCallback(
    async (mode: TranspileMode, project: string = root): Promise<boolean> => {
      if (!project.trim() || busy.current) return false
      // A module is not built on its own: it only needs a transpile when its package.json changed.
      if (trees[project]?.some((n) => n.module_project) && !(await confirmDialog('This is a module project. A module is normally not built; transpile it only when its package.json changed. Transpile anyway?', { title: 'Transpile module project', okLabel: 'Transpile', cancelLabel: 'Cancel' }))) return false
      busy.current = true
      setBuildResult(null)
      setBuildProgress(null)
      lastProgressLog.current = { step: '', percent: -10 }
      setProblems('build', [])
      setTranspileRunning(true)
      showToolWindow('output', false)
      setOutputSub('build')
      const started = Date.now()
      appendLog('build', [
        { level: 'info', text: `[${timestamp()}] Transpile (${mode}) started - ${ENGINE_LABELS[engine]} - ${project}` },
      ])
      try {
        await api.executeAction('transpile', project, transpileParams(engine, mode, installDir))
        const secs = ((Date.now() - started) / 1000).toFixed(1)
        appendLog('build', [{ level: 'success', text: `[${timestamp()}] BUILD SUCCESS (${secs} s)` }])
        setStatus('Transpile finished.')
        setBuildResult({ ok: true, seconds: secs, project })
        const reference = storedReference(project)
        if (reference) {
          void api
            .transpileCompare(reference, project)
            .then((r) => setBuildResult((b) => (b && b.project === project ? { ...b, match: r.percent } : b)))
            .catch(() => {})
        }
        return true
      } catch (e) {
        const message = errorText(e)
        appendLog('build', [{ level: 'error', text: `[${timestamp()}] BUILD FAILED: ${message}` }])
        const found = problemsFromBuildLog(message)
        setProblems(
          'build',
          found.length > 0
            ? found
            : [{ id: 'build|failed', channel: 'build', source: 'build', severity: 'Error', message: message.split(/\r?\n/)[0].slice(0, 400) }],
        )
        setStatus('Transpile failed, see Output > Build.')
        setBuildResult({ ok: false, seconds: ((Date.now() - started) / 1000).toFixed(1), project, message: message.split(/\r?\n/)[0].slice(0, 200) })
        return false
      } finally {
        busy.current = false
        setTranspileRunning(false)
      }
    },
    [api, root, engine, installDir, appendLog, showToolWindow, trees],
  )

  // Live lines of the official transpiler (DEBUG, INFO ...) go to Output > Build while it runs.
  useEffect(
    () =>
      listenBackend('forge://build-output', (p) => {
        const e = p as { line: string; error: boolean }
        appendLog('build', [{ level: e.error ? 'warn' : 'info', text: e.line }])
      }),
    [appendLog],
  )
  useEffect(
    () =>
      listenBackend('forge://transpile-progress', (p) => {
        const e = p as { percent: number; stage: string }
        const percent = Math.max(0, Math.min(100, Math.round(e.percent)))
        setBuildProgress({ percent, stage: e.stage })
        // Output > Build gets a line whenever a new step starts and while a long step moves on (every 5 %).
        const step = e.stage.replace(/\s*\(.*$/, '')
        const last = lastProgressLog.current
        if (e.percent <= 1 || last.step !== step || percent >= last.percent + 5) {
          lastProgressLog.current = { step, percent }
          appendLog('build', [{ level: 'info', text: `[${timestamp()}] ${String(percent).padStart(3)} %  ${e.stage}` }])
        }
      }),
    [appendLog],
  )

  const cancelBuild = useCallback(async () => {
    if (!(await confirmDialog('Stop the running build? The transpiler process is ended; dist may be incomplete afterwards.', { title: 'Cancel build', okLabel: 'Stop build', cancelLabel: 'Keep running' }))) return
    await api.cancelBuild().catch(() => false)
  }, [api])

  const commands: CommandMap = {
    'tools.compareReference': async () => {
      try {
        await compareWithReference(root, storedReference(root) === '')
      } catch (e) {
        notify(errorText(e), { kind: 'error', timeoutMs: 10000 })
      }
    },
    'tools.transpilePartial': async () => {
      await transpile('partial')
    },
    'tools.transpileFull': async () => {
      await transpile('full')
    },
    'tools.engine': (arg) => {
      if (arg === 'official' || arg === 'experimental') setEngine(arg)
    },
  }

  return { engine, setEngine, transpileRunning, matchView, setMatchView, buildResult, setBuildResult, buildProgress, compareWithReference, transpile, cancelBuild, commands }
}
