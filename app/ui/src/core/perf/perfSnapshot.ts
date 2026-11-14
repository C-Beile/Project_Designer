import { copyText } from '../clipboard'
import { notify } from '../notifications'
import { registerCommand, registerMenuContribution } from '../plugins/registry'
import { item } from '../../shell/menuModel'

const COMMAND = 'debug.perfSnapshot'

interface MemoryInfo {
  usedJSHeapSize: number
}

export interface PerfSnapshot {
  at: string
  window: string
  marks: Record<string, number>
  navigation: { domContentLoadedMs: number; loadMs: number } | null
  usedJsHeapMb: number | null
  domNodes: number
  resources: { count: number; transferKb: number }
}

/** Messwerte dieses Fensters: Marken (ms seit Start), JS-Speicher, DOM-Größe, geladene Dateien. */
export function takePerfSnapshot(): PerfSnapshot {
  const marks: Record<string, number> = {}
  for (const m of performance.getEntriesByType('mark')) if (m.name.startsWith('designer:')) marks[m.name.slice('designer:'.length)] = Math.round(m.startTime)
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const memory = (performance as unknown as { memory?: MemoryInfo }).memory
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  return {
    at: new Date().toISOString(),
    window: `${window.location.pathname}${window.location.search}`,
    marks,
    navigation: nav ? { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd) } : null,
    usedJsHeapMb: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
    domNodes: document.getElementsByTagName('*').length,
    resources: { count: resources.length, transferKb: Math.round(resources.reduce((sum, r) => sum + r.transferSize, 0) / 1024) },
  }
}

/** Debug > Perf Snapshot: kopiert die Messwerte als JSON in die Zwischenablage (für die Vorher/Nachher-Tabelle im Plan). */
export function registerPerfSnapshot(): () => void {
  const offs = [
    registerCommand(COMMAND, () => {
      const json = JSON.stringify(takePerfSnapshot(), null, 2)
      void copyText(json).then((ok) => notify(ok ? 'Perf snapshot copied to the clipboard.' : 'Perf snapshot could not be copied.', { kind: ok ? 'info' : 'error' }))
    }),
    registerMenuContribution({ menu: 'debug', order: 90, items: [item(COMMAND, 'Perf Snapshot', true, { hint: 'Copy start time, memory and DOM size of this window as JSON' })] }),
  ]
  return () => offs.forEach((off) => off())
}
