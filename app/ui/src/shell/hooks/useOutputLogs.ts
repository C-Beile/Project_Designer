import { useCallback, useEffect, useState } from 'react'
import { subscribeOutput } from '../../core/outputBus'
import { getOptions } from '../../settings/options'
import type { OutputLine, OutputSubTab } from '../OutputPanel'

const EMPTY_LOGS: Record<OutputSubTab, OutputLine[]> = { database: [], build: [], default: [], nodejs: [] }

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

  const clearLog = useCallback((sub: OutputSubTab) => setLogs((prev) => ({ ...prev, [sub]: [] })), [])

  return { logs, appendLog, clearLog }
}
