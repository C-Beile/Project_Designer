import { useCallback, useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DeployChangeView, DeployMapping, DeployPlan } from '../wire/types'
import { Modal } from './Dialogs'
import { getOptions } from '../settings/options'

// Deploy dialog (manual chapter 11): the plan is a read-only comparison of dist against the
// system table; nothing is written until the user ticks the confirmation and presses Deploy.
// The row format of ASYS_SYSTEM is not verified against the original Designer, so the column
// mapping is visible and editable here.

const OP_TITLE = { I: 'Insert', U: 'Update', D: 'Delete' } as const

export function DeployDialog({
  api,
  projectRoot,
  systemName,
  initialForce = false,
  initialCheckScan,
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
  onDeployed: (message: string) => void
}) {
  const [force, setForce] = useState(initialForce)
  const [checkScan, setCheckScan] = useState(() => initialCheckScan ?? getOptions().general.checkScanOnDeploy)
  const [mapping, setMapping] = useState<DeployMapping | null>(null)
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [changes, setChanges] = useState<{ key: string; view: DeployChangeView } | null>(null)

  const load = useCallback(
    async (nextForce: boolean, nextMapping: DeployMapping | null) => {
      setBusy(true)
      setError(null)
      setConfirmed(false)
      try {
        const p = await api.deployPlan(projectRoot, nextForce, nextMapping)
        setPlan(p)
        setMapping((m) => m ?? p.mapping)
        setSelected(new Set(p.items.filter((i) => i.selected_by_default).map((i) => i.key)))
      } catch (e) {
        setPlan(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [api, projectRoot],
  )

  useEffect(() => {
    void load(initialForce, null)
    // The first plan uses the choice of the first dialog; later changes reload it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  async function showChanges(key: string) {
    try {
      setChanges({ key, view: await api.deployShowChanges(projectRoot, key, mapping) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function run() {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      if (checkScan) {
        const found = await api.scanProblems(projectRoot)
        const errs = found.filter((p) => /^error/i.test(p.severity))
        if (errs.length > 0) {
          const first = errs.slice(0, 5).map((p) => `${p.object}: ${p.message}${p.line ? ` [${p.line}]` : ''}`)
          setError(`Deploy stopped: Scan Services found ${errs.length} error(s). ${first.join(' | ')}${errs.length > 5 ? ' | ...' : ''}`)
          setBusy(false)
          return
        }
      }
      const keys = plan.items.filter((i) => selected.has(i.key)).map((i) => i.key)
      const outcome = await api.deployExecute(projectRoot, keys, force, mapping, true)
      onDeployed(`Deploy finished: ${outcome.executed} change(s) written to ${outcome.target}`)
      onClose()
    } catch (e) {
      setError(`Nothing was written (rolled back): ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  const count = plan ? plan.items.filter((i) => selected.has(i.key)).length : 0
  const deletes = plan ? plan.items.filter((i) => selected.has(i.key) && i.op === 'D').length : 0
  const cloud = warning ? false : plan ? /cloud/i.test(plan.target) : false

  return (
    <Modal
      title="Deploy"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={run} disabled={busy || !plan || count === 0 || !confirmed}>
            Deploy
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
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
        <label className="forge-check">
          <input type="checkbox" checked={checkScan} onChange={(e) => setCheckScan(e.target.checked)} />
          <span>Check Scan Services (Errors, Warnings)</span>
        </label>
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
        {plan && plan.outdated ? <p className="forge-deploy-outdated">View is outdated. Deploy necessary.</p> : null}
        {plan && !plan.outdated ? <p className="forge-field-hint">The system database is up to date.</p> : null}
        <label className="forge-check">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => {
              setForce(e.target.checked)
              void load(e.target.checked, mapping)
            }}
          />
          <span>Force deploy (update every model)</span>
        </label>
        <label className="forge-check" title="Deploying the userhelp is not available yet">
          <input type="checkbox" disabled />
          <span>Deploy Userhelp</span>
        </label>
        {plan ? (
          <ul className="forge-deploy-list" aria-label="Models to deploy">
            {plan.items.map((i) => (
              <li key={i.key} onDoubleClick={() => void showChanges(i.key)}>
                <label className="forge-check">
                  <input
                    type="checkbox"
                    checked={selected.has(i.key)}
                    aria-label={`${OP_TITLE[i.op]} ${i.key}`}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s)
                        if (e.target.checked) next.add(i.key)
                        else next.delete(i.key)
                        return next
                      })
                    }
                  />
                  <span className={`forge-deploy-op forge-deploy-op-${i.op}`} title={OP_TITLE[i.op]}>
                    {i.op}
                  </span>
                  <span>{i.key}</span>
                </label>
                {i.extra_files > 0 ? <span className="forge-field-hint"> ({i.extra_files} more file(s) not transferred)</span> : null}
                <button type="button" className="forge-link-button" onClick={() => void showChanges(i.key)}>
                  Show changes
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {changes ? (
          <div className="forge-deploy-diff" aria-label={`Changes of ${changes.key}`}>
            <div>
              <strong>Local</strong>
              <pre>{changes.view.local ?? '(not in project)'}</pre>
            </div>
            <div>
              <strong>System database</strong>
              <pre>{changes.view.remote ?? '(not in database)'}</pre>
            </div>
          </div>
        ) : null}
        {mapping ? (
          <details className="forge-deploy-mapping">
            <summary>Table mapping (not verified against the original Designer)</summary>
            {(['table', 'name_column', 'content_column'] as const).map((field) => (
              <label key={field} className="forge-field">
                <span>{field === 'table' ? 'Table' : field === 'name_column' ? 'Model name column' : 'Content column'}</span>
                <input type="text" value={mapping[field]} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })} aria-label={field} />
              </label>
            ))}
            <button type="button" onClick={() => void load(force, mapping)} disabled={busy}>
              Check and reload plan
            </button>
          </details>
        ) : null}
        {plan && count > 0 ? (
          <label className="forge-check forge-deploy-confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              I confirm writing {count} change(s){deletes > 0 ? `, including ${deletes} delete(s),` : ''} to {plan.target} in one transaction (rolled back on any error).
            </span>
          </label>
        ) : null}
      </div>
    </Modal>
  )
}
