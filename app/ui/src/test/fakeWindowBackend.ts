import { EVENTS } from '../windows/protocol'
import type { OpenWindowRequest, WindowBackend } from '../windows/windowService'

// In-memory stand-in for Tauri: a broadcast event bus plus a record of the window calls.
export function fakeBackend(options: { mainContains?: boolean } = {}) {
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  const calls = {
    opened: [] as OpenWindowRequest[],
    closed: [] as string[],
    results: [] as { kind: string; name: string; result: string | null }[],
    guards: [] as { kind: string; name: string; on: boolean }[],
    exited: 0,
  }
  const payloads = new Map<string, string>()
  const backend: WindowBackend = {
    available: () => true,
    async open(req) {
      calls.opened.push(req)
      if (req.payload !== undefined) payloads.set(`${req.kind}-${req.name}`, JSON.stringify(req.payload))
    },
    async payload(kind, name) {
      return payloads.get(`${kind}-${name}`) ?? null
    },
    async result(kind, name, result) {
      calls.results.push({ kind, name, result })
      await backend.emit(EVENTS.windowResult, { kind, name, result })
    },
    async close(kind, name) {
      calls.closed.push(`${kind}-${name}`)
    },
    async emit(event, payload) {
      for (const l of listeners.get(event) ?? []) l(payload)
    },
    async listen(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return () => listeners.get(event)!.delete(handler)
    },
    async closeGuard(kind, name, on) {
      calls.guards.push({ kind, name, on })
    },
    async mainContains() {
      return options.mainContains ?? false
    },
    async exitApp() {
      calls.exited += 1
    },
  }
  return { backend, calls }
}
