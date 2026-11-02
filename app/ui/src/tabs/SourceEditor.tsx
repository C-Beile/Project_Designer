import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { ObjectSource, UndoRedoOutcome } from '../wire/types'
import type { Problem } from '../problems/problemStore'
import { MonacoText, type EditorMarker, type MonacoTextHandle } from './MonacoText'

// Source sub-tab: the raw `.aod` file. Edits are handed to the backend after a short pause (and
// before every save), where they take the same byte-exact path as Properties edits and become
// one undo step. Text the backend rejects stays in the editor and in `drafts`, so switching
// sub-tabs never loses it; Save is refused until it is fixed.

const APPLY_DELAY_MS = 600

export function SourceEditor({
  api,
  nodeId,
  version,
  drafts,
  onApplied,
  registerFlush,
  problems,
  reveal,
}: {
  api: ForgeApi
  nodeId: string
  /** Bumped whenever the object changed elsewhere (Properties, undo/redo). */
  version: number
  /** Source text the backend has not accepted yet, per node id. */
  drafts: Map<string, string>
  onApplied: (nodeId: string, outcome: UndoRedoOutcome) => void
  registerFlush: (nodeId: string, flush: (() => Promise<void>) | null) => void
  problems?: Problem[]
  reveal?: { line: number; column?: number; token: number }
}) {
  const [source, setSource] = useState<{ initial: string; readOnly: boolean } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<MonacoTextHandle | null>(null)
  const markers = useMemo<EditorMarker[]>(
    () => (problems ?? []).filter((p) => p.line).map((p) => ({ line: p.line!, column: p.column, message: p.message, severity: p.severity })),
    [problems],
  )
  const current = useRef('')
  const applied = useRef('')
  const timer = useRef<number | undefined>(undefined)
  const onAppliedRef = useRef(onApplied)
  onAppliedRef.current = onApplied

  const apply = useCallback(async () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    const text = current.current
    if (text === applied.current) {
      drafts.delete(nodeId)
      setError(null)
      return
    }
    try {
      const outcome = await api.setObjectSource(nodeId, text)
      applied.current = text
      if (current.current === text) drafts.delete(nodeId)
      setError(null)
      onAppliedRef.current(nodeId, outcome)
    } catch (e) {
      drafts.set(nodeId, text)
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [api, nodeId, drafts])
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setLoadError(null)
    setError(null)
    api
      .getObjectSource(nodeId)
      .then((s: ObjectSource) => {
        if (cancelled) return
        const draft = drafts.get(nodeId)
        applied.current = s.text
        current.current = draft ?? s.text
        setSource({ initial: current.current, readOnly: s.read_only })
        if (draft !== undefined && draft !== s.text) timer.current = window.setTimeout(() => void applyRef.current(), 0)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e instanceof Error ? e.message : e))
      })
    return () => {
      cancelled = true
    }
  }, [api, nodeId, drafts])

  useEffect(() => {
    registerFlush(nodeId, () => applyRef.current())
    return () => {
      registerFlush(nodeId, null)
      // Leaving the sub-tab applies what was typed; a rejection lands in `drafts`.
      void applyRef.current()
    }
  }, [nodeId, registerFlush])

  // The object changed elsewhere: show the new text unless the user is typing right now.
  const firstVersion = useRef(version)
  useEffect(() => {
    if (version === firstVersion.current || timer.current !== undefined || !source) return
    let cancelled = false
    api
      .getObjectSource(nodeId)
      .then((s) => {
        if (cancelled || timer.current !== undefined || s.text === current.current) return
        current.current = s.text
        applied.current = s.text
        drafts.delete(nodeId)
        handle.current?.setValue(s.text)
        setError(null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Only a new version triggers a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  function onChange(text: string) {
    current.current = text
    if (text === applied.current) drafts.delete(nodeId)
    else drafts.set(nodeId, text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void applyRef.current(), APPLY_DELAY_MS)
  }

  if (loadError) return <div className="forge-editor-empty"><p className="forge-field-hint">The source could not be read: {loadError}</p></div>
  if (!source) return <div className="forge-editor-empty"><p className="forge-field-hint">Please Wait…</p></div>

  return (
    <div className="forge-source">
      {source.readOnly ? (
        <div className="forge-source-note" role="note">
          Read-only: this object belongs to an installed module.
        </div>
      ) : null}
      <MonacoText initial={source.initial} language="xml" readOnly={source.readOnly} label="Source" onChange={onChange} handleRef={handle} markers={markers} reveal={reveal} />
      {error ? (
        <div className="forge-source-error" role="alert">
          Not applied: {error}
        </div>
      ) : null}
    </div>
  )
}
