import * as monaco from 'monaco-editor'
import type { ForgeApi } from '../api/ForgeApi'
import type { JditoTypes } from '../wire/types'

// JDito language support of the JavaScript code editors: completion, hover and error checks come
// from Monaco's own TypeScript worker, fed with the `@aditosoftware/jdito-types` package of the
// project (read from its node_modules, never written). Used instead of a language-server sidecar:
// it needs no Node runtime on the user's machine and nothing to bundle.

const PACKAGE = '@aditosoftware/jdito-types'
const PREFIX = `file:///node_modules/${PACKAGE}/`
const GLOBALS_PATH = 'file:///jdito-globals.d.ts'

// Diagnostics that would flag normal JDito code: unresolved project-internal imports, names that
// come from the platform's runtime, redeclarations across the script files of one project, unused
// code and the ES-module suggestion. Errors about wrong members and wrong arguments stay on.
const IGNORED_CODES = [2304, 2307, 2792, 2300, 2451, 2393, 2528, 6133, 6196, 7005, 7006, 7016, 7034, 7053, 80001, 80002, 80004, 80005, 80006]

interface TsDefaults {
  setExtraLibs(libs: { content: string; filePath?: string }[]): void
  setDiagnosticsOptions(options: Record<string, unknown>): void
  setCompilerOptions(options: Record<string, unknown>): void
}

function tsDefaults(): TsDefaults | undefined {
  try {
    const ts = (monaco as unknown as { typescript?: { javascriptDefaults?: TsDefaults } }).typescript
    return ts?.javascriptDefaults
  } catch {
    // A reduced Monaco (tests) has no TypeScript support.
    return undefined
  }
}

/** Text model with a file address for a JavaScript file; null when this Monaco cannot create one. */
export function createJavaScriptModel(initial: string, path: string): monaco.editor.ITextModel | null {
  try {
    const uri = monaco.Uri.parse(modelUriFor(path))
    monaco.editor.getModel(uri)?.dispose()
    return monaco.editor.createModel(initial, 'javascript', uri)
  } catch {
    return null
  }
}

/** Lower-case constants the package exports (`vars`, `result`, `neon` ...): the JDito globals. */
export function globalNames(files: { path: string; content: string }[]): string[] {
  const names = new Set<string>()
  const re = /^export\s+(?:declare\s+)?const\s+([a-z][A-Za-z0-9_]*)\s*:/gm
  for (const f of files) {
    if (!f.path.startsWith('dist/')) continue
    for (const m of f.content.matchAll(re)) names.add(m[1])
  }
  return [...names].sort()
}

/** Files for Monaco's extra libraries: the package under node_modules plus the ambient globals. */
export function buildLibs(types: JditoTypes): { content: string; filePath: string }[] {
  // The package's dist/*.ts files are real sources (export const vars: vars = null;), so they keep their paths.
  const libs = types.files.map((f) => ({ content: f.content, filePath: PREFIX + f.path }))
  libs.push({ content: JSON.stringify({ name: PACKAGE, version: types.version, types: 'index.d.ts' }), filePath: PREFIX + 'package.json' })
  const globals = globalNames(types.files)
    .map((n) => `declare const ${n}: typeof import("${PACKAGE}").${n};`)
    .join('\n')
  libs.push({ content: globals, filePath: GLOBALS_PATH })
  return libs
}

/** Model address that lets the worker resolve `import ... from "@aditosoftware/jdito-types"`. */
export function modelUriFor(path: string): string {
  const slug = path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').replace(/[^A-Za-z0-9_./-]/g, '_').replace(/^\/+/, '')
  return `file:///project/${slug}`
}

let loadedFor: string | null = null
let pending: Promise<boolean> | null = null

/**
 * Loads the project's JDito types into the TypeScript worker once per project. Resolves to true
 * when types were found. Without them the editors keep their syntax checks only.
 */
export function applyJditoTypes(api: ForgeApi, projectRoot: string): Promise<boolean> {
  if (loadedFor === projectRoot) return Promise.resolve(true)
  if (pending) return pending
  pending = (async () => {
    try {
      const defaults = tsDefaults()
      if (!defaults || !projectRoot.trim()) return false
      const types = await api.readJditoTypes(projectRoot)
      if (!types || types.files.length === 0) return false
      defaults.setCompilerOptions({
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        target: 99,
        module: 99,
        moduleResolution: 2,
        noEmit: true,
      })
      defaults.setExtraLibs(buildLibs(types))
      defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, noSuggestionDiagnostics: true, diagnosticCodesToIgnore: IGNORED_CODES })
      loadedFor = projectRoot
      return true
    } catch {
      return false
    } finally {
      pending = null
    }
  })()
  return pending
}

/** Test hook: forget what was loaded. */
export function resetJditoTypes(): void {
  loadedFor = null
  pending = null
}
