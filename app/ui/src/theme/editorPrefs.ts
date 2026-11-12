import { configGet, configSet, onConfigChange, touches } from '../settings/appConfig'
import type * as monaco from 'monaco-editor'
import { getOptions, subscribeOptions } from '../settings/options'

// View menu switches that reach every code editor (line numbers, whitespace, guides, hints).
// Kept per user in designer.conf ([editor]); a missing value means the defaults apply.

export interface EditorPrefs {
  lineNumbers: boolean
  nonPrintable: boolean
  indentGuides: boolean
  inlineHints: boolean
}

const EDITOR_PATH = ['editor'] as const

export const DEFAULT_EDITOR_PREFS: EditorPrefs = { lineNumbers: true, nonPrintable: false, indentGuides: true, inlineHints: true }

export function loadEditorPrefs(): EditorPrefs {
  const parsed = configGet<Partial<EditorPrefs>>(...EDITOR_PATH) ?? {}
  const out = { ...DEFAULT_EDITOR_PREFS }
  for (const k of Object.keys(out) as (keyof EditorPrefs)[]) if (typeof parsed[k] === 'boolean') out[k] = parsed[k]!
  return out
}

let current = loadEditorPrefs()
const listeners = new Set<() => void>()

export function getEditorPrefs(): EditorPrefs {
  return current
}

export function setEditorPref(key: keyof EditorPrefs, value: boolean): void {
  current = { ...current, [key]: value }
  configSet(EDITOR_PATH, current)
  listeners.forEach((l) => l())
}

/** Reads the switches from storage again, after another window (the Options window) saved them. */
export function reloadEditorPrefs(): void {
  current = loadEditorPrefs()
  listeners.forEach((l) => l())
}

// Beim Laden der Konfiguration und bei Änderungen aus einem anderen Fenster neu lesen.
onConfigChange((path) => {
  if (touches(path, EDITOR_PATH)) reloadEditorPrefs()
})

export function subscribeEditorPrefs(listener: () => void): () => void {
  listeners.add(listener)
  const offOptions = subscribeOptions(listener)
  return () => {
    listeners.delete(listener)
    offOptions()
  }
}

export function applyEditorPrefs(editor: monaco.editor.IStandaloneCodeEditor): void {
  const p = current
  const o = getOptions().editor
  editor.updateOptions?.({
    fontSize: o.fontSize,
    tabSize: o.tabSize,
    wordWrap: o.wordWrap ? 'on' : 'off',
    minimap: { enabled: o.minimap },
    lineNumbers: p.lineNumbers ? 'on' : 'off',
    renderWhitespace: p.nonPrintable ? 'all' : 'selection',
    renderControlCharacters: p.nonPrintable,
    guides: { indentation: p.indentGuides },
    inlayHints: { enabled: p.inlineHints ? 'on' : 'off' },
    fontFamily: o.fontFamily.trim() || "Consolas, 'Courier New', monospace",
    lineHeight: o.lineHeight,
    fontLigatures: o.fontLigatures,
    cursorBlinking: o.cursorBlinking as monaco.editor.IEditorOptions['cursorBlinking'],
    cursorStyle: o.cursorStyle as monaco.editor.IEditorOptions['cursorStyle'],
    cursorSmoothCaretAnimation: o.smoothCaret ? 'on' : 'off',
    stickyScroll: { enabled: o.stickyScroll },
    smoothScrolling: o.smoothScrolling,
    bracketPairColorization: { enabled: o.bracketColors },
    autoClosingBrackets: o.autoCloseBrackets ? 'languageDefined' : 'never',
    folding: o.folding,
    scrollBeyondLastLine: o.scrollBeyondLastLine,
    insertSpaces: o.insertSpaces,
    renderLineHighlight: o.lineHighlight as monaco.editor.IEditorOptions['renderLineHighlight'],
  })
}
