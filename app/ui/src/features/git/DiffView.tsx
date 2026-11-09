import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import type { ForgeApi } from '../../api/ForgeApi'
import type { DiffContent, DiffTarget } from '../../wire/types'
import { currentForgeTheme, ensureMonacoThemesDefined, monacoThemeFor, watchForgeThemeForMonaco } from '../../theme/monacoTheme'
import { languageForFile } from '../../tabs/TextFileEditor'
import { useScm } from '../../core/scm'
import { diffTitle, SIDE_LABEL } from './diffTitle'
import { errorText } from '../../core/errorText'

// Diff tab of the Source Control panel: the two versions of one file side by side in the Monaco
// diff editor, read-only. Which versions depends on where the file was clicked: Changes (index
// against work tree), Staged Changes (HEAD against index) or a commit (parent against commit).

export function DiffView({ api, target }: { api: ForgeApi; target: DiffTarget }) {
  const scm = useScm()
  const [content, setContent] = useState<DiffContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  // The work tree side changes with every save; staged and commit sides only with Git actions.
  const refreshKey = target.side === 'commit' ? 0 : scm.version

  useEffect(() => {
    let cancelled = false
    api
      .scmDiff(target.root, target.path, target.side, target.hash ?? null)
      .then((c) => {
        if (cancelled) return
        setContent(c)
        setError(null)
      })
      .catch((e) => !cancelled && setError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [api, target.root, target.path, target.side, target.hash, refreshKey])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !content || content.binary || content.too_large) return
    ensureMonacoThemesDefined()
    const language = languageForFile(target.path)
    const editor = monaco.editor.createDiffEditor(host, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      theme: monacoThemeFor(currentForgeTheme()),
      ariaLabel: diffTitle(target),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
    })
    const original = monaco.editor.createModel(content.original, language)
    const modified = monaco.editor.createModel(content.modified, language)
    editor.setModel({ original, modified })
    const stopTheme = watchForgeThemeForMonaco((theme) => monaco.editor.setTheme(theme))
    return () => {
      stopTheme()
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [content, target])

  if (error) return <div className="forge-editor-empty"><p className="forge-field-hint" role="alert">{error}</p></div>
  if (!content) return <div className="forge-editor-empty"><p className="forge-field-hint">Please Wait…</p></div>
  if (content.binary) return <div className="forge-editor-empty"><p className="forge-field-hint">{target.path} is a binary file; there is no text diff.</p></div>
  if (content.too_large) return <div className="forge-editor-empty"><p className="forge-field-hint">{target.path} is larger than 2 MB; the diff is not shown.</p></div>
  const [from, to] = SIDE_LABEL[target.side]
  return (
    <div className="scm-diff">
      <div className="scm-diff-head">
        <span>{from}</span>
        <span className="scm-diff-path">{target.path}</span>
        <span>{to}</span>
      </div>
      <div ref={hostRef} className="forge-monaco-host" data-testid="diff-host" />
    </div>
  )
}
