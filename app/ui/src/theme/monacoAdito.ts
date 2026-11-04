import * as monaco from 'monaco-editor'
import type { ForgeApi } from '../api/ForgeApi'
import { aliasTables, classMembers, entityNames, findAditoTokens, languageKeys, localVariables, stringContext, suggestionsFor, type ProjectKnowledge, type Suggestion } from './aditoIntel'
import { parseImports } from './monacoImports'

// ADITO completion of the JavaScript editors: names of fields, parameters, system variables,
// libraries, language keys, tables and columns inside the strings of the calls that take them.
// It runs next to Monaco's own TypeScript completion (jdito-types) and adds what only the project
// knows. Everything is read through the ForgeApi, nothing is written.

export interface AditoContext {
  api: ForgeApi
  projectRoot: string
  /** Object the script belongs to: its fields and parameters are offered. */
  ownerNodeId?: string
}

const contexts = new Map<string, AditoContext>()
const projectCache = new Map<string, Promise<Omit<ProjectKnowledge, 'fields' | 'params'>>>()
const ownerCache = new Map<string, Promise<{ fields: string[]; params: string[] }>>()
let installed: monaco.IDisposable | null = null
const sourceCache = new Map<string, Promise<string>>()
const modelPathOf = new Map<string, string>()

function librarySource(ctx: AditoContext, spec: string, from: string): Promise<{ path: string; text: string } | null> {
  const key = `${ctx.projectRoot}|${from}|${spec}`
  let hit = sourceCache.get(key)
  if (!hit) {
    hit = ctx.api
      .resolveImport(ctx.projectRoot, spec, from)
      .then((path) => (path ? ctx.api.readLinkedFile(ctx.projectRoot, path).then((text) => `${path}\u0000${text}`) : ''))
      .catch(() => '')
    sourceCache.set(key, hit)
  }
  return hit.then((v) => {
    if (!v) return null
    const cut = v.indexOf('\u0000')
    return { path: v.slice(0, cut), text: v.slice(cut + 1) }
  })
}

async function readRef(api: ForgeApi, root: string, relative: string): Promise<string> {
  try {
    return await api.readLinkedFile(root, `%aditoprj%/${relative}`)
  } catch {
    return ''
  }
}

function loadProject(ctx: AditoContext): Promise<Omit<ProjectKnowledge, 'fields' | 'params'>> {
  const hit = projectCache.get(ctx.projectRoot)
  if (hit) return hit
  const task = (async () => {
    const [models, files] = await Promise.all([ctx.api.listProjectModels(ctx.projectRoot).catch(() => []), ctx.api.listProjectFiles(ctx.projectRoot).catch(() => [] as string[])])
    const libraries = models.filter((m) => m.folder === 'process' && /_lib$/i.test(m.name)).map((m) => m.name)
    const languageFiles = files.filter((f) => /^language\/[^/]+\/[^/]+\.aod$/.test(f)).slice(0, 4)
    const aliasFiles = files.filter((f) => /^aliasDefinition\/[^/]+\/[^/]+\.aod$/.test(f)).slice(0, 40)
    const languageSources = await Promise.all(languageFiles.map((f) => readRef(ctx.api, ctx.projectRoot, f)))
    const aliasSources = await Promise.all(aliasFiles.map((f) => readRef(ctx.api, ctx.projectRoot, f)))
    return {
      libraries,
      languageKeys: [...new Set(languageSources.flatMap(languageKeys))],
      tables: aliasSources.flatMap(aliasTables),
    }
  })()
  projectCache.set(ctx.projectRoot, task)
  return task
}

function loadOwner(ctx: AditoContext): Promise<{ fields: string[]; params: string[] }> {
  if (!ctx.ownerNodeId) return Promise.resolve({ fields: [], params: [] })
  const hit = ownerCache.get(ctx.ownerNodeId)
  if (hit) return hit
  const task = ctx.api
    .getObjectSource(ctx.ownerNodeId)
    .then((s) => entityNames(s.text))
    .catch(() => ({ fields: [], params: [] }))
  ownerCache.set(ctx.ownerNodeId, task)
  return task
}

/** Forgets what was read, for example after the project changed on disk. */
export function resetAditoKnowledge(): void {
  sourceCache.clear()
  projectCache.clear()
  ownerCache.clear()
}

function kindOf(kind: Suggestion['kind']): monaco.languages.CompletionItemKind {
  const k = monaco.languages.CompletionItemKind
  switch (kind) {
    case 'variable':
      return k.Variable
    case 'module':
      return k.Module
    case 'field':
      return k.Field
    case 'class':
      return k.Class
    default:
      return k.Text
  }
}

function install(): void {
  if (installed) return
  installed = monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['"', "'", '.', '$', '_', '/'],
    async provideCompletionItems(model, position) {
      const ctx = contexts.get(model.uri.toString())
      if (!ctx) return { suggestions: [] }
      const linePrefix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const where = stringContext(linePrefix)
      if (!where) return memberSuggestions(model, position, linePrefix, ctx)
      const [project, owner] = await Promise.all([loadProject(ctx), loadOwner(ctx)])
      const items = suggestionsFor(where, { ...project, ...owner, locals: localVariables(model.getValue()) })
      const range = new monaco.Range(position.lineNumber, position.column - where.prefix.length, position.lineNumber, position.column)
      return {
        suggestions: items.map((s, i) => ({
          label: s.label,
          kind: kindOf(s.kind),
          detail: `ADITO · ${s.detail}`,
          insertText: s.label,
          range,
          filterText: s.label,
          sortText: String(i).padStart(4, '0'),
        })),
      }
    },
  })
}

/** After `Name.` of an imported library class: its methods, with their signature and comment. */
async function memberSuggestions(model: monaco.editor.ITextModel, position: monaco.Position, linePrefix: string, ctx: AditoContext): Promise<monaco.languages.CompletionList> {
  const m = /([A-Za-z_$][\w$]*)\.([\w$]*)$/.exec(linePrefix)
  if (!m) return { suggestions: [] }
  const [, owner, typed] = m
  const imported = parseImports(model.getValue()).find((i) => i.names.has(owner))
  if (!imported) return { suggestions: [] }
  const from = modelPathOf.get(model.uri.toString()) ?? ''
  const source = await librarySource(ctx, imported.spec, from)
  if (!source) return { suggestions: [] }
  const exported = imported.names.get(owner) || owner
  const members = classMembers(source.text, exported)
  const range = new monaco.Range(position.lineNumber, position.column - typed.length, position.lineNumber, position.column)
  return {
    suggestions: members.map((member, i) => ({
      label: member.name,
      kind: monaco.languages.CompletionItemKind.Method,
      detail: `ADITO · ${member.signature}`,
      documentation: member.doc || undefined,
      insertText: member.name,
      range,
      sortText: String(i).padStart(4, '0'),
    })),
  }
}

/** Gives a script model the project it belongs to; returns the call that takes it back. */
export function registerAditoModel(model: monaco.editor.ITextModel, ctx: AditoContext, path = ''): () => void {
  install()
  const key = model.uri.toString()
  contexts.set(key, ctx)
  if (path) modelPathOf.set(key, path)
  return () => {
    if (contexts.get(key) === ctx) contexts.delete(key)
  }
}

/** Colours ADITO variables inside strings (`$field.X`) and sets calls in bold, as the original Designer does. */
export function attachAditoStyle(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const collection = editor.createDecorationsCollection?.([])
  if (!collection) return () => undefined
  let timer: number | undefined
  const refresh = () => {
    const model = editor.getModel()
    if (!model) return
    const text = model.getValue()
    collection.set(
      findAditoTokens(text).map((t) => {
        const a = model.getPositionAt(t.start)
        const b = model.getPositionAt(t.end)
        return { range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column), options: { inlineClassName: t.kind === 'variable' ? 'adito-var' : 'adito-call' } }
      }),
    )
  }
  refresh()
  const sub = editor.onDidChangeModelContent(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(refresh, 150)
  })
  return () => {
    window.clearTimeout(timer)
    sub.dispose()
    collection.clear()
  }
}
