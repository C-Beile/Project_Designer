import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { getEditorFor } from '../editors/registry'
import { ProjectIndexContext, type ProjectIndex } from '../editors/projectIndex'
import { saveCodeProperty } from '../properties/codeSave'
import { choiceDialog, DialogHost } from '../shell/dialogService'
import { ToastHost } from '../shell/notifications'
import { collectByType, entityOfView, findObject } from '../shell/treeIndex'
import { ObjectEditorArea } from '../tabs/ObjectEditorArea'
import { isFileNode, type EditorTab, type SubTab } from '../tabs/tabModel'
import type { DbStatus, TreeNode, UndoRedoOutcome, WireValue } from '../wire/types'
import { EVENTS, type EditorCommand, type EditorDockResult, type EditorWindowPayload, type FloatAction } from './protocol'
import { getWindowBackend } from './windowService'

// Content of the window an editor was moved into. The document itself stays in the backend (one
// copy for all windows), so this window only draws the editor and reports back what the main
// window must know: unsaved state, edits, the element that is selected, and a request to dock.
// A document is open in exactly one window: the main window removes its tab while this one lives.

const NO_DB: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }
const IGNORED_DB = (): void => {}

function send(action: FloatAction): void {
  void getWindowBackend().emit(EVENTS.floatAction, action)
}

export function EditorWindowApp({ name, api }: { name: string; api: ForgeApi }) {
  const [payload, setPayload] = useState<EditorWindowPayload | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getWindowBackend()
      .payload('editor', name)
      .then((text) => {
        if (cancelled) return
        try {
          const parsed = text ? (JSON.parse(text) as EditorWindowPayload) : null
          if (parsed?.node?.id) setPayload(parsed)
          else setFailed('The editor window did not receive its document.')
        } catch {
          setFailed('The editor window could not read its document.')
        }
      })
      .catch((e) => !cancelled && setFailed(String(e)))
    return () => {
      cancelled = true
    }
  }, [name])

  let body: ReactNode
  if (failed) body = <p className="forge-field-error">{failed}</p>
  else if (!payload) body = <p className="forge-field-hint">Please Wait…</p>
  else body = <EditorWindowBody name={name} api={api} payload={payload} />
  return (
    <div className="forge-editor-window" data-editor-window={name}>
      {body}
      <DialogHost />
      <ToastHost />
    </div>
  )
}

function EditorWindowBody({ name, api, payload }: { name: string; api: ForgeApi; payload: EditorWindowPayload }) {
  const { node, project } = payload
  const [sub, setSub] = useState<SubTab>(payload.sub)
  const [value, setValue] = useState<WireValue | null>(null)
  const [version, setVersion] = useState(0)
  const [dirty, setDirty] = useState(payload.dirty)
  const [status, setStatus] = useState('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [selection, setSelection] = useState<{ nodeId: string; path: string } | null>(null)
  const drafts = useRef(new Map<string, string>())
  const flushers = useRef(new Map<string, () => Promise<void>>())
  const sqlTexts = useRef(new Map<string, string>())
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const isFile = isFileNode(node)
  const Editor = isFile ? undefined : getEditorFor(node.object_type ?? null)
  const tab: EditorTab = useMemo(() => ({ id: node.id, node, project, sub }), [node, project, sub])

  const loadValue = useCallback(async () => {
    if (isFile) return
    try {
      setValue(await api.getPropertyTree(node.id))
      setVersion((v) => v + 1)
    } catch (e) {
      setStatus(String(e))
    }
  }, [api, node.id, isFile])

  useEffect(() => {
    void loadValue()
  }, [loadValue])

  useEffect(() => {
    let cancelled = false
    api
      .openProject(project)
      .then((t) => !cancelled && setTree(t))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api, project])

  const markDirty = useCallback((next: boolean) => {
    if (dirtyRef.current === next) return
    dirtyRef.current = next
    setDirty(next)
    send({ type: 'editorDirty', id: node.id, dirty: next })
  }, [node.id])

  // Applies pending Source text, writes a file draft or a code property, then saves the object.
  const save = useCallback(async (): Promise<boolean> => {
    await flushers.current.get(node.id)?.()
    const draft = drafts.current.get(node.id)
    try {
      if (isFile) {
        if (draft !== undefined) {
          const code = node.code
          if (code) {
            const result = await saveCodeProperty(api, code, draft, project)
            code.isNew = false
            if (result.outcome) send({ type: 'edited', nodeId: code.ownerNodeId })
            if (result.message) setStatus(result.message)
          } else {
            await api.writeLinkedFile(project, node.id, draft)
          }
          drafts.current.delete(node.id)
        }
        markDirty(false)
        return true
      }
      if (draft !== undefined) {
        setStatus('The Source text of this object has errors and was not applied; fix it before saving.')
        return false
      }
      await api.save(node.id)
      markDirty(false)
      setStatus('Saved.')
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.startsWith('CONFLICT:')) {
        const choice = await choiceDialog(
          `${node.label} was changed on disk after it was opened, and it has unsaved edits.`,
          [
            { id: 'overwrite', label: 'Overwrite file on disk' },
            { id: 'reload', label: 'Reload from disk' },
            { id: 'cancel', label: 'Cancel' },
          ],
          'File changed on disk',
        )
        if (choice === 'overwrite') {
          await api.saveOverwrite(node.id)
          markDirty(false)
          setStatus('Saved. The version that was on disk is kept in the backup folder (Help > Open Backup Folder).')
          return true
        }
        if (choice === 'reload') {
          await api.reloadObject(node.id)
          markDirty(false)
          await loadValue()
          setStatus('Reloaded from disk, your unsaved edits of this object were discarded.')
          return false
        }
        return false
      }
      setStatus(message)
      return false
    }
  }, [api, node, project, isFile, markDirty, loadValue])

  const saveRef = useRef(save)
  saveRef.current = save

  // Leaving the window (dock or close): a file with unsaved text asks first, like closing its tab.
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    await flushers.current.get(node.id)?.()
    if (!isFile || !dirtyRef.current) return true
    const choice = await choiceDialog(
      `${node.label} has unsaved changes.`,
      [
        { id: 'save', label: 'Save' },
        { id: 'discard', label: "Don't Save" },
        { id: 'cancel', label: 'Cancel' },
      ],
      'Close',
    )
    if (choice === 'save') return saveRef.current()
    if (choice === 'discard') {
      drafts.current.delete(node.id)
      markDirty(false)
      return true
    }
    return false
  }, [node, isFile, markDirty])

  const dock = useCallback(async () => {
    if (!(await confirmLeave())) return
    const result: EditorDockResult = { dock: true, sub }
    await getWindowBackend().result('editor', name, JSON.stringify(result))
  }, [confirmLeave, name, sub])
  const dockRef = useRef(dock)
  dockRef.current = dock

  const closeWindow = useCallback(async () => {
    if (!(await confirmLeave())) return
    await getWindowBackend().result('editor', name, null)
  }, [confirmLeave, name])
  const closeRef = useRef(closeWindow)
  closeRef.current = closeWindow

  // A file with unsaved text keeps the window open until the user has answered.
  const guarded = isFile && dirty
  useEffect(() => {
    void getWindowBackend().closeGuard('editor', name, guarded).catch(() => {})
    return () => {
      void getWindowBackend().closeGuard('editor', name, false).catch(() => {})
    }
  }, [name, guarded])

  useEffect(() => {
    const backend = getWindowBackend()
    const unsubs: (() => void)[] = []
    let dead = false
    const add = (p: Promise<() => void>) =>
      void p.then((u) => {
        if (dead) u()
        else unsubs.push(u)
      })
    add(
      backend.listen(EVENTS.closeRequested, (p) => {
        const e = p as { kind?: string; name?: string }
        if (e.kind === 'editor' && e.name === name) void closeRef.current()
      }),
    )
    add(
      backend.listen(EVENTS.editorCommand, (p) => {
        const c = p as EditorCommand
        if (c.id !== node.id) return
        if (c.type === 'save') void saveRef.current().then((ok) => send({ type: 'editorSaved', id: node.id, ok }))
        else if (c.type === 'refresh') void loadValue()
        else if (c.type === 'dock') void dockRef.current()
        else if (c.type === 'focus') window.focus()
      }),
    )
    return () => {
      dead = true
      unsubs.forEach((u) => u())
    }
  }, [name, node.id, loadValue])

  // The Properties and Navigator of the main window follow this window while it has the focus.
  useEffect(() => {
    if (isFile) return
    const onFocus = () => send({ type: 'inspect', nodeId: node.id, path: '$', label: node.label })
    window.addEventListener('focus', onFocus)
    if (document.hasFocus()) onFocus()
    return () => window.removeEventListener('focus', onFocus)
  }, [node.id, node.label, isFile])

  const applied = useCallback(
    (_nodeId: string, outcome: UndoRedoOutcome) => {
      setValue(outcome.tree)
      setVersion((v) => v + 1)
      markDirty(true)
      send({ type: 'edited', nodeId: node.id })
    },
    [node.id, markDirty],
  )

  const undoRedo = useCallback(
    async (kind: 'undo' | 'redo') => {
      try {
        applied(node.id, kind === 'undo' ? await api.undo(node.id) : await api.redo(node.id))
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e))
      }
    },
    [api, node.id, applied],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void saveRef.current()
        return
      }
      const typing = e.target instanceof Element && (e.target.closest('.monaco-editor') !== null || /^(input|textarea|select)$/i.test(e.target.tagName))
      if (typing || isFile) return
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undoRedo('undo')
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        void undoRedo('redo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFile, undoRedo])

  const index = useMemo<ProjectIndex>(
    () => ({
      findObject: (type, objectName) => findObject(tree, type, objectName),
      namesOf: (type) => [...(collectByType(tree).get(type) ?? [])],
      entityOfView: (viewName) => entityOfView(tree, viewName),
      selection,
      openObject: (n) => {
        if (n.object_type) send({ type: 'goTo', objectType: n.object_type, name: n.label })
        else send({ type: 'openFile', path: n.id })
      },
      selectElement: (nodeId, path, label) => {
        setSelection({ nodeId, path })
        send({ type: 'inspect', nodeId, path, label })
      },
      openSql: (sql) => send({ type: 'openSql', sql }),
    }),
    [tree, selection],
  )

  // Dragging the grip back onto the Designer docks the editor again.
  const onGripDragEnd = (e: React.DragEvent) => {
    void getWindowBackend()
      .mainContains(e.screenX, e.screenY)
      .then((inside) => inside && void dockRef.current())
      .catch(() => {})
  }

  return (
    <>
      <div className="forge-ew-bar">
        <span className="forge-ew-grip" draggable onDragEnd={onGripDragEnd} title="Drag onto the Designer window to dock this editor again">
          {'⠿'}
        </span>
        <strong className="forge-ew-title">
          {node.label}
          {dirty ? <span className="forge-tab-dirty" role="img" aria-label="Unsaved changes"> ●</span> : null}
        </strong>
        <span className="forge-ew-fill" />
        <button type="button" onClick={() => void save()} disabled={!dirty} title="Save (Ctrl+S)">
          Save
        </button>
        {!isFile ? (
          <>
            <button type="button" onClick={() => void undoRedo('undo')} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button type="button" onClick={() => void undoRedo('redo')} title="Redo (Ctrl+Y)">
              Redo
            </button>
          </>
        ) : null}
        <button type="button" onClick={() => void dock()} title="Put this editor back into the Designer window">
          Dock
        </button>
      </div>
      <div className="forge-ew-body">
        <ProjectIndexContext.Provider value={index}>
          <ObjectEditorArea
            tab={tab}
            api={api}
            value={value}
            Editor={Editor}
            projectRoot={project}
            version={version}
            drafts={drafts.current}
            onSubTab={setSub}
            onTreeChange={(next) => {
              setValue(next)
              setVersion((v) => v + 1)
              markDirty(true)
              send({ type: 'edited', nodeId: node.id })
            }}
            onApplied={applied}
            registerFlush={(nodeId, flush) => {
              if (flush) flushers.current.set(nodeId, flush)
              else flushers.current.delete(nodeId)
            }}
            onFileDirty={(_path, d) => markDirty(d)}
            db={NO_DB}
            sqlTexts={sqlTexts.current}
            onDbChange={IGNORED_DB}
          />
        </ProjectIndexContext.Provider>
      </div>
      <div className="forge-ew-status" role="status">
        {status}
      </div>
    </>
  )
}
