import { useCallback, useEffect, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { notify } from '../../core/notifications'
import { useSystemTunnels } from '../../services/useSystemTunnels'
import { getTunnelState, setProgress, setSystemsDb, systemNameOf, useTunnelState } from '../../services/tunnelState'
import type { DbStatus, TreeNode } from '../../wire/types'
import type { OutputLine, OutputSubTab } from '../OutputPanel'
import { listenBackend } from './backendEvent'
import { timestamp } from './timestamp'

export const NO_DB: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
const DB_POLL_MS = 5000

// Verbindungsstatus der aktiven Datenbank (wird abgefragt, damit ein sterbender Tunnel auffällt)
// und Tunnel-Phasen beim Verbinden.
export function useDbStatus(
  api: ForgeApi,
  projects: string[],
  trees: Record<string, TreeNode[]>,
  appendLog: (sub: OutputSubTab, lines: OutputLine[]) => void,
) {
  const [db, setDb] = useState<DbStatus>(NO_DB)
  const tunnelState = useTunnelState()
  useSystemTunnels(api, projects, trees)
  const [nowTick, setNowTick] = useState(0)
  const connectingCount = Object.keys(tunnelState.progressBy).length
  useEffect(() => {
    if (connectingCount === 0) return
    const t = setInterval(() => setNowTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [connectingCount])
  const changeDb = useCallback(
    (next: DbStatus) => {
      setDb(next)
      void api.dbSystems().then(setSystemsDb).catch(() => {})
    },
    [api],
  )
  const clearDb = useCallback(() => setDb(NO_DB), [])

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      api
        .dbSystems()
        .then((list) => {
          if (cancelled) return
          setSystemsDb(list)
          const s = list.find((e) => e.active)?.status ?? NO_DB
          setDb((prev) => (prev.connected === s.connected && prev.tunnel_up === s.tunnel_up && prev.database === s.database ? prev : s))
        })
        .catch(() => {})
    void poll()
    const timer = setInterval(poll, DB_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api])

  // Phases of a connect (Starting ssh/plink, Forwarding the port, Waiting for the database) as they
  // happen: the tree dot, status bar and editors show them, Output > Default gets one line each.
  useEffect(
    () =>
      listenBackend('forge://tunnel-progress', (p) => {
        const e = p as { system: string; phase: string; finished: boolean }
        const label = systemNameOf(e.system) || 'database'
        const started = getTunnelState().progressBy[e.system]?.startedAt
        setProgress(e.system, e.phase, e.finished)
        if (e.finished && e.phase === 'Connected') {
          const secs = started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0
          appendLog('default', [{ level: 'success', text: `[${timestamp()}] ${label}: Connected in ${secs} s` }])
        } else if (e.finished) {
          appendLog('default', [{ level: 'error', text: `[${timestamp()}] ${label}: ${e.phase}` }])
          notify(`${label}: ${e.phase.replace(/^Failed: /, '')}`, { kind: 'error', timeoutMs: 10000 })
        } else {
          appendLog('default', [{ level: 'info', text: `[${timestamp()}] ${label}: ${e.phase}...` }])
        }
      }),
    [appendLog],
  )

  return { db, changeDb, clearDb, tunnelState, nowTick }
}
