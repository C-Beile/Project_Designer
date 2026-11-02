import * as monaco from 'monaco-editor'

// Web workers for Monaco. The editor worker is needed for any editor; the TypeScript worker
// delivers the syntax errors of JDito code (red squiggles in the code editors). Semantic checks
// stay off: JDito globals (`result`, `vars`, `import(...)`) are unknown to the language service
// and would flag every line.
//
// Loaded on first use of a code editor only, and only where Web Workers exist (not in unit tests).

let ready: Promise<void> | null = null

export type MonacoWorkerKind = 'editor' | 'json' | 'css' | 'html' | 'typescript'

// Every language with its own language service needs its own worker: the generic editor worker has
// no handlers for folding ranges, colours, symbols or schemas of these languages and rejects each
// request with "Missing requestHandler or method". Languages without a service (xml, yaml, sql,
// markdown, plaintext) use the generic editor worker.
export function workerKindForLabel(label: string): MonacoWorkerKind {
  switch (label) {
    case 'json':
      return 'json'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'html':
    case 'handlebars':
    case 'razor':
      return 'html'
    case 'typescript':
    case 'javascript':
      return 'typescript'
    default:
      return 'editor'
  }
}

interface TsDefaults {
  setDiagnosticsOptions(options: { noSemanticValidation?: boolean; noSyntaxValidation?: boolean; noSuggestionDiagnostics?: boolean }): void
  setCompilerOptions(options: Record<string, unknown>): void
}

export function ensureMonacoWorkers(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    if (typeof Worker === 'undefined') return
    const [editorWorker, tsWorker, jsonWorker, cssWorker, htmlWorker] = await Promise.all([
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/language/typescript/ts.worker?worker'),
      import('monaco-editor/language/json/json.worker?worker'),
      import('monaco-editor/language/css/css.worker?worker'),
      import('monaco-editor/language/html/html.worker?worker'),
    ])
    ;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_id: string, label: string) {
        switch (workerKindForLabel(label)) {
          case 'json':
            return new jsonWorker.default()
          case 'css':
            return new cssWorker.default()
          case 'html':
            return new htmlWorker.default()
          case 'typescript':
            return new tsWorker.default()
          default:
            return new editorWorker.default()
        }
      },
    }
    const ts = (monaco as unknown as { typescript?: { javascriptDefaults?: TsDefaults } }).typescript
    ts?.javascriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true })
    ts?.javascriptDefaults?.setCompilerOptions({ allowNonTsExtensions: true, target: 99, checkJs: false })
  })().catch(() => {
    // Without workers the editors still work, just without syntax squiggles.
  })
  return ready
}
