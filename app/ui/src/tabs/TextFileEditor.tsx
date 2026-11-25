import { useEffect, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { MonacoText, type MonacoTextHandle } from './MonacoText'
import { MarkdownPreview } from './MarkdownPreview'
import { CsvPreview } from './CsvPreview'
import { GITATTRIBUTES_LANGUAGE, IGNORE_LANGUAGE } from '../theme/monacoLanguages'
import { applyJditoTypes } from '../theme/monacoJdito'
import { registerFormatter } from '../theme/formatOnSave'
import { enableImportNavigation } from '../theme/monacoImports'
import { useScm } from '../core/scm'
import type { Gutter } from '../wire/types'
import { Button } from '../core/ui/controls'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

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

/** The name the file type is read from: the label, or the path when the label has no ending (an implementation shown by its name, `bhb_impl`, whose file is `process.js`). */
export function typeNameOf(label: string, path: string): string {
  return /\.[A-Za-z0-9]+$/.test(label) || label.startsWith('.') ? label : path
}

export function previewKindForFile(label: string): 'markdown' | 'csv' | null {
  const name = label.replace(/^.*[\\/]/, '').toLowerCase()
  if (/\.(csv|tsv)$/.test(name)) return 'csv'
  return languageForFile(label) === 'markdown' ? 'markdown' : null
}

export type MarkdownView = 'source' | 'split' | 'preview'
export const MARKDOWN_VIEWS: [MarkdownView, string][] = [
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
  useAbortableEffect((signal) => {
    if (isNew || !projectRoot.trim()) return
    api
      .scmGutter(projectRoot, path)
      .then((g) => !signal.aborted && setGutter(g))
      .catch(() => !signal.aborted && setGutter(null))
  }, [api, projectRoot, path, isNew, scm.version])

  useAbortableEffect((signal) => {
    setLoaded(null)
    setError(null)
    if (isNew) {
      setLoaded({ initial: drafts.get(path) ?? '' })
      setMdText(drafts.get(path) ?? '')
      return
    }
    // A linked-file reference may be an absolute path, which is what the tree gives for files.
    api
      .readLinkedFile(projectRoot, path)
      .then((text) => {
        if (signal.aborted) return
        setLoaded({ initial: drafts.get(path) ?? text })
        setMdText(drafts.get(path) ?? text)
      })
      .catch((e) => {
        if (!signal.aborted) setError(String(e instanceof Error ? e.message : e))
      })
  }, [api, path, projectRoot, drafts, isNew])

  const typeName = typeNameOf(label, path)
  const language = languageForFile(typeName)
  const previewKind = previewKindForFile(typeName)
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
      {previewKind ? (
        <div className="forge-md-switch" role="tablist" aria-label={previewKind === 'csv' ? 'CSV view' : 'Markdown view'}>
          {MARKDOWN_VIEWS.map(([id, text]) => (
            <Button variant="bare" key={id} role="tab" aria-selected={mdView === id} className={`forge-md-tab${mdView === id ? ' is-active' : ''}`} onClick={() => setMdView(id)}>
              {text}
            </Button>
          ))}
        </div>
      ) : null}
      <div className={`forge-md-body${previewKind ? ` is-${mdView}` : ''}`}>
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
              if (previewKind) setMdText(text)
              onDirty(path, true)
            }}
          />
        </div>
        {previewKind === 'markdown' && mdView !== 'source' ? <MarkdownPreview text={mdText} /> : null}
        {previewKind === 'csv' && mdView !== 'source' ? <CsvPreview text={mdText} /> : null}
      </div>
    </div>
  )
}
