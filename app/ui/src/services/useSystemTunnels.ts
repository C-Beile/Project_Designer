import { useEffect, useRef } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { TreeNode } from '../wire/types'
import { textField } from '../wire/types'
import { resolvePathVariables } from '../properties/pathVariables'
import { getTunnelState, setForwardFor, setUnconfigured, setSystemsDb, setTunnelError, systemKey, tunnelConnecting } from './tunnelState'

// One source of truth per system and project: is the tunnel to its database open (tunnel manager),
// is a database session connected, did something fail. The shell polls the tunnel state of every
// system of every open project. When the tunnel stands and no session exists, the session is opened
// by itself (read-only, credentials read from the server config only for that moment); when the
// tunnel closes, the session is closed. A closed project drops its sessions.

interface SystemRefs {
  project: string
  name: string
  tunnelRef: string
  serverRef: string
}

export const SYSTEM_TUNNEL_POLL_MS = 3000
const RETRY_AFTER_FAILURE_MS = 15000

export function systemNodesOf(tops: TreeNode[]): TreeNode[] {
  const top = tops[0]
  return (top?.children.find((c) => c.folder === 'system')?.children ?? []).filter((n) => n.object_type === 'system' && !n.id.startsWith('missing:'))
}

export function useSystemTunnels(api: ForgeApi, projects: string[], trees: Record<string, TreeNode[]>): void {
  const refsCache = useRef(new Map<string, Promise<SystemRefs | null>>())
  const failedAt = useRef(new Map<string, number>())
  const known = useRef<string[]>([])
  const latest = useRef({ projects, trees })
  latest.current = { projects, trees }

  useEffect(() => {
    const gone = known.current.filter((p) => !projects.includes(p))
    known.current = projects
    if (gone.length === 0) return
    void (async () => {
      for (const project of gone) {
        const prefix = systemKey(project, '')
        for (const e of await api.dbSystems().catch(() => [])) if (e.system.startsWith(prefix)) await api.dbDisconnect(e.system).catch(() => {})
        for (const k of [...refsCache.current.keys()]) if (k.startsWith(prefix)) refsCache.current.delete(k)
      }
      setSystemsDb(await api.dbSystems().catch(() => []))
    })()
  }, [api, projects])

  useEffect(() => {
    let cancelled = false
    let busy = false
    const refsOf = (project: string, node: TreeNode): Promise<SystemRefs | null> => {
      const key = systemKey(project, node.label)
      let p = refsCache.current.get(key)
      if (!p) {
        p = api
          .getPropertyTree(node.id)
          .then((t) => ({ project, name: node.label, tunnelRef: textField(t, 'tunnelConfigPath') ?? '', serverRef: textField(t, 'serverConfigPath') ?? '' }))
          .catch(() => null)
        refsCache.current.set(key, p)
      }
      return p
    }
    const tick = async () => {
      if (busy || cancelled) return
      busy = true
      try {
        const { projects: open, trees: all } = latest.current
        for (const project of open) {
          for (const node of systemNodesOf(all[project] ?? [])) {
            const refs = await refsOf(project, node)
            if (!refs || cancelled) continue
            const key = systemKey(project, refs.name)
            if (!refs.tunnelRef || !refs.serverRef) {
              setForwardFor(key, false)
              setUnconfigured(key, true)
              continue
            }
            setUnconfigured(key, false)
            const st = await api.systemTunnelState(project, refs.tunnelRef, refs.serverRef).catch(() => null)
            if (!st || cancelled) continue
            setForwardFor(key, st.db_tunnel_up)
            const session = getTunnelState().bySystem[key]
            if (st.db_tunnel_up && !session?.connected && !(getTunnelState().connectingBy[key] > 0)) {
              const last = failedAt.current.get(key) ?? 0
              if (Date.now() - last < RETRY_AFTER_FAILURE_MS) continue
              const tunnel = resolvePathVariables('tunnelConfigPath', refs.tunnelRef, { projectHome: project })
              const server = resolvePathVariables('serverConfigPath', refs.serverRef, { projectHome: project })
              if (tunnel.unresolved.length > 0 || server.unresolved.length > 0) continue
              tunnelConnecting(true, key)
              try {
                await api.dbConnect(tunnel.resolved, server.resolved, null, null, key)
                failedAt.current.delete(key)
                setTunnelError(null, key)
              } catch (e) {
                failedAt.current.set(key, Date.now())
                setTunnelError(e instanceof Error ? e.message : String(e), key)
              } finally {
                tunnelConnecting(false, key)
              }
            } else if (!st.db_tunnel_up) {
              failedAt.current.delete(key)
              if (getTunnelState().errorBy[key]) setTunnelError(null, key)
              if (session && !session.tunnel_up && !st.problem) await api.dbDisconnect(key).catch(() => {})
            }
          }
        }
        if (!cancelled) setSystemsDb(await api.dbSystems().catch(() => []))
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), SYSTEM_TUNNEL_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [api])
}
