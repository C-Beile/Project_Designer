import { useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Modal } from '../core/Modal'
import { errorText } from '../core/errorText'

// New Project, like the original Designer: first the source of the project, then its details. A clone
// from a Git repository ends with the choice of the branch to check out. Sources that need a server or
// a system database are listed too but stay off until they exist.

type Source = 'empty' | 'clone' | 'template' | 'systemDb' | 'cloud'

const SOURCES: { id: Source; label: string; available: boolean; hint?: string }[] = [
  { id: 'empty', label: 'Create an empty project', available: true },
  { id: 'clone', label: 'Clone from a Git repository', available: true },
  { id: 'template', label: 'Load a template from a server', available: false, hint: 'Not available yet.' },
  { id: 'systemDb', label: 'Create from a system database', available: false, hint: 'Not available yet.' },
  { id: 'cloud', label: 'Load a cloud system', available: false, hint: 'Not available yet.' },
]

const LOCATION_KEY = 'dito.newProject.location'

/** `https://host/group/name.git` and `git@host:group/name.git` give `name`. */
export function projectNameFromUrl(url: string): string {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '')
}

function parentOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length < 2) return ''
  const sep = path.includes('\\') ? '\\' : '/'
  return (path.startsWith('/') ? '/' : '') + parts.slice(0, -1).join(sep)
}

function storedLocation(fallback: string): string {
  try {
    return window.localStorage.getItem(LOCATION_KEY) || fallback
  } catch {
    return fallback
  }
}

export function NewProjectDialog({ api, currentProject, onClose, onCreated }: { api: ForgeApi; currentProject: string; onClose: () => void; onCreated: (projectRoot: string) => void }) {
  const [step, setStep] = useState<'source' | 'details' | 'branch'>('source')
  const [source, setSource] = useState<Source>('clone')
  const [url, setUrl] = useState('')
  const [location, setLocation] = useState(() => storedLocation(parentOf(currentProject)))
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [sshKey, setSshKey] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState('')
  const [branches, setBranches] = useState<{ locals: string[]; remotes: string[]; current: string }>({ locals: [], remotes: [], current: '' })
  const [branch, setBranch] = useState('')

  const choices = useMemo(() => {
    const remoteOnly = branches.remotes.map((r) => r.replace(/^origin\//, '')).filter((r) => !branches.locals.includes(r))
    return [...branches.locals, ...remoteOnly]
  }, [branches])

  const rememberLocation = () => {
    try {
      window.localStorage.setItem(LOCATION_KEY, location.trim())
    } catch {
      // the location is just not remembered
    }
  }

  const browseLocation = async () => {
    const picked = await api.pickProjectFolder('Project Location').catch(() => null)
    if (picked) setLocation(picked)
  }

  const browseKey = async () => {
    const picked = await api.pickFile('SSH key', 'Key file', []).catch(() => null)
    if (picked) setSshKey(picked)
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      if (source === 'empty') {
        const dir = await api.projectCreateEmpty(location.trim(), name.trim())
        rememberLocation()
        onCreated(dir)
        return
      }
      const dir = await api.projectClone(url.trim(), location.trim(), name.trim(), sshKey.trim() || null, password || null)
      rememberLocation()
      setPassword('')
      setCreated(dir)
      const overview = await api.gitOverview(dir).catch(() => null)
      if (!overview) {
        onCreated(dir)
        return
      }
      const locals = overview.branches.map((b) => b.name)
      const current = overview.branch ?? locals[0] ?? ''
      setBranches({ locals, remotes: overview.remote_branches, current })
      setBranch(current)
      setStep('branch')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      const wanted = branch.trim()
      if (wanted && wanted !== branches.current) {
        if (branches.locals.includes(wanted)) await api.gitCheckout(created, wanted)
        else await api.gitCreateBranch(created, wanted, `origin/${wanted}`)
      }
      onCreated(created)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const detailsValid = location.trim() !== '' && name.trim() !== '' && (source === 'empty' || url.trim() !== '')

  const footer =
    step === 'source' ? (
      <>
        <button type="button" onClick={() => setStep('details')}>
          Next
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </>
    ) : step === 'details' ? (
      <>
        <button type="button" onClick={() => setStep('source')} disabled={busy}>
          Back
        </button>
        <button type="button" onClick={() => void create()} disabled={busy || !detailsValid}>
          {busy ? (source === 'clone' ? 'Cloning…' : 'Creating…') : source === 'clone' ? 'Next' : 'Finish'}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </>
    ) : (
      <>
        <button type="button" onClick={() => void finish()} disabled={busy || !branch}>
          Finish
        </button>
        <button type="button" onClick={() => onCreated(created)} disabled={busy}>
          Skip
        </button>
      </>
    )

  return (
    <Modal title="New Project" onClose={onClose} footer={footer}>
      <div className="forge-newproject">
        {step === 'source' ? (
          <fieldset className="forge-opt-group">
            <legend>Create the project from</legend>
            {SOURCES.map((s) => (
              <label key={s.id} className="forge-check" title={s.available ? undefined : s.hint}>
                <input type="radio" name="project-source" checked={source === s.id} disabled={!s.available} onChange={() => setSource(s.id)} />
                <span>
                  {s.label}
                  {s.available ? '' : ' (not available yet)'}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {step === 'details' ? (
          <>
            {source === 'clone' ? (
              <label className="forge-field">
                <span>Repository URL:</span>
                <input
                  type="text"
                  aria-label="Repository URL"
                  value={url}
                  placeholder="https://github.com/group/project.git"
                  onChange={(e) => {
                    setUrl(e.target.value)
                    if (!nameTouched) setName(projectNameFromUrl(e.target.value))
                  }}
                />
              </label>
            ) : null}
            <label className="forge-field">
              <span>Project Location:</span>
              <span className="forge-field-row">
                <input type="text" aria-label="Project Location" value={location} onChange={(e) => setLocation(e.target.value)} />
                <button type="button" aria-label="Browse project location" onClick={() => void browseLocation()}>
                  {'…'}
                </button>
              </span>
            </label>
            <label className="forge-field">
              <span>Project Name:</span>
              <input
                type="text"
                aria-label="Project Name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameTouched(true)
                }}
              />
            </label>
            {source === 'clone' ? (
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
                  <span>SSH Password (optional):</span>
                  <input type="password" aria-label="SSH Password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
                <p className="forge-field-hint">The password is only used for this clone and is not stored.</p>
              </>
            ) : null}
          </>
        ) : null}

        {step === 'branch' ? (
          <>
            <p>The repository was cloned. Which branch should be checked out?</p>
            <label className="forge-field">
              <span>Branch:</span>
              <select aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
                {choices.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
