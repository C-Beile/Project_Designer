import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { ForgeApi } from '../api/ForgeApi'
import type { DiffContent } from '../wire/types'
import { Modal } from './Dialogs'

// "Show Changes" of the commit window: the committed version (HEAD) against the working copy of one
// file, side by side and read-only, with the whitespace choice of the original Designer.

const WHITESPACE = [
  { id: 'none', label: 'Do not ignore', trim: false },
  { id: 'edges', label: 'Ignore leading and trailing whitespaces', trim: true },
  { id: 'all', label: 'Ignore all whitespaces', trim: true },
] as const

export function CommitDiffDialog({ api, root, path, onClose }: { api: ForgeApi; root: string; path: string; onClose: () => void }) {
  const [content, setContent] = useState<DiffContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [whitespace, setWhitespace] = useState<(typeof WHITESPACE)[number]['id']>('none')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .scmDiff(root, path, 'unstaged', null)
      .then((c) => !cancelled && setContent(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [api, root, path])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !content || content.binary || content.too_large) return
    let disposed = false
    let cleanup = () => {}
    void Promise.all([import('monaco-editor'), import('../theme/monacoTheme'), import('../tabs/TextFileEditor')]).then(([monaco, theme, text]) => {
      const { currentForgeTheme, ensureMonacoThemesDefined, monacoThemeFor, watchForgeThemeForMonaco } = theme
      const { languageForFile } = text
      if (disposed || !hostRef.current) return
      ensureMonacoThemesDefined()
      const editor = monaco.editor.createDiffEditor(host, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        renderSideBySide: true,
        theme: monacoThemeFor(currentForgeTheme()),
        ariaLabel: `Diff for file ${path}`,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        ignoreTrimWhitespace: false,
      })
      editorRef.current = editor
      const language = languageForFile(path)
      const original = monaco.editor.createModel(content.original, language)
      const modified = monaco.editor.createModel(content.modified, language)
      editor.setModel({ original, modified })
      const stopTheme = watchForgeThemeForMonaco((name) => monaco.editor.setTheme(name))
      cleanup = () => {
        stopTheme()
        editorRef.current = null
        editor.dispose()
        original.dispose()
        modified.dispose()
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [content, path])

  useEffect(() => {
    const trim = WHITESPACE.find((w) => w.id === whitespace)?.trim ?? false
    editorRef.current?.updateOptions({ ignoreTrimWhitespace: trim })
  }, [whitespace, content])

  const goTo = (dir: 'next' | 'previous') => (editorRef.current as unknown as { goToDiff?: (d: 'next' | 'previous') => void } | null)?.goToDiff?.(dir)

  let body
  if (error) body = <p className="forge-field-error" role="alert">{error}</p>
  else if (!content) body = <p className="forge-field-hint">Please Wait…</p>
  else if (content.binary) body = <p className="forge-field-hint">{path} is a binary file; there is no text diff.</p>
  else if (content.too_large) body = <p className="forge-field-hint">{path} is larger than 2 MB; the diff is not shown.</p>
  else body = <div ref={hostRef} className="forge-monaco-host" data-testid="commit-diff-host" />

  return (
    <Modal
      title={`Diff for file ${path}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="commit-diff">
        <div className="commit-diff-bar">
          <span className="commit-diff-nav">
            <button type="button" title="Next difference" aria-label="Next difference" onClick={() => goTo('next')}>
              ↓
            </button>
            <button type="button" title="Previous difference" aria-label="Previous difference" onClick={() => goTo('previous')}>
              ↑
            </button>
          </span>
          <label className="commit-diff-ws">
            <span>Whitespace Treatment:</span>
            <select value={whitespace} onChange={(e) => setWhitespace(e.target.value as typeof whitespace)} aria-label="Whitespace Treatment">
              {WHITESPACE.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="commit-diff-heads">
          <span>HEAD</span>
          <span>Working dir</span>
        </div>
        {body}
      </div>
    </Modal>
  )
}
