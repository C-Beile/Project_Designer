import { useRef, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { Modal } from '../../core/Modal'
import { openUiDialog } from '../../core/ui/uiDialogs'
import { openDialogWindow, osWindowsAvailable } from '../../windows/windowService'

interface Props {
  url: string | null
  /** Meldet am Remote an; wirft bei falschen Daten. */
  login: (user: string, password: string) => Promise<void>
  /** true = angemeldet; false = abgebrochen. */
  onResult: (signedIn: boolean) => void
  onClose: () => void
}

/** Anmeldung am https-Remote (Benutzer + Zugriffstoken). Ersetzt das Fenster des Git Credential Managers. */
export function GitLoginDialog({ url, login, onResult, onClose }: Props) {
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cancel = () => {
    onResult(false)
    onClose()
  }
  const submit = async () => {
    if (busy || !user.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await login(user.trim(), password)
      onResult(true)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Git Sign In"
      onClose={cancel}
      onEnter={() => void submit()}
      footer={
        <>
          <button type="button" disabled={busy || !user.trim() || !password} onClick={() => void submit()}>
            Sign in
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </>
      }
    >
      {url ? <p>{url}</p> : null}
      <label className="forge-field">
        <span>User Name:</span>
        <input type="text" aria-label="User Name" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
      </label>
      <label className="forge-field">
        <span>Password or Access Token:</span>
        <input type="password" aria-label="Password or Access Token" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}

/** Inhalt des Anmelde-Fensters (OS-Fenster, verschiebbar): meldet über `api` an und gibt zurück, ob es geklappt hat. */
export function GitLoginWindow({ api, payload, done }: { api: ForgeApi; payload: Record<string, unknown>; done: (result: unknown) => void }) {
  const signedIn = useRef(false)
  return (
    <GitLoginDialog
      url={typeof payload.url === 'string' ? payload.url : null}
      login={(user, password) => api.gitLogin(String(payload.project ?? ''), user, password)}
      onResult={(ok) => {
        signedIn.current = ok
      }}
      onClose={() => done(signedIn.current ? { signedIn: true } : null)}
    />
  )
}

/**
 * Zeigt die Anmeldung als eigenes, verschiebbares Fenster (ohne Fenster-Unterstützung: eingebetteter Dialog).
 * Liefert true, wenn angemeldet wurde.
 */
export async function askGitLogin(root: string, url: string | null, login: (user: string, password: string) => Promise<void>): Promise<boolean> {
  if (osWindowsAvailable()) {
    const r = await openDialogWindow<{ signedIn: boolean }>('gitlogin', 'Git Sign In', { width: 420, height: 250 }, { project: root, url }, { modal: true }).catch(() => null)
    return r?.signedIn === true
  }
  return new Promise<boolean>((resolve) => void openUiDialog('git.login', { url, login, onResult: resolve }))
}
