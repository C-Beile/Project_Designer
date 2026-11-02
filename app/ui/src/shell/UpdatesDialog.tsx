import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { LocalDataInfo, UpdateInfo } from '../wire/types'
import { Modal } from './Dialogs'

// Help > Check for Updates (manual chapter 13 / menu Help). Asks the private release repository
// for a newer Vendira Designer, shows its version and release notes and installs it only after the
// user clicked "Install and restart". It also opens the System Table Control Center, the one
// maintenance function of chapter 13 that can be read from the system database.

type UpdateState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'current' } | { phase: 'available'; update: UpdateInfo } | { phase: 'installing'; update: UpdateInfo } | { phase: 'error'; message: string }

export function UpdatesDialog({ api, onClose, onOpenTableCenter }: { api: ForgeApi; onClose: () => void; onOpenTableCenter: () => void }) {
  const [info, setInfo] = useState<LocalDataInfo | null>(null)
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })
  useEffect(() => {
    api.localDataInfo(30).then(setInfo).catch(() => {})
  }, [api])

  async function search() {
    setState({ phase: 'checking' })
    try {
      const update = await api.checkForUpdate()
      setState(update ? { phase: 'available', update } : { phase: 'current' })
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function install(update: UpdateInfo) {
    setState({ phase: 'installing', update })
    try {
      await api.installUpdate()
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <Modal
      title="Check for Updates"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="forge-updates">
        <p>
          Installed version: <strong data-testid="installed-version">{info?.app_version ?? '…'}</strong>
        </p>
        <div className="forge-updates-check">
          <button type="button" disabled={state.phase === 'checking' || state.phase === 'installing'} onClick={() => void search()}>
            Check for Updates
          </button>
          {state.phase === 'checking' ? <span>Searching for a newer version…</span> : null}
          {state.phase === 'current' ? <span>Vendira Designer is up to date.</span> : null}
          {state.phase === 'error' ? <span role="alert">Update check failed: {state.message}</span> : null}
        </div>
        {state.phase === 'available' || state.phase === 'installing' ? (
          <div className="forge-updates-available">
            <p>
              Version <strong>{state.update.version}</strong> is available.
            </p>
            {state.update.notes ? <pre className="forge-updates-notes">{state.update.notes}</pre> : null}
            <button type="button" disabled={state.phase === 'installing'} onClick={() => void install(state.update)}>
              {state.phase === 'installing' ? 'Installing…' : 'Install and restart'}
            </button>
          </div>
        ) : null}
        <h3>Update the ADITO project</h3>
        <p className="forge-field-hint">
          Upgrading a project to a newer ADITO version (manual 13.1: &quot;Upgrade project…&quot; and &quot;This model is deprecated and has to be converted&quot;) is not available: the upgrade rules of each version are not known to Vendira Designer, so old projects are never changed automatically.
        </p>
        <h3>Update the database</h3>
        <p>The system tables of the connected system database can be checked in the System Table Control Center.</p>
        <button type="button" onClick={onOpenTableCenter}>
          Organize System Tables…
        </button>
      </div>
    </Modal>
  )
}
