// Menu commands that act on the code editor the user is working in (Edit, Source, Navigate and
// View > Code Folds). They run Monaco's own actions on the focused editor, falling back to the
// editor that was focused last, so a click in the menu does not lose the target.
//
// The editors register themselves here; this module deliberately does not import Monaco, so the
// shell can use it without loading the editor bundle.

interface EditorLike {
  hasTextFocus(): boolean
  focus(): void
  getAction(id: string): { run(): unknown } | null
  trigger(source: string, handlerId: string, payload: unknown): void
  onDidFocusEditorText?(listener: () => void): unknown
  onDidDispose?(listener: () => void): unknown
  onDidChangeCursorPosition?(listener: () => void): unknown
  onKeyDown?(listener: (e: { browserEvent: KeyboardEvent }) => void): unknown
  getPosition?(): { lineNumber: number; column: number } | null
  getSelection?(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null
  setSelection?(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void
  getModel?(): { getEOL?(): string; getLineMaxColumn(line: number): number } | null
  updateOptions?(options: { cursorStyle: 'line' | 'block' }): void
}

/** What the status bar shows about the code editor the user works in. */
export interface EditorStatus {
  hasEditor: boolean
  line: number
  column: number
  /** `CRLF`, `LF` or null while no editor is open. */
  eol: 'CRLF' | 'LF' | null
  overtype: boolean
}

const NO_EDITOR: EditorStatus = { hasEditor: false, line: 0, column: 0, eol: null, overtype: false }
let status: EditorStatus = NO_EDITOR
let overtype = false
const statusListeners = new Set<() => void>()

export function subscribeEditorStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function getEditorStatus(): EditorStatus {
  return status
}

function publishStatus(): void {
  const ed = target()
  const pos = ed?.getPosition?.() ?? null
  const eol = ed?.getModel?.()?.getEOL?.()
  const next: EditorStatus = ed
    ? { hasEditor: true, line: pos?.lineNumber ?? 1, column: pos?.column ?? 1, eol: eol === '\r\n' ? 'CRLF' : eol ? 'LF' : null, overtype }
    : NO_EDITOR
  if (next.hasEditor === status.hasEditor && next.line === status.line && next.column === status.column && next.eol === status.eol && next.overtype === status.overtype) return
  status = next
  statusListeners.forEach((l) => l())
}

/** INS/OVR of the status bar: in overtype mode a typed character replaces the one after the caret. */
export function toggleOvertype(): void {
  overtype = !overtype
  for (const e of editors) e.updateOptions?.({ cursorStyle: overtype ? 'block' : 'line' })
  publishStatus()
  target()?.focus()
}

/** Opens Monaco's own "Go to Line" prompt in the editor the user works in. */
export function goToLine(): boolean {
  return runEditorAction('editor.action.gotoLine')
}

const editors = new Set<EditorLike>()
let lastFocused: EditorLike | null = null

export function trackEditorFocus(editor: EditorLike): void {
  editors.add(editor)
  editor.onDidFocusEditorText?.(() => {
    lastFocused = editor
  })
  editor.onDidChangeCursorPosition?.(publishStatus)
  editor.onDidFocusEditorText?.(publishStatus)
  editor.onKeyDown?.((e) => {
    const k = e.browserEvent
    if (k.key === 'Insert' && !k.ctrlKey && !k.altKey && !k.shiftKey && !k.metaKey) {
      k.preventDefault()
      toggleOvertype()
      return
    }
    if (!overtype || k.key.length !== 1 || k.ctrlKey || k.altKey || k.metaKey) return
    const sel = editor.getSelection?.()
    const model = editor.getModel?.()
    if (!sel || !model || sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn) return
    if (sel.endColumn >= model.getLineMaxColumn(sel.endLineNumber)) return
    editor.setSelection?.({ ...sel, endColumn: sel.endColumn + 1 })
  })
  editor.onDidDispose?.(() => {
    editors.delete(editor)
    if (lastFocused === editor) lastFocused = null
    publishStatus()
  })
  publishStatus()
}

function target(): EditorLike | null {
  const all = [...editors]
  return all.find((e) => e.hasTextFocus?.()) ?? (lastFocused && editors.has(lastFocused) ? lastFocused : (all[all.length - 1] ?? null))
}

export function hasCodeEditor(): boolean {
  return target() !== null
}

/** Runs an editor action (e.g. `editor.action.commentLine`) or, failing that, an editor command. */
export function runEditorAction(id: string): boolean {
  const ed = target()
  if (!ed) return false
  ed.focus()
  const action = ed.getAction(id)
  if (action) {
    void action.run()
    return true
  }
  ed.trigger('forge-menu', id, null)
  return true
}
