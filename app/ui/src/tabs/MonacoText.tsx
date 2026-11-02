import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as monaco from 'monaco-editor'
import { addInsertUuidAction } from '../theme/monacoUuid'
import { trackEditorFocus } from '../theme/monacoActions'
import { applyEditorPrefs, subscribeEditorPrefs } from '../theme/editorPrefs'
import { createJavaScriptModel } from '../theme/monacoJdito'
import type { Gutter } from '../wire/types'
import { currentForgeTheme, ensureMonacoThemesDefined, monacoThemeFor, watchForgeThemeForMonaco } from '../theme/monacoTheme'

// Monaco text area shared by the Source sub-tab and the plain-file editor. The editor is created
// once with its initial text; later changes of the text come only through the handle, so a
// re-render never resets the cursor or the editor's own undo stack.

export interface MonacoTextHandle {
  getValue(): string
  setValue(text: string): void
  /** Selected text and the offset of its start; empty selection when nothing is marked. */
  getSelection(): { text: string; offset: number }
  getCursorOffset(): number
  /** Runs a built-in editor action (find, comment, indent ...); false if the editor lacks it. */
  runAction(id: string): boolean
  focus(): void
}

export interface EditorMarker {
  line: number
  column?: number
  message: string
  severity: 'Error' | 'Warning' | 'Info'
}

export function MonacoText({
  initial,
  language,
  readOnly,
  label,
  onChange,
  handleRef,
  markers,
  reveal,
  modelPath,
  gutter,
}: {
  initial: string
  language: string
  readOnly: boolean
  label: string
  onChange: (text: string) => void
  handleRef: MutableRefObject<MonacoTextHandle | null>
  /** Red/yellow squiggles at these positions (problems of the file). */
  markers?: EditorMarker[]
  /** Scrolls to a line when `token` changes (double click in the Problems tab). */
  reveal?: { line: number; column?: number; token: number }
  /** JavaScript only: gives the model a file address so imports of the JDito types resolve. */
  modelPath?: string
  /** Changed lines against HEAD: green, yellow and red marks next to the line numbers. */
  gutter?: Gutter | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) return
    ensureMonacoThemesDefined()
    const ownedModel = modelPath && language === 'javascript' ? createJavaScriptModel(initial, modelPath) : null
    const editor = monaco.editor.create(containerRef.current, {
      ...(ownedModel ? { model: ownedModel } : { value: initial, language }),
      readOnly,
      automaticLayout: true,
      theme: monacoThemeFor(currentForgeTheme()),
      ariaLabel: label,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
    })
    editorRef.current = editor
    trackEditorFocus(editor)
    addInsertUuidAction(editor)
    applyEditorPrefs(editor)
    const unsubscribePrefs = subscribeEditorPrefs(() => applyEditorPrefs(editor))
    // Remote value changes (undo from the shell) must not echo back as user edits.
    let silent = false
    editor.onDidChangeModelContent(() => {
      if (!silent) onChangeRef.current(editor.getModel()?.getValue() ?? '')
    })
    handleRef.current = {
      getValue: () => editor.getModel()?.getValue() ?? '',
      setValue: (text) => {
        silent = true
        try {
          editor.getModel()?.setValue(text)
        } finally {
          silent = false
        }
      },
      getSelection: () => {
        const sel = editor.getSelection?.()
        const model = editor.getModel()
        if (!sel || !model || sel.isEmpty?.()) return { text: '', offset: 0 }
        return { text: model.getValueInRange(sel), offset: model.getOffsetAt(sel.getStartPosition()) }
      },
      getCursorOffset: () => {
        const pos = editor.getPosition?.()
        const model = editor.getModel()
        return pos && model ? model.getOffsetAt(pos) : 0
      },
      runAction: (id) => {
        const action = editor.getAction?.(id)
        if (!action) return false
        void action.run()
        return true
      },
      focus: () => editor.focus?.(),
    }
    return () => {
      editorRef.current = null
      unsubscribePrefs()
      handleRef.current = null
      editor.dispose()
      ownedModel?.dispose()
    }
    // The editor is created once per mount; text arrives through the handle afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const model = editorRef.current?.getModel() as monaco.editor.ITextModel | null | undefined
    if (!model || typeof monaco.editor.setModelMarkers !== 'function') return
    monaco.editor.setModelMarkers(
      model,
      'forge-problems',
      (markers ?? []).map((m) => {
        const line = Math.max(1, Math.min(m.line, model.getLineCount()))
        const col = m.column ?? 1
        return {
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: Math.max(col + 1, model.getLineMaxColumn(line)),
          message: m.message,
          severity: m.severity === 'Error' ? monaco.MarkerSeverity.Error : m.severity === 'Warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        }
      }),
    )
  }, [markers])

  useEffect(() => {
    if (!reveal) return
    const ed = editorRef.current
    if (!ed || typeof ed.revealLineInCenter !== 'function') return
    ed.revealLineInCenter(reveal.line)
    ed.setPosition({ lineNumber: reveal.line, column: reveal.column ?? 1 })
    ed.focus()
  }, [reveal?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model || !gutter || typeof ed.createDecorationsCollection !== 'function' || typeof monaco.Range !== 'function') return
    const lines = model.getLineCount()
    const decorations: monaco.editor.IModelDeltaDecoration[] = gutter.untracked
      ? [{ range: new monaco.Range(1, 1, lines, 1), options: { isWholeLine: true, linesDecorationsClassName: 'forge-git-gutter-added' } }]
      : gutter.hunks.map((h) => ({
          range: new monaco.Range(Math.min(h.start, lines), 1, Math.min(h.start + h.count - 1, lines), 1),
          options: { isWholeLine: true, linesDecorationsClassName: `forge-git-gutter-${h.kind}` },
        }))
    const collection = ed.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [gutter])

  useEffect(() => watchForgeThemeForMonaco((theme) => monaco.editor.setTheme(theme)), [])

  return <div ref={containerRef} className="forge-monaco-host" data-testid="monaco-host" />
}
