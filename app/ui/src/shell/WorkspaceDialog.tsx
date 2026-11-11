import { useEffect, useMemo, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Modal } from '../core/Modal'
import { errorText } from '../core/errorText'
import { samePath } from './shellHelpers'
import { getWorkspaceFolder, setWorkspaceFolder, takePendingWorkspaceFolder } from '../settings/workspaceFolder'
import type { FoundProjectDto } from '../wire/types'

// "Open Projects from Folder": one folder holds all ADITO projects of a person; the dialog lists them and the
// tree shows only the ones ticked here. Unticking an open project closes it, ticking a closed one opens it.

export function WorkspaceDialog({
  api,
  openProjects,
  onApply,
  onClose,
}: {
  api: ForgeApi
  openProjects: string[]
  onApply: (toOpen: string[], toClose: string[], folder: string) => void
  onClose: () => void
}) {
  const [folder, setFolder] = useState(() => takePendingWorkspaceFolder() ?? getWorkspaceFolder())
  const [found, setFound] = useState<FoundProjectDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(openProjects))

  useEffect(() => {
    if (folder === '') {
      setFound(null)
      return
    }
    let cancelled = false
    setError(null)
    api
      .findProjectsInFolder(folder)
      .then((list) => {
        if (cancelled) return
        setFound(list)
        // Projects of the folder that are open now start ticked.
        setTicked(new Set(list.filter((p) => openProjects.some((o) => samePath(o, p.path))).map((p) => p.path)))
      })
      .catch((e) => {
        if (!cancelled) {
          setFound([])
          setError(errorText(e))
        }
      })
    return () => {
      cancelled = true
    }
    // The open projects are read once per folder: ticking must not be reset by the project list changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, folder])

  async function chooseFolder() {
    const picked = await api.pickProjectFolder('Folder with all your ADITO projects').catch(() => null)
    if (picked) setFolder(picked)
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (found ?? []).filter((p) => q === '' || p.name.toLowerCase().includes(q))
  }, [found, filter])

  const toggle = (path: string) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  function apply() {
    const all = found ?? []
    const toOpen = all.filter((p) => ticked.has(p.path) && !openProjects.some((o) => samePath(o, p.path))).map((p) => p.path)
    const toClose = openProjects.filter((o) => all.some((p) => samePath(p.path, o)) && !all.some((p) => ticked.has(p.path) && samePath(p.path, o)))
    setWorkspaceFolder(folder)
    onApply(toOpen, toClose, folder)
  }

  return (
    <Modal
      title="Open Projects from Folder"
      onClose={onClose}
      onEnter={folder !== '' ? apply : undefined}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={found === null} onClick={apply}>
            OK
          </button>
        </>
      }
    >
      <div className="ws-dialog">
        <div className="ws-folder">
          <span className="ws-folder-path" title={folder}>
            {folder === '' ? 'No folder chosen yet' : folder}
          </span>
          <button type="button" onClick={() => void chooseFolder()}>
            {folder === '' ? 'Choose folder...' : 'Change...'}
          </button>
        </div>
        {error ? <p className="forge-field-error">{error}</p> : null}
        {found && found.length === 0 && !error ? <p className="forge-field-hint">No ADITO projects found directly inside this folder.</p> : null}
        {found && found.length > 0 ? (
          <>
            <div className="ws-tools">
              <input type="search" value={filter} placeholder="Filter projects" aria-label="Filter projects" onChange={(e) => setFilter(e.target.value)} />
              <button type="button" onClick={() => setTicked(new Set(found.map((p) => p.path)))}>
                All
              </button>
              <button type="button" onClick={() => setTicked(new Set())}>
                None
              </button>
              <span className="ws-count">
                {ticked.size} of {found.length} shown in the tree
              </span>
            </div>
            <ul className="ws-list">
              {shown.map((p) => (
                <li key={p.path}>
                  <label>
                    <input type="checkbox" checked={ticked.has(p.path)} onChange={() => toggle(p.path)} />
                    <span className="ws-name">{p.name}</span>
                    {openProjects.some((o) => samePath(o, p.path)) ? <span className="ws-open">open</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
