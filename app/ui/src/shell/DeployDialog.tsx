import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DeployChangeView, DeployOverview, DeployPlan, DeployPlanItem } from '../wire/types'
import { Modal } from './Dialogs'

// Deploy review: before anything is written, the window compares the transpiled project (`dist`)
// with the model table of the system and lists exactly what a deploy would do - models to add,
// models that changed and models that exist on the system but no longer in the project. Only what
// differs is ever written (one transaction); unchanged models are not touched. Deleting is never
// pre-selected because the system may hold models this project does not own.

const when = (ms: number) => new Date(ms).toLocaleString()

const GROUPS: { op: DeployPlanItem['op']; title: string; hint?: string }[] = [
  { op: 'I', title: 'Added' },
  { op: 'U', title: 'Changed' },
  { op: 'D', title: 'Deleted from the system', hint: 'Not selected by default: the system may hold models that do not belong to this project.' },
]

/** Lines that exist on one side only, in file order: a compact picture of what changed. */
export function changedLines(remote: string | null, local: string | null): { removed: string[]; added: string[] } {
  const lines = (text: string | null) => (text ?? '').split(/\r?\n/)
  const remoteLines = lines(remote)
  const localLines = lines(local)
  const remoteSet = new Set(remoteLines)
  const localSet = new Set(localLines)
  return {
    removed: remoteLines.filter((l) => !localSet.has(l) && l.trim() !== ''),
    added: localLines.filter((l) => !remoteSet.has(l) && l.trim() !== ''),
  }
}

function Changes({ view }: { view: DeployChangeView }) {
  const { removed, added } = changedLines(view.remote, view.local)
  const cap = 200
  return (
    <div className="forge-deploy-diff" aria-label="Changes of the model">
      {view.remote === null ? <p className="forge-field-hint">New on the system.</p> : null}
      {view.local === null ? <p className="forge-field-hint">Removed from the project.</p> : null}
      {removed.length === 0 && added.length === 0 ? <p className="forge-field-hint">No line differs.</p> : null}
      {removed.length > 0 ? (
        <pre className="forge-deploy-op-D">{removed.slice(0, cap).map((l) => `- ${l}`).join('\n')}{removed.length > cap ? `\n... ${removed.length - cap} more` : ''}</pre>
      ) : null}
      {added.length > 0 ? (
        <pre className="forge-deploy-op-I">{added.slice(0, cap).map((l) => `+ ${l}`).join('\n')}{added.length > cap ? `\n... ${added.length - cap} more` : ''}</pre>
      ) : null}
    </div>
  )
}

export function DeployDialog({
  api,
  projectRoot,
  systemName,
  initialForce,
  warning,
  onClose,
  onDeployed,
}: {
  api: ForgeApi
  projectRoot: string
  /** System chosen in the first dialog (shown in the System line). */
  systemName?: string
  initialForce?: boolean
  initialCheckScan?: boolean
  /** Warning about the target (productive or cloud system), shown above the list. */
  warning?: string | null
  onClose: () => void
  onDeployed?: (message: string) => void
}) {
  const [overview, setOverview] = useState<DeployOverview | null>(null)
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [force, setForce] = useState(initialForce === true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [open, setOpen] = useState<Record<string, DeployChangeView | 'loading'>>({})

  const fetchPlan = useCallback(async () => {
    setBusy(true)
    setError(null)
    setConfirming(false)
    setOpen({})
    try {
      const [p, o] = await Promise.all([api.deployPlan(projectRoot, force, null), api.deployOverview(projectRoot).catch(() => null)])
      setPlan(p)
      setOverview(o)
      setSelected(new Set(p.items.filter((i) => i.selected_by_default).map((i) => i.key)))
    } catch (e) {
      setPlan(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [api, projectRoot, force])

  useEffect(() => {
    void fetchPlan()
  }, [fetchPlan])

  const chosen = useMemo(() => (plan ? plan.items.filter((i) => selected.has(i.key)) : []), [plan, selected])
  const count = (op: DeployPlanItem['op']) => chosen.filter((i) => i.op === op).length
  const cloud = warning ? false : plan ? /cloud/i.test(plan.target) : false
  const last = overview?.last_deploy ?? null

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const showChanges = async (key: string) => {
    if (open[key] && open[key] !== 'loading') {
      setOpen(({ [key]: _gone, ...rest }) => rest)
      return
    }
    setOpen((o) => ({ ...o, [key]: 'loading' }))
    try {
      const view = await api.deployShowChanges(projectRoot, key, null)
      setOpen((o) => ({ ...o, [key]: view }))
    } catch (e) {
      setOpen(({ [key]: _gone, ...rest }) => rest)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deploy = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await api.deployExecute(projectRoot, chosen.map((i) => i.key), force, null, true)
      onDeployed?.(`Deployed ${outcome.executed} model${outcome.executed === 1 ? '' : 's'} to ${outcome.target}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Deploy"
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <button type="button" onClick={() => void deploy()} disabled={busy}>
              {busy ? 'Deploying…' : 'Yes, deploy now'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} disabled={busy || chosen.length === 0}>
              Deploy{chosen.length > 0 ? ` (${chosen.length})` : ''}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </>
        )
      }
    >
      <div className="forge-deploy">
        <div className="forge-deploy-head">
          <label className="forge-field">
            <span>Project:</span>
            <select aria-label="Project" disabled value="p">
              <option value="p">{projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? projectRoot}</option>
            </select>
          </label>
          <label className="forge-field">
            <span>System:</span>
            <select aria-label="System" disabled value="s">
              <option value="s">{systemName ?? (plan ? plan.target : '…')}</option>
            </select>
          </label>
        </div>
        {plan ? (
          <p className="forge-deploy-target">
            System database: <strong>{plan.target}</strong>
          </p>
        ) : null}
        {cloud ? (
          <p className="forge-field-error" role="alert">
            This looks like a cloud system. A deploy overwrites its database.
          </p>
        ) : null}
        {warning ? (
          <p className="forge-field-error" role="alert">
            {warning}
          </p>
        ) : null}
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}

        {plan ? (
          <>
            <section className="forge-deploy-last" aria-label="Last deploy">
              <h4>Last deploy</h4>
              {last ? (
                <p>
                  {last.time_ms ? when(last.time_ms) : 'time unknown'}
                  {last.author ? ` by ${last.author}` : ''}
                  {last.designer_version ? ` (project version ${last.designer_version})` : ''}
                </p>
              ) : (
                <p className="forge-field-hint">This system has no deploy information yet.</p>
              )}
            </section>

            <section aria-label="Planned changes">
              <h4>
                {plan.items.length === 0
                  ? 'Nothing to deploy'
                  : `Planned changes: ${plan.items.filter((i) => i.op === 'I').length} added, ${plan.items.filter((i) => i.op === 'U').length} changed, ${plan.items.filter((i) => i.op === 'D').length} deleted`}
              </h4>
              {plan.items.length === 0 ? <p className="forge-field-hint">The system already has exactly what your last transpile produced.</p> : null}
              {GROUPS.map((group) => {
                const items = plan.items.filter((i) => i.op === group.op)
                if (items.length === 0) return null
                return (
                  <div key={group.op} aria-label={group.title}>
                    <h4>
                      {group.title} ({items.length})
                    </h4>
                    {group.hint ? <p className="forge-field-hint">{group.hint}</p> : null}
                    <ul className="forge-deploy-list">
                      {items.map((item) => (
                        <li key={item.key}>
                          <label>
                            <input type="checkbox" aria-label={item.key} checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                            <span className={`forge-deploy-op forge-deploy-op-${item.op}`}>{item.op}</span>
                            <span>{item.key}</span>
                          </label>
                          {item.op !== 'D' ? (
                            <button type="button" className="forge-link" onClick={() => void showChanges(item.key)} aria-label={`Show changes of ${item.key}`}>
                              {open[item.key] ? 'Hide changes' : 'Show changes'}
                            </button>
                          ) : null}
                          {open[item.key] && open[item.key] !== 'loading' ? <Changes view={open[item.key] as DeployChangeView} /> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </section>
          </>
        ) : null}

        {confirming ? (
          <p className="forge-field-error" role="alert">
            Deploy {chosen.length} model{chosen.length === 1 ? '' : 's'} ({count('I')} added, {count('U')} changed, {count('D')} deleted) to {plan?.target}? This writes into the system database.
          </p>
        ) : null}

        <div className="forge-deploy-actions">
          <label className="forge-field">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy} /> <span>Deploy all models, also unchanged ones</span>
          </label>
          <button type="button" onClick={() => void fetchPlan()} disabled={busy}>
            {busy ? 'Comparing…' : 'Compare again'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
