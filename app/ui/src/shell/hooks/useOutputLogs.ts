import { useCallback, useEffect, useState } from 'react'
import { subscribeOutput } from '../../core/outputBus'
import { listenBackend } from './backendEvent'
import { getOptions } from '../../settings/options'
import type { OutputLine, OutputSubTab } from '../OutputPanel'

const EMPTY_LOGS: Record<OutputSubTab, OutputLine[]> = { ide: [], database: [], build: [], default: [], nodejs: [] }

/** Bereich einer Log-Meldung: bei Plugin-Fehlern der Plugin-Name, sonst aus der Art abgeleitet. */
export function areaOf(kind: string, message: string): string {
  const plugin = message.match(/^plugin_call ([\w-]+)\./)
  if (plugin) return plugin[1]
  if (kind === 'UI-ERROR') return 'ui'
  if (message.startsWith('index ')) return 'index'
  if (kind === 'PERF') return 'perf'
  return 'app'
}

// Zeilen der Output-Tabs; neue Zeilen kommen auch vom outputBus.
export function useOutputLogs() {
  const [logs, setLogs] = useState(EMPTY_LOGS)

  const appendLog = useCallback((sub: OutputSubTab, lines: OutputLine[]) => {
    const max = getOptions().misc.outputMaxLines
    setLogs((prev) => {
      const next = [...prev[sub], ...lines]
      return { ...prev, [sub]: next.length > max ? next.slice(next.length - max) : next }
    })
  }, [])

  useEffect(() => subscribeOutput((sub, lines) => appendLog(sub, lines)), [appendLog])

  // Live-Protokoll: jeder Eintrag, den das Backend in die Log-Datei schreibt, erscheint auch im Reiter "IDE Log".
  useEffect(
    () =>
      listenBackend('forge://log-entry', (p) => {
        const e = p as { time?: string; kind?: string; message?: string }
        if (!e || typeof e.message !== 'string') return
        const kind = String(e.kind ?? 'INFO')
        const level: OutputLine['level'] = /PANIC|ERROR/.test(kind) ? 'error' : kind === 'WARN' ? 'warn' : 'info'
        const time = String(e.time ?? '').slice(11, 19)
        appendLog('ide', [{ text: `${time} ${kind}: ${e.message}`, level, kind, area: areaOf(kind, e.message) }])
      }),
    [appendLog],
  )

  const clearLog = useCallback((sub: OutputSubTab) => setLogs((prev) => ({ ...prev, [sub]: [] })), [])

  return { logs, appendLog, clearLog }
}
