import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DeployChangeView, DeployPlan } from '../wire/types'
import { Modal } from './Dialogs'
import { DeployDiffDialog } from './DeployDiffDialog'

// Deploy review as in the original Designer: "Are you sure to deploy into this system?" with one
// checkbox per model that differs (I added, U changed, D deleted from the system). Double-click (or
// the context menu) shows the DB version next to the Designer version. Only what is ticked is written
// (one transaction). Deleting is never pre-selected because the system may hold models this project
// does not own.

const HIDE_KEY = 'dito.deploy.hideDialog'

function readHide(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1'
  } catch {
    return false
  }
}

const nameOf = (key: string) => key.slice(key.lastIndexOf('/') + 1)

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
  /** System chosen in the first dialog (shown as the title). */
  systemName?: string
  initialForce?: boolean
  initialCheckScan?: boolean
  /** Warning about the target (productive system), shown above the list. */
  warning?: string | null
  onClose: () => void
  onDeployed?: (message: string) => void
}) {
  const [plan, setPlan] = useState<DeployPlan | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [hide, setHide] = useState(readHide)
  const [diff, setDiff] = useState<{ key: string; view: DeployChangeView } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const force = initialForce === true
  const autoDone = useRef(false)
  const [deploying, setDeploying] = useState(false)

  const fetchPlan = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const p = await api.deployPlan(projectRoot, force, null)
      setPlan(p)
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

  const items = useMemo(() => (plan ? [...plan.items].sort((x, y) => nameOf(x.key).localeCompare(nameOf(y.key), undefined, { sensitivity: 'base' })) : []), [plan])
  const chosen = useMemo(() => items.filter((i) => selected.has(i.key)), [items, selected])

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const showChanges = async (key: string) => {
    setMenu(null)
    try {
      setDiff({ key, view: await api.deployShowChanges(projectRoot, key, null) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deploy = useCallback(async () => {
    if (!plan) return
    setBusy(true)
    setDeploying(true)
    setError(null)
    try {
      const outcome = await api.deployExecute(projectRoot, chosen.map((i) => i.key), force, null, true)
      onDeployed?.(`Deployed ${outcome.executed} model${outcome.executed === 1 ? '' : 's'} to ${outcome.target}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setDeploying(false)
    }
  }, [api, projectRoot, plan, chosen, force, onClose, onDeployed])

  // "Hide dialog" ticked earlier: the list is not asked for any more as long as nothing would be deleted.
  useEffect(() => {
    if (!hide || !plan || autoDone.current || chosen.length === 0 || chosen.some((i) => i.op === 'D')) return
    autoDone.current = true
    void deploy()
  }, [hide, plan, chosen, deploy])

  const changeHide = (on: boolean) => {
    setHide(on)
    try {
      localStorage.setItem(HIDE_KEY, on ? '1' : '0')
    } catch {
      /* the setting is only a convenience */
    }
  }

  const title = systemName ?? (plan ? plan.target : 'Deploy')

  return (
    <>
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <>
            <button type="button" className={`is-primary${deploying ? ' is-busy' : ''}`} onClick={() => void deploy()} disabled={busy || chosen.length === 0} aria-busy={deploying} title={chosen.length === 0 ? 'Tick at least one model' : undefined}>
              {deploying ? <span className="forge-btn-spinner" aria-hidden="true" /> : null}
              {deploying ? 'Deploying...' : 'OK'}
            </button>
            <button type="button" onClick={onClose} disabled={deploying}>
              Cancel
            </button>
          </>
        }
      >
        <div className="forge-deploy" onClick={() => setMenu(null)}>
          <p className="forge-deploy-question">Are you sure to deploy into this system?</p>
          <label className="forge-deploy-hide">
            <input type="checkbox" checked={hide} onChange={(e) => changeHide(e.target.checked)} /> <span>Hide dialog</span>
          </label>
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
          {plan && items.length > 0 ? (
            <div className="forge-deploy-summary" aria-label="Summary">
              {(['I', 'U', 'D'] as const).map((op) => {
                const n = items.filter((i) => i.op === op).length
                return n > 0 ? (
                  <span key={op} className={`forge-deploy-chip is-${op}`}>
                    {n} {op === 'I' ? 'added' : op === 'U' ? 'changed' : 'to delete'}
                  </span>
                ) : null
              })}
              <span className="forge-commit-selected">
                <strong>{chosen.length}</strong> of {items.length} selected
              </span>
            </div>
          ) : null}
          <ul className="forge-deploy-list forge-deploy-box" aria-label="Planned changes">
            {busy && !plan ? (
              <li className="forge-deploy-loading">
                <span className="forge-btn-spinner" aria-hidden="true" /> Comparing with the system...
              </li>
            ) : null}
            {plan && items.length === 0 ? <li className="forge-field-hint">Nothing to deploy: the system already has exactly what your last transpile produced.</li> : null}
            {items.map((item) => (
              <li
                key={item.key}
                onDoubleClick={() => (item.op === 'D' ? undefined : void showChanges(item.key))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (item.op !== 'D') setMenu({ x: e.clientX, y: e.clientY, key: item.key })
                }}
                title={item.key}
              >
                <label>
                  <input type="checkbox" aria-label={item.key} checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                  <span className={`forge-deploy-op forge-deploy-op-${item.op}`}>{item.op}</span>
                  <span>{nameOf(item.key)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="forge-deploy-hint">Double-click to show changes</p>
        </div>
      </Modal>
      {menu ? (
        <div className="forge-deploy-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button type="button" role="menuitem" onClick={() => void showChanges(menu.key)}>
            Show changes
          </button>
        </div>
      ) : null}
      {diff ? <DeployDiffDialog name={nameOf(diff.key)} view={diff.view} onClose={() => setDiff(null)} /> : null}
    </>
  )
}
