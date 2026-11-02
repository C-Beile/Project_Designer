import type * as monaco from 'monaco-editor'
import { getOptions, subscribeOptions } from '../settings/options'

// View menu switches that reach every code editor (line numbers, whitespace, guides, hints).
// Kept per user in localStorage; storage problems only mean the defaults apply.

export interface EditorPrefs {
  lineNumbers: boolean
  nonPrintable: boolean
  indentGuides: boolean
  inlineHints: boolean
}

export const EDITOR_PREFS_KEY = 'forge.editorPrefs.v1'

export const DEFAULT_EDITOR_PREFS: EditorPrefs = { lineNumbers: true, nonPrintable: false, indentGuides: true, inlineHints: true }

export function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = window.localStorage.getItem(EDITOR_PREFS_KEY)
    const parsed: Partial<EditorPrefs> = raw ? JSON.parse(raw) : {}
    const out = { ...DEFAULT_EDITOR_PREFS }
    for (const k of Object.keys(out) as (keyof EditorPrefs)[]) if (typeof parsed[k] === 'boolean') out[k] = parsed[k]!
    return out
  } catch {
    return { ...DEFAULT_EDITOR_PREFS }
  }
}

let current = loadEditorPrefs()
const listeners = new Set<() => void>()

export function getEditorPrefs(): EditorPrefs {
  return current
}

export function setEditorPref(key: keyof EditorPrefs, value: boolean): void {
  current = { ...current, [key]: value }
  try {
    window.localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(current))
  } catch {
    // the switch still works for this session
  }
  listeners.forEach((l) => l())
}

/** Reads the switches from storage again, after another window (the Options window) saved them. */
export function reloadEditorPrefs(): void {
  current = loadEditorPrefs()
  listeners.forEach((l) => l())
}

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
  })
}
