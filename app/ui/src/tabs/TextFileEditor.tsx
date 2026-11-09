import { useEffect, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { MonacoText, type MonacoTextHandle } from './MonacoText'
import { MarkdownPreview } from './MarkdownPreview'
import { GITATTRIBUTES_LANGUAGE, IGNORE_LANGUAGE } from '../theme/monacoLanguages'
import { applyJditoTypes } from '../theme/monacoJdito'
import { registerFormatter } from '../theme/formatOnSave'
import { enableImportNavigation } from '../theme/monacoImports'
import { useScm } from '../core/scm'
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

// Dot files are recognised by their whole name: they have no extension Monaco could use.
const FILE_NAMES: Record<string, string> = {
  '.gitignore': IGNORE_LANGUAGE,
  '.npmignore': IGNORE_LANGUAGE,
  '.dockerignore': IGNORE_LANGUAGE,
  '.eslintignore': IGNORE_LANGUAGE,
  '.prettierignore': IGNORE_LANGUAGE,
  '.transpilerignore': IGNORE_LANGUAGE,
  '.gitattributes': GITATTRIBUTES_LANGUAGE,
  '.gitmodules': 'ini',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
}

export function languageForFile(label: string): string {
  const name = label.replace(/^.*[\\/]/, '').toLowerCase()
  if (FILE_NAMES[name]) return FILE_NAMES[name]
  const dot = name.lastIndexOf('.')
  return (dot > 0 && LANGUAGES[name.slice(dot + 1)]) || 'plaintext'
}

type MarkdownView = 'source' | 'split' | 'preview'
const MARKDOWN_VIEWS: [MarkdownView, string][] = [
  ['source', 'Source'],
  ['split', 'Split'],
  ['preview', 'Preview'],
]

export function TextFileEditor({
  api,
  path,
  label,
  projectRoot,
  readOnly,
  drafts,
  onDirty,
  isNew,
  reveal,
  onOpenFileAt,
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
  /** Scrolls to a line when `token` changes (Ctrl+click arriving at an export). */
  reveal?: { line: number; column?: number; token: number } | null
  /** Ctrl+click on an import: open the file with the export at this line. */
  onOpenFileAt?: (path: string, line: number) => void
}) {
  const [loaded, setLoaded] = useState<{ initial: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<MonacoTextHandle | null>(null)
  const rootRef = useRef(projectRoot)
  rootRef.current = projectRoot
  const openAtRef = useRef(onOpenFileAt)
  openAtRef.current = onOpenFileAt
  useEffect(() => {
    if (languageForFile(path) === 'javascript') enableImportNavigation(api, () => rootRef.current, (p, l) => openAtRef.current?.(p, l))
  }, [api, path])
  useEffect(() => registerFormatter(path, async () => void (await handle.current?.format())), [path])
  const scm = useScm()
  const [gutter, setGutter] = useState<Gutter | null>(null)
  const [mdView, setMdView] = useState<MarkdownView>('split')
  const [mdText, setMdText] = useState('')

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
      setMdText(drafts.get(path) ?? '')
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
        setMdText(drafts.get(path) ?? text)
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
      {language === 'markdown' ? (
        <div className="forge-md-switch" role="tablist" aria-label="Markdown view">
          {MARKDOWN_VIEWS.map(([id, text]) => (
            <button key={id} type="button" role="tab" aria-selected={mdView === id} className={`forge-md-tab${mdView === id ? ' is-active' : ''}`} onClick={() => setMdView(id)}>
              {text}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`forge-md-body${language === 'markdown' ? ` is-${mdView}` : ''}`}>
        <div className="forge-md-source">
          <MonacoText
            initial={loaded.initial}
            language={language}
            modelPath={language === 'javascript' ? path : undefined}
            gutter={gutter}
            readOnly={readOnly}
            label={label}
            handleRef={handle}
            reveal={reveal ?? undefined}
            onChange={(text) => {
              drafts.set(path, text)
              if (language === 'markdown') setMdText(text)
              onDirty(path, true)
            }}
          />
        </div>
        {language === 'markdown' && mdView !== 'source' ? <MarkdownPreview text={mdText} /> : null}
      </div>
    </div>
  )
}
