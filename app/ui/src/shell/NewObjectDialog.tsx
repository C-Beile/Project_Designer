import { useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { NewObjectKind } from '../wire/types'
import { localNameError } from '../tree/nameRules'
import { Modal } from '../core/Modal'
import { TypeCombo } from './TypeCombo'
import { errorText } from '../core/errorText'
import { Button, Dropdown, Input } from '../core/ui/controls'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

// "Create New Model" (DESIGNER_BEHAVIOR_SPEC.md 4.2): project, type and name. The Finish button stays off
// until the name passes all checks, a project is chosen and the type is supported. A type with a fixed name
// shows no name field. Title and entity fields are an addition for types that need them (not in the
// original). File > New and the "New" entry of the tree create one data model of the project. Types whose
// minimal file is not evidenced yet are listed but dimmed, with the reason as tooltip. Nothing is written
// before the Finish button.

export const CREATE_MODEL_TITLE = 'Create New Model'

export function NewObjectDialog({
  api,
  projectRoot,
  projects,
  initialFolder,
  onClose,
  onCreated,
}: {
  api: ForgeApi
  projectRoot: string
  /** All open projects for the Project combo; defaults to the one given. */
  projects?: string[]
  /** Type preselected by the folder the user right-clicked, if any. */
  initialFolder: string | null
  onClose: () => void
  onCreated: (aodPath: string, folder: string, name: string) => void
}) {
  const [project, setProject] = useState(projectRoot)
  const [kinds, setKinds] = useState<NewObjectKind[]>([])
  const [folder, setFolder] = useState<string | null>(initialFolder)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [reference, setReference] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useAbortableEffect((signal) => {
    void api.newObjectKinds().then((list) => {
      if (signal.aborted) return
      setKinds(list)
      setFolder((cur) => (cur && list.some((k) => k.folder === cur && k.enabled) ? cur : (list.find((k) => k.enabled)?.folder ?? null)))
    })
  }, [api])

  const kind = kinds.find((k) => k.folder === folder) ?? null

  const fixedName = kind?.fixed_name ?? null

  useAbortableEffect((signal) => {
    if (!folder) {
      setNameError(null)
      return
    }
    if (fixedName) {
      setNameError(null)
      return
    }
    const local = localNameError(name, folder)
    if (local) {
      setNameError(local)
      return
    }
    void api.validateNewName(project, folder, name).then((msg) => {
      if (!signal.aborted) setNameError(msg)
    })
  }, [api, project, folder, name, fixedName])

  const ready = !!kind && kind.enabled && !!project && (fixedName ? true : name.length > 0 && !nameError) && (!kind.needs_title || title.trim().length > 0)

  async function create() {
    if (!ready || !kind) return
    try {
      const aod = await api.createObject(project, kind.folder, fixedName ?? name, kind.needs_title ? title.trim() : null, kind.reference_label && reference.trim() ? reference.trim() : null)
      onCreated(aod, kind.folder, fixedName ?? name)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title={CREATE_MODEL_TITLE}
      onClose={onClose}
      footer={
        <>
          <Button variant="bare" isDisabled={!ready} onClick={() => void create()}>
            Finish
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <label className="forge-field">
        <span>Project:</span>
        <Dropdown value={project} aria-label="Project" isDisabled={(projects?.length ?? 0) < 2} options={(projects && projects.length > 0 ? projects : [projectRoot]).map((p) => ({ id: p, label: p.split(/[\/]/).filter(Boolean).pop() ?? p }))} onChange={(v) => setProject(v)} />
      </label>
      <div className="forge-field">
        <span>Type:</span>
        <TypeCombo kinds={kinds} value={folder} onChange={setFolder} />
      </div>
      {fixedName ? null : (
        <label className="forge-field">
          <span>Name:</span>
          <Input
            type="text"
            value={name}
            aria-label="Object name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
        </label>
      )}
      {kind && !kind.enabled ? <p className="forge-field-hint">{kind.hint}</p> : null}
      {nameError ? (
        <p className="forge-field-error" role="alert">
          {nameError}
        </p>
      ) : null}
      {kind?.needs_title ? (
        <label className="forge-field">
          <span>Title</span>
          <Input type="text" value={title} aria-label="Object title" onChange={(e) => setTitle(e.target.value)} />
        </label>
      ) : null}
      {kind?.reference_label ? (
        <label className="forge-field">
          <span>{kind.reference_label}</span>
          <Input type="text" value={reference} aria-label={kind.reference_label} onChange={(e) => setReference(e.target.value)} />
        </label>
      ) : null}
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
