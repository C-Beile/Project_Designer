import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as monaco from 'monaco-editor'
import type { ForgeApi } from '../api/ForgeApi'
import { addInsertUuidAction } from '../theme/monacoUuid'
import { trackEditorFocus } from '../theme/monacoActions'
import { ensureMonacoWorkers } from '../theme/monacoWorkers'
import { setProblems } from '../problems/problemStore'
import { currentForgeTheme, ensureMonacoThemesDefined, monacoThemeFor, watchForgeThemeForMonaco } from '../theme/monacoTheme'

// Ziel B.3: JDito code field for a `valueProcess`/`displayValueProcess` linked `.js` file.
// Monaco embed ported from the already-verified `spike-editor.md` pattern (plain `monaco-editor`,
// no `@monaco-editor/react`, no web-worker setup - "ausreichend fuer diesen Spike", carried over
// here unchanged). Read/write goes through `ForgeApi.readLinkedFile`/`writeLinkedFile`
// (`app/src-tauri/src/lib.rs` -> `forge_app_core::linked_file`), which resolve the
// `%aditoprj%`-relative reference and write back through the same `platform::fs::atomic_write`
// primitive `.aod` saves use.
//
// **Not wired to the LSP sidecar in this round** (see `lsp_bridge.rs`'s doc comment for why -
// the bridge commands exist and are reachable, ported near-verbatim from the proven spike, but
// wiring+re-verifying live Completion/Diagnostics from this component was a deliberate budget
// tradeoff, documented as an open point in `p4-editor-entity-notes.md`). Syntax highlighting
// alone (Monaco's built-in JS support, no LSP needed) is active.

export function JDitoCodeField({
  projectRoot,
  reference,
  api,
  onClose,
  onSave,
  isNew,
  ownerNodeId,
  ownerName,
}: {
  projectRoot: string
  reference: string
  api: ForgeApi
  onClose: () => void
  /** Replaces writing the linked file itself (module objects: the edit becomes a modification). */
  onSave?: (content: string) => Promise<void>
  /** Property not set yet: the editor starts empty and the file is created on the first save. */
  isNew?: boolean
  /** Object the code belongs to: syntax errors are listed in the Problems tab under it. */
  ownerNodeId?: string
  ownerName?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    ensureMonacoThemesDefined()

    let markerSub: { dispose(): void } | undefined
    const channel = `js:${ownerNodeId ?? ''}|${reference}`
    ;(isNew ? Promise.resolve('') : api.readLinkedFile(projectRoot, reference))
      .then(async (content) => {
        await ensureMonacoWorkers()
        if (disposed || !containerRef.current) return
        editorRef.current = monaco.editor.create(containerRef.current, {
          value: content,
          language: 'javascript',
          automaticLayout: true,
          theme: monacoThemeFor(currentForgeTheme()),
        })
        addInsertUuidAction(editorRef.current)
        trackEditorFocus(editorRef.current)
        editorRef.current.onDidChangeModelContent(() => setDirty(true))
        // Syntax errors found by the language service become entries of the Problems tab.
        const model = editorRef.current.getModel()
        if (model && typeof monaco.editor.onDidChangeMarkers === 'function') {
          const publish = () => {
            const list = monaco.editor
              .getModelMarkers({ resource: model.uri })
              .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
              .map((m) => ({
                id: `${channel}|${m.startLineNumber}|${m.startColumn}|${m.message}`,
                channel,
                source: 'js' as const,
                severity: m.severity === monaco.MarkerSeverity.Error ? ('Error' as const) : ('Warning' as const),
                message: m.message,
                nodeId: ownerNodeId,
                object: ownerName,
                file: reference,
                line: m.startLineNumber,
                column: m.startColumn,
              }))
            setProblems(channel, list)
          }
          markerSub = monaco.editor.onDidChangeMarkers((uris) => {
            if (uris.some((u) => u.toString() === model.uri.toString())) publish()
          })
        }
        setStatus('ready')
      })
      .catch(() => setStatus('error'))

    return () => {
      disposed = true
      markerSub?.dispose()
      setProblems(channel, [])
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [api, projectRoot, reference, isNew, ownerNodeId, ownerName])

  // Keeps this editor's Monaco theme in sync with the titlebar's light/dark toggle
  // (chrome/TitleBar.tsx) - Monaco has no CSS custom property support, so it needs an explicit
  // `setTheme` call whenever `<html data-theme>` changes rather than picking up tokens.css for
  // free the way every other editor does.
  useEffect(() => watchForgeThemeForMonaco((monacoTheme) => monaco.editor.setTheme(monacoTheme)), [])

  async function save() {
    const model = editorRef.current?.getModel()
    if (!model) return
    try {
      if (onSave) await onSave(model.getValue())
      else await api.writeLinkedFile(projectRoot, reference, model.getValue())
      setDirty(false)
      setSaveError(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="jdito-code-field" onKeyDown={onKeyDown}>
      <div className="jdito-code-field-toolbar">
        <span>{reference}</span>
        <button type="button" onClick={() => void save()} disabled={status !== 'ready'}>
          Save{dirty ? ' *' : ''}
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {status === 'error' && <p role="alert">Failed to load linked file.</p>}
      {saveError ? <p role="alert">{saveError}</p> : null}
      <div ref={containerRef} className="jdito-monaco-host" style={{ height: 240 }} />
    </div>
  )
}
