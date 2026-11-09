import { useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Modal } from '../core/Modal'
import { useSshKeyPath } from '../settings/sshKey'
import { resolvePathVariables } from '../properties/pathVariables'
import { systemKey } from '../services/tunnelState'
import { errorText } from '../core/errorText'

// First dialog of a deploy (original Designer, manual chapter 11, picture 178): Project, System and
// the three check boxes. Added by Dito Designer: "Build before deploy" (Build and Deploy) and the tunnel
// check - the plan of the next step is read from the system database, so the tunnel to the chosen
// system has to stand. The write step keeps its own explicit confirmation in the following dialog.

export interface DeploySystem {
  name: string
  tunnelRef: string
  serverRef: string
  productive: boolean
  cloud: boolean
}

export interface DeployOptionsPayload {
  projects: string[]
  project: string
  systems: DeploySystem[]
  defaultSystem: string
  /** Systems and the default (bold) system of every open project; systems differ per project. */
  systemsByProject?: Record<string, { systems: DeploySystem[]; defaultSystem: string }>
  /** System the open database session belongs to (null: none or not known). */
  connectedSystem: string | null
  /** Every system that has its own open tunnel and database session. */
  openSystems?: string[]
  buildFirst: boolean
  checkScan: boolean
}

export interface DeployOptionsResult {
  project: string
  system: string
  checkScan: boolean
  force: boolean
  userhelp: boolean
  build: boolean
  connectedSystem: string | null
}

const LAST_KEY = 'dito.deploy.last'

// Project: the one worked in last (the active project). System: the one whose tunnel is open right now;
// with several open tunnels the system last deployed to wins, without any open tunnel the remembered or default one.
function rememberedChoice(payload: DeployOptionsPayload): { project: string; system: string } {
  const project = payload.project
  const systems = payload.systemsByProject?.[project]?.systems ?? payload.systems
  const fallback = payload.systemsByProject?.[project]?.defaultSystem || payload.defaultSystem || systems[0]?.name || ''
  const open = new Set([...(payload.openSystems ?? []), ...(payload.connectedSystem ? [payload.connectedSystem] : [])])
  const openNames = systems.filter((s) => open.has(systemKey(project, s.name))).map((s) => s.name)
  let saved: string | undefined
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? 'null') as { project?: string; system?: string } | null
    if (parsed?.project === project) saved = parsed.system
  } catch {
    // unreadable storage: the default choice is used
  }
  if (openNames.length > 0) return { project, system: saved && openNames.includes(saved) ? saved : openNames[0] }
  return { project, system: saved && systems.some((s) => s.name === saved) ? saved : fallback }
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function systemWarning(s: DeploySystem | undefined): string | null {
  if (!s) return null
  if (s.productive || /prod/i.test(s.name)) return `${s.name} looks like a productive system. A deploy overwrites its models.`
  return null
}

export function DeployOptionsDialog({ api, payload, onOk, onCancel }: { api: ForgeApi; payload: DeployOptionsPayload; onOk: (r: DeployOptionsResult) => void; onCancel: () => void }) {
  const [initial] = useState(() => rememberedChoice(payload))
  const [project, setProject] = useState(initial.project)
  const [system, setSystem] = useState(initial.system)
  const [checkScan, setCheckScan] = useState(payload.checkScan)
  const [force, setForce] = useState(false)
  // A deploy writes the transpiled result, so the build runs first unless it is switched off here.
  const [build, setBuild] = useState(true)
  const [connected, setConnected] = useState<string | null>(payload.connectedSystem)
  const [opened, setOpened] = useState<string[]>(payload.openSystems ?? (payload.connectedSystem ? [payload.connectedSystem] : []))
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyFile] = useSshKeyPath(api)
  const systemList = payload.systemsByProject?.[project]?.systems ?? payload.systems
  const current = systemList.find((s) => s.name === system)
  const tunnelOk = opened.includes(systemKey(project, system)) || (connected !== null && connected === systemKey(project, system))
  const warning = systemWarning(current)

  async function openTunnel() {
    if (!current) return
    setOpening(true)
    setError(null)
    try {
      if (!current.tunnelRef || !current.serverRef) throw new Error('tunnelConfigPath and serverConfigPath of this system must be set to open its tunnel.')
      const tunnel = resolvePathVariables('tunnelConfigPath', current.tunnelRef, { projectHome: project })
      const server = resolvePathVariables('serverConfigPath', current.serverRef, { projectHome: project })
      if (tunnel.unresolved.length > 0 || server.unresolved.length > 0) throw new Error('The config paths contain variables that cannot be resolved here.')
      await api.dbConnect(tunnel.resolved, server.resolved, keyFile.trim() || null, null, systemKey(project, current.name))
      setConnected(systemKey(project, current.name))
      setOpened((o) => (o.includes(systemKey(project, current.name)) ? o : [...o, systemKey(project, current.name)]))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setOpening(false)
    }
  }

  const ok = () => {
    try {
      window.localStorage.setItem(LAST_KEY, JSON.stringify({ project, system }))
    } catch {
      // the choice is just not remembered
    }
    onOk({ project, system, checkScan, force, userhelp: false, build, connectedSystem: tunnelOk ? systemKey(project, system) : connected })
  }

  return (
    <Modal
      title={payload.buildFirst ? 'Build and Deploy' : 'Deploy'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={ok} disabled={!tunnelOk || !system} title={!tunnelOk ? 'Open the tunnel to the system first' : undefined}>
            OK
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <div className="forge-deploy">
        <label className="forge-field">
          <span>Project:</span>
          <select
            aria-label="Project"
            value={project}
            onChange={(e) => {
              setProject(e.target.value)
              const entry = payload.systemsByProject?.[e.target.value]
              if (entry) setSystem(entry.defaultSystem || entry.systems[0]?.name || '')
            }}
          >
            {payload.projects.map((p) => (
              <option key={p} value={p}>
                {baseName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="forge-field">
          <span>System:</span>
          <select aria-label="System" value={system} onChange={(e) => setSystem(e.target.value)}>
            {systemList.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {warning ? (
          <p className="forge-field-error" role="alert">
            {warning}
          </p>
        ) : null}
        {tunnelOk ? (
          <p className="forge-tunnel-state is-open" role="status">
            <span className="forge-tunnel-dot" aria-hidden="true" /> Tunnel to {system} is open
          </p>
        ) : (
          <p className="forge-tunnel-state" role="status">
            <span className="forge-tunnel-dot" aria-hidden="true" /> The tunnel to {system || 'the system'} is not open.
            <button type="button" className="forge-action-button" onClick={() => void openTunnel()} disabled={opening || !current} aria-busy={opening}>
              {opening ? <span className="forge-btn-spinner" aria-hidden="true" /> : null}
              {opening ? 'Opening...' : 'Open tunnel'}
            </button>
          </p>
        )}
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <fieldset className="forge-opt-group">
          <legend>Steps</legend>
          <label className="forge-check">
            <input type="checkbox" checked={build} onChange={(e) => setBuild(e.target.checked)} />
            <span>Build (transpile) before the deploy</span>
          </label>
          <span className="forge-check-hint">The project is transpiled first; the deploy then writes the transpiled result.</span>
          <label className="forge-check">
            <input type="checkbox" checked={checkScan} onChange={(e) => setCheckScan(e.target.checked)} />
            <span>Check Scan Services (Errors, Warnings)</span>
          </label>
        </fieldset>
        <fieldset className="forge-opt-group">
          <legend>Options</legend>
          <label className="forge-check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>Force deploy</span>
          </label>
          <label className="forge-check" title="Deploying the userhelp is not available yet">
            <input type="checkbox" disabled />
            <span>Deploy Userhelp</span>
          </label>
        </fieldset>
      </div>
    </Modal>
  )
}
