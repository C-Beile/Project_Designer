import * as monaco from 'monaco-editor'
import type { ForgeApi } from '../api/ForgeApi'

// Ctrl+click on an import of a JDito script opens the file where the name is exported: a click on
// the module name opens the process file, a click on an imported name (in the import or anywhere
// below) opens it at its `export` line. Monaco draws the underline and calls the opener below.

const SCHEME = 'dito-open'

export interface ImportRef {
  /** Module name between the quotes. */
  spec: string
  /** Local name -> name exported by the module (`a as b`, default and namespace imports map to ''). */
  names: Map<string, string>
  /** Offsets of the module name inside the text. */
  specStart: number
  specEnd: number
  /** Offsets of the whole statement. */
  start: number
  end: number
}

/** Every `import ... from "x"` of a script (several lines allowed). */
export function parseImports(text: string): ImportRef[] {
  const out: ImportRef[] = []
  const re = /import\s+([^;"']*?)\s*from\s*(["'])([^"']+)\2/g
  for (const m of text.matchAll(re)) {
    const clause = m[1]
    const names = new Map<string, string>()
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const [exported, local] = part.trim().split(/\s+as\s+/)
        if (exported) names.set((local ?? exported).trim(), exported.trim())
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, '')
    const star = /\*\s+as\s+([\w$]+)/.exec(rest)
    if (star) names.set(star[1], '')
    else {
      const def = /^\s*([\w$]+)\s*,?\s*$/.exec(rest)
      if (def) names.set(def[1], '')
    }
    const start = m.index ?? 0
    const specStart = start + m[0].lastIndexOf(m[3])
    out.push({ spec: m[3], names, specStart, specEnd: specStart + m[3].length, start, end: start + m[0].length })
  }
  return out
}

/** 1-based line of `export ... name` in a script, or 1 when the name is not found. */
export function exportLine(text: string, name: string): number {
  if (!name) return 1
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const direct = new RegExp(`^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+${safe}\\b`, 'm')
  const listed = new RegExp(`^\\s*export\\s*\\{[^}]*\\b${safe}\\b`, 'm')
  const found = direct.exec(text) ?? listed.exec(text)
  if (!found) return 1
  return text.slice(0, found.index + found[0].search(/\S/)).split('\n').length
}

const modelPaths = new Map<string, string>()

/** Remembers which file a Monaco model shows, so relative imports resolve from the right folder. */
export function rememberModelPath(modelUri: string, path: string): void {
  modelPaths.set(modelUri, path)
}

let registered = false
let current: { api: ForgeApi; projectRoot: () => string; open: (path: string, line: number) => void } | null = null

/** Provides the definitions and the opener once; later calls only swap who gets the clicks. */
export function enableImportNavigation(api: ForgeApi, projectRoot: () => string, open: (path: string, line: number) => void): void {
  current = { api, projectRoot, open }
  if (registered) return
  registered = true
  try {
    monaco.languages.registerDefinitionProvider('javascript', {
      async provideDefinition(model, position) {
        const ctx = current
        if (!ctx) return null
        const text = model.getValue()
        const offset = model.getOffsetAt(position)
        const imports = parseImports(text)
        const inSpec = imports.find((i) => offset >= i.specStart && offset <= i.specEnd)
        const word = model.getWordAtPosition(position)
        const byName = word ? imports.find((i) => i.names.has(word.word) && !(offset >= i.specStart && offset <= i.specEnd)) : undefined
        const target = inSpec ?? byName
        if (!target) return null
        const from = modelPaths.get(model.uri.toString()) ?? ''
        const path = await ctx.api.resolveImport(ctx.projectRoot(), target.spec, from).catch(() => null)
        if (!path) return null
        let line = 1
        if (!inSpec && word) {
          const content = await ctx.api.readLinkedFile(ctx.projectRoot(), path).catch(() => '')
          line = exportLine(content, target.names.get(word.word) ?? '')
        }
        const uri = monaco.Uri.from({ scheme: SCHEME, path: `/${encodeURIComponent(path)}` })
        return [{ uri, range: new monaco.Range(line, 1, line, 1) }]
      },
    })
    monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, selectionOrPosition) {
        if (resource.scheme !== SCHEME || !current) return false
        const path = decodeURIComponent(resource.path.replace(/^\//, ''))
        const sel = selectionOrPosition as { startLineNumber?: number; lineNumber?: number } | undefined
        current.open(path, sel?.startLineNumber ?? sel?.lineNumber ?? 1)
        return true
      },
    })
  } catch {
    // A reduced Monaco (tests) has no language registry.
  }
}
