import { configGet, configSet, onConfigChange, touches } from './appConfig'
// User options of Tools > Options (manual 4.8.3). Stored per user in designer.conf ([options]); a missing or
// damaged value falls back to the defaults. API keys and other secrets are deliberately never
// part of this store.

export interface DesignerOptions {
  general: {
    /** Scan Services run again after saving ("Refresh on file change"). */
    refreshScanOnChange: boolean
    /** Deploy dialog starts with "Check Scan Services" ticked. */
    checkScanOnDeploy: boolean
    confirmDestructive: boolean
    showHints: boolean
    restoreProjects: boolean
  }
  nodejs: { path: string }
  eslint: { analyzeOnSave: boolean }
  translators: { provider: 'none' | 'deepl' | 'google' | 'yandex' }
  debugger: { enabled: boolean; showElapsed: boolean }
  cloud: { bufferSize: number }
  encoding: { defaultEncoding: string }
  editor: {
    fontSize: number
    tabSize: number
    wordWrap: boolean
    minimap: boolean
    formatOnSave: boolean
    /** Empty: the default code font. */
    fontFamily: string
    /** 0: automatic. */
    lineHeight: number
    fontLigatures: boolean
    cursorBlinking: string
    cursorStyle: string
    smoothCaret: boolean
    /** Header of the current function or class stays visible at the top while scrolling. */
    stickyScroll: boolean
    smoothScrolling: boolean
    bracketColors: boolean
    autoCloseBrackets: boolean
    folding: boolean
    scrollBeyondLastLine: boolean
    insertSpaces: boolean
    lineHighlight: string
    /** Id of an imported colour theme; empty: the editor follows the application theme. */
    colorTheme: string
  }
  misc: { csvSeparator: ';' | ',' | '\t'; outputMaxLines: number; janitorOnStartup: boolean; janitorDays: number }
}

export const DEFAULT_OPTIONS: DesignerOptions = {
  general: { refreshScanOnChange: true, checkScanOnDeploy: false, confirmDestructive: true, showHints: true, restoreProjects: true },
  nodejs: { path: '' },
  eslint: { analyzeOnSave: false },
  translators: { provider: 'none' },
  debugger: { enabled: false, showElapsed: true },
  cloud: { bufferSize: 128 },
  encoding: { defaultEncoding: 'UTF-8' },
  editor: {
    fontSize: 13,
    tabSize: 2,
    wordWrap: false,
    minimap: false,
    formatOnSave: false,
    fontFamily: '',
    lineHeight: 0,
    fontLigatures: false,
    cursorBlinking: 'smooth',
    cursorStyle: 'line',
    smoothCaret: false,
    stickyScroll: true,
    smoothScrolling: true,
    bracketColors: true,
    autoCloseBrackets: true,
    folding: true,
    scrollBeyondLastLine: false,
    insertSpaces: true,
    lineHighlight: 'line',
    colorTheme: '',
  },
  misc: { csvSeparator: ';', outputMaxLines: 5000, janitorOnStartup: true, janitorDays: 30 },
}

const OPTIONS_PATH = ['options'] as const

type Plain = Record<string, unknown>

// Takes over only values whose type matches the default; unknown keys are dropped.
function merge<T>(base: T, incoming: unknown): T {
  if (typeof base !== 'object' || base === null || typeof incoming !== 'object' || incoming === null) return base
  const out: Plain = { ...(base as Plain) }
  for (const key of Object.keys(out)) {
    const def = out[key]
    const val = (incoming as Plain)[key]
    if (val === undefined) continue
    if (typeof def === 'object' && def !== null) out[key] = merge(def, val)
    else if (typeof val === typeof def) out[key] = val
  }
  return out as T
}

export function loadOptions(): DesignerOptions {
  return merge(DEFAULT_OPTIONS, configGet<object>(...OPTIONS_PATH) ?? {})
}

let current = loadOptions()
const listeners = new Set<() => void>()

export function getOptions(): DesignerOptions {
  return current
}

export function saveOptions(next: DesignerOptions): void {
  current = merge(DEFAULT_OPTIONS, next)
  configSet(OPTIONS_PATH, current)
  listeners.forEach((l) => l())
}

/** Reads the options from storage again, after another window (the Options window) saved them. */
export function reloadOptions(): void {
  current = loadOptions()
  listeners.forEach((l) => l())
}

export function subscribeOptions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetOptionsForTests(): void {
  current = DEFAULT_OPTIONS
  configSet(OPTIONS_PATH, undefined)
}

// Beim Laden der Konfiguration und bei Änderungen aus einem anderen Fenster (Options-Fenster) neu lesen.
onConfigChange((path) => {
  if (touches(path, OPTIONS_PATH)) reloadOptions()
})
