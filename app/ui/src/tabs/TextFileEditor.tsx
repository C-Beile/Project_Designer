import { useEffect, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { MonacoText, type MonacoTextHandle } from './MonacoText'
import { applyJditoTypes } from '../theme/monacoJdito'
import { useScm } from '../scm/scmStore'
import type { Gutter } from '../wire/types'

// Editor of a plain project file (package.json, .js, ...). Unsaved text lives in `drafts`, so it
// survives switching sub-tabs or tabs and is written by the shell's Save.

const LANGUAGES: Record<string, string> = {
  json: 'json',
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown',
  xml: 'xml',
  aod: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  css: 'css',
  html: 'html',
}

export function languageForFile(label: string): string {
  const dot = label.lastIndexOf('.')
  return (dot >= 0 && LANGUAGES[label.slice(dot + 1).toLowerCase()]) || 'plaintext'
}

export function TextFileEditor({
  api,
  path,
  label,
  projectRoot,
  readOnly,
  drafts,
  onDirty,
  isNew,
}: {
  api: ForgeApi
  path: string
  label: string
  projectRoot: string
  readOnly: boolean
  drafts: Map<string, string>
  onDirty: (path: string, dirty: boolean) => void
  /** Code property not set yet: the file does not exist and is created on the first save. */
  isNew?: boolean
}) {
  const [loaded, setLoaded] = useState<{ initial: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<MonacoTextHandle | null>(null)
  const scm = useScm()
  const [gutter, setGutter] = useState<Gutter | null>(null)

  // Changed lines against HEAD; read again whenever the Git status was refreshed (after a save, a Git action).
  useEffect(() => {
    if (isNew || !projectRoot.trim()) return
    let cancelled = false
    api
      .scmGutter(projectRoot, path)
      .then((g) => !cancelled && setGutter(g))
      .catch(() => !cancelled && setGutter(null))
    return () => {
      cancelled = true
    }
  }, [api, projectRoot, path, isNew, scm.version])

  useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setError(null)
    if (isNew) {
      setLoaded({ initial: drafts.get(path) ?? '' })
      return () => {
        cancelled = true
      }
    }
    // A linked-file reference may be an absolute path, which is what the tree gives for files.
    api
      .readLinkedFile(projectRoot, path)
      .then((text) => {
        if (cancelled) return
        setLoaded({ initial: drafts.get(path) ?? text })
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      })
    return () => {
      cancelled = true
    }
  }, [api, path, projectRoot, drafts, isNew])

  const language = languageForFile(label)
  useEffect(() => {
    if (language === 'javascript') void applyJditoTypes(api, projectRoot)
  }, [api, projectRoot, language])

  if (error) return <div className="forge-editor-empty"><p className="forge-field-hint">{error}</p></div>
  if (!loaded) return <div className="forge-editor-empty"><p className="forge-field-hint">Please Wait…</p></div>

  return (
    <div className="forge-source">
      {readOnly ? (
        <div className="forge-source-note" role="note">
          Read-only: this file belongs to an installed module.
        </div>
      ) : null}
      <MonacoText
        initial={loaded.initial}
        language={language}
        modelPath={language === 'javascript' ? path : undefined}
        gutter={gutter}
        readOnly={readOnly}
        label={label}
        handleRef={handle}
        onChange={(text) => {
          drafts.set(path, text)
          onDirty(path, true)
        }}
      />
    </div>
  )
}
