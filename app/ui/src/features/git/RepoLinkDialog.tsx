import { useEffect, useState } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import { errorText } from '../../core/errorText'
import { Modal } from '../../core/Modal'
import { notify } from '../../core/notifications'
import type { RepoLink } from '../../wire/types'

interface Props {
  api: ForgeApi
  projectRoot: string
  onClose: () => void
  /** Nach erfolgreichem Verbinden: Shell lädt den Git-Stand neu. */
  onDone?: () => void
}

/** Team > Git > Repository: zeigt die Verknüpfung des Projektordners und lässt `origin` setzen oder die Verbindung neu herstellen. */
export function RepoLinkDialog({ api, projectRoot, onClose, onDone }: Props) {
  const [link, setLink] = useState<RepoLink | null>(null)
  const [url, setUrl] = useState('')
  const [sshKey, setSshKey] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .gitRepoLink(projectRoot)
      .then((l) => {
        if (cancelled) return
        setLink(l)
        setUrl(l.url ?? '')
      })
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, projectRoot])

  const isRepo = link?.is_repo === true
  const browseKey = async () => {
    const picked = await api.pickFile('SSH key', 'Key file', []).catch(() => null)
    if (picked) setSshKey(picked)
  }
  const submit = async () => {
    if (busy || !url.trim()) return
    setBusy(true)
    setError(null)
    try {
      const text = await api.gitConnect(projectRoot, url.trim(), sshKey.trim() || null, user.trim() || null, password || null)
      notify(text, { kind: 'success' })
      onDone?.()
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Git Repository"
      onClose={onClose}
      onEnter={() => void submit()}
      footer={
        <>
          <button type="button" disabled={busy || !url.trim() || link === null} onClick={() => void submit()}>
            {isRepo ? 'Save' : 'Connect'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {link === null && !error ? <p>Loading...</p> : null}
      {link ? (
        <p>
          {isRepo ? `This folder is a Git repository${link.branch ? ` (branch ${link.branch})` : ''}.` : 'This folder is not a Git repository yet. Connecting creates one, fetches the remote and takes over its branch. Your files stay as they are.'}
        </p>
      ) : null}
      <label className="forge-field">
        <span>Repository URL:</span>
        <input type="text" aria-label="Repository URL" placeholder="https://host/group/project.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      {!isRepo && link ? (
        <>
          <label className="forge-field">
            <span>SSH Key Location (optional):</span>
            <span className="forge-field-row">
              <input type="text" aria-label="SSH Key Location" value={sshKey} onChange={(e) => setSshKey(e.target.value)} />
              <button type="button" aria-label="Browse SSH key" onClick={() => void browseKey()}>
                {'…'}
              </button>
            </span>
          </label>
          <label className="forge-field">
            <span>User Name (optional):</span>
            <input type="text" aria-label="User Name" autoComplete="off" value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className="forge-field">
            <span>Password or Access Token (optional):</span>
            <input type="password" aria-label="Password or Access Token" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="forge-field-hint">For https:// addresses enter your user name and a personal access token. For ssh:// the password unlocks the key. Nothing is stored.</p>
        </>
      ) : null}
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
