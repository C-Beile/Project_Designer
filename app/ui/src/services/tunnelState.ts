import { pathKey } from '../platform/pathKey'
import { useSyncExternalStore } from 'react'
import type { DbStatus, SystemDbStatus } from '../wire/types'

// One shared picture of the tunnel for the whole window: tree node of the system, editor tab,
// status bar and the system editor all read it. grey = no tunnel, yellow = connecting, green =
// active, red = failed. The shell feeds it from its poll of the database status; the Services tab
// and the tunnel editor report connecting and failures.

// grey = no tunnel, yellow = connecting or tunnel open without a database session, green = database
// session connected, red = failed.
export type TunnelPhase = 'off' | 'connecting' | 'open' | 'on' | 'error'

interface State {
  db: DbStatus
  forwardsUp: boolean
  connecting: number
  error: string | null
  /** Bumped when something asks the system editors to read the system database again. */
  reload: number
  /** System the open database session was opened for (null: none, or opened without saying which). */
  connectedSystem: string | null
  /** Database session and tunnel per system: the tunnel belongs to the system, not to the run configuration. */
  bySystem: Record<string, DbStatus>
  connectingBy: Record<string, number>
  errorBy: Record<string, string>
  /** The forward to the database host of the system is open (from the tunnel manager). */
  forwardBy: Record<string, boolean>
  /** Phase of a connect that is running right now, with its start time (for the elapsed time). */
  progressBy: Record<string, { phase: string; startedAt: number }>
  /** Systems without tunnelConfigPath or serverConfigPath: nothing to connect to. */
  unconfigured: Record<string, boolean>
}

const NO_DB: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
const INITIAL: State = { db: NO_DB, forwardsUp: false, connecting: 0, error: null, reload: 0, connectedSystem: null, bySystem: {}, connectingBy: {}, errorBy: {}, forwardBy: {}, progressBy: {}, unconfigured: {} }
let state: State = INITIAL
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function phaseOf(s: Pick<State, 'db' | 'forwardsUp' | 'connecting' | 'error'>): TunnelPhase {
  if (s.connecting > 0) return 'connecting'
  if (s.db.tunnel_up || s.db.connected || s.forwardsUp) return 'on'
  return s.error ? 'error' : 'off'
}

export function setSharedDb(db: DbStatus): void {
  const wasUp = state.db.connected
  const patch: Partial<State> = { db }
  if (db.connected || db.tunnel_up) patch.error = null
  if (db.connected && !wasUp) patch.reload = state.reload + 1
  if (!db.connected) patch.connectedSystem = null
  set(patch)
}

/** Feeds the picture from the list of open sessions: one entry per system. */
export function setSystemsDb(list: SystemDbStatus[]): void {
  const bySystem: Record<string, DbStatus> = {}
  for (const e of list) bySystem[e.system] = e.status
  const same = Object.keys(bySystem).length === Object.keys(state.bySystem).length && Object.entries(bySystem).every(([k, v]) => { const o = state.bySystem[k]; return o && o.connected === v.connected && o.tunnel_up === v.tunnel_up && o.database === v.database })
  const active = list.find((e) => e.active)
  const db = active?.status ?? NO_DB
  const connectedSystem = active && active.status.connected && active.system !== '' ? active.system : null  // a systemKey
  if (same && state.db.connected === db.connected && state.db.tunnel_up === db.tunnel_up && state.db.database === db.database && state.connectedSystem === connectedSystem) return
  const errorBy = { ...state.errorBy }
  for (const [k, v] of Object.entries(bySystem)) if (v.connected || v.tunnel_up) delete errorBy[k]
  set({ bySystem, db, connectedSystem, errorBy, error: db.connected || db.tunnel_up ? null : state.error, reload: db.connected && !state.db.connected ? state.reload + 1 : state.reload })
}

const normPath = (p: string) => pathKey(p)

/** Key of a system's session: systems, their configs and tunnels differ per project, so the project is part of it. */
export function systemKey(project: string, system: string): string {
  return `${normPath(project)}|${system}`
}

/** Name part of a key built by systemKey (what the user knows). */
export function systemNameOf(key: string): string {
  const i = key.lastIndexOf('|')
  return i < 0 ? key : key.slice(i + 1)
}

/** The open project a file path belongs to (longest matching project root). */
export function projectOfPath(projects: string[], path: string): string | null {
  const p = normPath(path)
  let best: string | null = null
  for (const root of projects) {
    const r = normPath(root)
    if ((p === r || p.startsWith(r + '/')) && (best === null || r.length > normPath(best).length)) best = root
  }
  return best
}

/** Phase of the tunnel of one system; independent of the run configuration. */
export function systemPhase(system: string, s: Pick<State, 'bySystem' | 'connectingBy' | 'errorBy'> & { forwardBy?: Record<string, boolean>; progressBy?: Record<string, unknown> } = state): TunnelPhase {
  const st = s.bySystem[system]
  if ((s.connectingBy[system] ?? 0) > 0 || (s.progressBy?.[system] && !(st && st.connected))) return 'connecting'
  if (st && st.connected) return 'on'
  if (s.errorBy[system]) return 'error'
  if (s.forwardBy?.[system] || (st && st.tunnel_up)) return 'open'
  return 'off'
}

/** Source of truth for one system: tunnel open? session connected? error? */
export function systemFacts(system: string, s: State = state): { phase: TunnelPhase; tunnelOpen: boolean; connected: boolean; error: string | null } {
  return { phase: systemPhase(system, s), tunnelOpen: !!s.forwardBy[system] || !!s.bySystem[system]?.tunnel_up, connected: !!s.bySystem[system]?.connected, error: s.errorBy[system] ?? null }
}

/** One phase for the status bar: the strongest state of any system. */
export function overallPhase(s: State = state): TunnelPhase {
  const keys = new Set([...Object.keys(s.bySystem), ...Object.keys(s.forwardBy), ...Object.keys(s.connectingBy), ...Object.keys(s.errorBy)])
  const phases = [...keys].map((k) => systemPhase(k, s))
  if (s.connecting > 0 || phases.includes('connecting')) return 'connecting'
  if (phases.includes('on')) return 'on'
  if (phases.includes('open') || s.forwardsUp) return 'open'
  if (phases.includes('error') || s.error) return 'error'
  return 'off'
}

export function setUnconfigured(system: string, missing: boolean): void {
  if (!!state.unconfigured[system] === missing) return
  const unconfigured = { ...state.unconfigured }
  if (missing) unconfigured[system] = true
  else delete unconfigured[system]
  set({ unconfigured })
}

export const UNCONFIGURED_HINT = 'Keine tunnelConfigPath/serverConfigPath gesetzt'

/** A connect reports its phases; a finished connect drops the entry. */
export function setProgress(system: string, phase: string, finished: boolean): void {
  const progressBy = { ...state.progressBy }
  if (finished) delete progressBy[system]
  else progressBy[system] = { phase, startedAt: progressBy[system]?.startedAt ?? Date.now() }
  set({ progressBy })
}

/** Reports whether the database tunnel of a system is open (polled by the shell). */
export function setForwardFor(system: string, up: boolean): void {
  if (!!state.forwardBy[system] === up) return
  const forwardBy = { ...state.forwardBy }
  if (up) forwardBy[system] = true
  else delete forwardBy[system]
  set({ forwardBy })
}

export function setConnectedSystem(name: string | null): void {
  set({ connectedSystem: name })
}

export function setForwardsUp(up: boolean): void {
  if (state.forwardsUp === up) return
  set({ forwardsUp: up, error: up ? null : state.error })
}

export function tunnelConnecting(on: boolean, system?: string): void {
  const patch: Partial<State> = { connecting: Math.max(0, state.connecting + (on ? 1 : -1)), error: on ? null : state.error }
  if (system) {
    const n = Math.max(0, (state.connectingBy[system] ?? 0) + (on ? 1 : -1))
    patch.connectingBy = { ...state.connectingBy, [system]: n }
    if (on) {
      const { [system]: _gone, ...rest } = state.errorBy
      patch.errorBy = rest
    }
  }
  set(patch)
}

export function setTunnelError(message: string | null, system?: string): void {
  const patch: Partial<State> = { error: message }
  if (system) {
    if (message) patch.errorBy = { ...state.errorBy, [system]: message }
    else {
      const { [system]: _gone, ...rest } = state.errorBy
      patch.errorBy = rest
    }
  }
  set(patch)
}

export function requestSystemReload(): void {
  set({ reload: state.reload + 1 })
}

export function getTunnelState(): State & { phase: TunnelPhase } {
  return { ...state, phase: overallPhase(state) }
}

let cachedSnapshot = getTunnelState()
function snapshot() {
  if (cachedSnapshot.db !== state.db || cachedSnapshot.forwardsUp !== state.forwardsUp || cachedSnapshot.connecting !== state.connecting || cachedSnapshot.error !== state.error || cachedSnapshot.reload !== state.reload || cachedSnapshot.connectedSystem !== state.connectedSystem || cachedSnapshot.bySystem !== state.bySystem || cachedSnapshot.connectingBy !== state.connectingBy || cachedSnapshot.errorBy !== state.errorBy || cachedSnapshot.forwardBy !== state.forwardBy || cachedSnapshot.progressBy !== state.progressBy || cachedSnapshot.unconfigured !== state.unconfigured) {
    cachedSnapshot = getTunnelState()
  }
  return cachedSnapshot
}

export function useTunnelState() {
  return useSyncExternalStore(subscribe, snapshot)
}

export function _resetTunnelStateForTests(): void {
  state = INITIAL
  cachedSnapshot = getTunnelState()
  for (const l of listeners) l()
}

export const TUNNEL_PHASE_LABEL: Record<TunnelPhase, string> = { off: 'no tunnel', connecting: 'connecting', open: 'tunnel open, no database session', on: 'active', error: 'error' }
