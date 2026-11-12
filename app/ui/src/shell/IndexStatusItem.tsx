import { useEffect, useState } from 'react'
import { INDEX_READY_SHOWN_MS, openIndexLog, summarizeIndex, useIndexStatus } from '../core/indexStatus'
import { ProgressBar } from '../core/ui/ProgressBar'

/** Statusleisten-Eintrag des Projekt-Index: Fortschritt beim Aufbau, danach kurz "Index ready". */
export function IndexStatusItem() {
  const { projects } = useIndexStatus()
  const [now, setNow] = useState(() => Date.now())
  const list = Object.values(projects)
  const summary = summarizeIndex(list, now)

  // Das "ready" verschwindet nach ein paar Sekunden von selbst.
  useEffect(() => {
    if (list.every((p) => p.readyAt === null)) return
    setNow(Date.now())
    const timer = window.setTimeout(() => setNow(Date.now()), INDEX_READY_SHOWN_MS + 50)
    return () => window.clearTimeout(timer)
  }, [projects])

  if (!summary) return null
  return (
    <button type="button" className="forge-status-btn forge-index-status" title={`${summary.tooltip} (click to open the IDE Log)`} onClick={openIndexLog}>
      <span className="forge-index-status-text">{summary.text}</span>
      {summary.kind === 'busy' ? <ProgressBar percent={summary.percent} label="Project index" /> : null}
    </button>
  )
}
