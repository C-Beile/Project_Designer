// ADITO knowledge for the code editors: what a script may name inside a string, depending on the
// call it stands in. Pure functions (no Monaco), so they are tested on their own; monacoAdito.ts
// feeds them with the project and hands the result to the editor.

export type StringContext =
  | { kind: 'variable'; prefix: string }
  | { kind: 'import'; prefix: string }
  | { kind: 'translate'; prefix: string }
  | { kind: 'sql'; prefix: string }
  | { kind: 'importNames'; prefix: string; library: string }

/** Names that ADITO provides itself in `vars.get("$sys....")`. */
export const SYSTEM_VARIABLES: { name: string; info: string }[] = [
  { name: '$sys.date', info: 'Current date' },
  { name: '$sys.datetime', info: 'Current date and time' },
  { name: '$sys.user', info: 'Name of the logged-in user' },
  { name: '$sys.userid', info: 'Id of the logged-in user' },
  { name: '$sys.uid', info: 'Unique id of the current record' },
  { name: '$sys.recordstate', info: 'State of the current record (neon.OPERATINGSTATE_*)' },
  { name: '$sys.currentcontextid', info: 'Id of the context the script runs in' },
  { name: '$sys.selection', info: 'Selected records of a view' },
  { name: '$sys.valid', info: 'Whether the current record is valid' },
  { name: '$sys.clientlanguage', info: 'Language of the client' },
]

const SQL_CALLS = /\.(from|join|leftJoin|rightJoin|innerJoin|where|orWhere|andWhere|orderBy|groupBy|having|select|selectDistinct|selectColumn|and|or)\s*\(\s*$|newSelect\s*\(\s*\[?[^"'`]*$|\b(?:db\.table|db\.tableByName|db\.array|db\.cell|db\.cond|db\.insert|db\.update|db\.deleteData)\s*\(\s*[^"'`]*$/

/** What the cursor stands in: the text of the string before the cursor and the call around it. */
export function stringContext(linePrefix: string): StringContext | null {
  let quote: string | null = null
  let start = -1
  for (let i = 0; i < linePrefix.length; i++) {
    const c = linePrefix[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c
      start = i
    }
  }
  if (!quote) return null
  const prefix = linePrefix.slice(start + 1)
  const before = linePrefix.slice(0, start)
  const importFrom = /import\s*\{([^}]*)\}\s*from\s*$/.exec(before)
  if (importFrom) return { kind: 'import', prefix }
  if (/\bfrom\s*$/.test(before) && /\bimport\b/.test(before)) return { kind: 'import', prefix }
  if (/\bvars\s*\.\s*(get|set|exists|getString|getBoolean|getNumber|getDate|getObject)\s*\(\s*$/.test(before) || /\bvars\s*\.\s*(get|set|exists)\s*\([^()]*,\s*$/.test(before)) return { kind: 'variable', prefix }
  if (/\btranslate\s*\.\s*(text|withArguments)\s*\(\s*$/.test(before)) return { kind: 'translate', prefix }
  if (SQL_CALLS.test(before)) return { kind: 'sql', prefix }
  return null
}

/** Names of the entity fields and parameters an object source declares. */
export function entityNames(source: string): { fields: string[]; params: string[] } {
  const fields = new Set<string>()
  const params = new Set<string>()
  const block = /<(entityField|entityActionField|entityActionGroup|entityConsumer|entityProvider|entityParameter|entityDb)>\s*<name>([^<]+)<\/name>/g
  for (const m of source.matchAll(block)) {
    if (m[1] === 'entityParameter') params.add(m[2])
    else if (m[1] !== 'entityDb') fields.add(m[2])
  }
  return { fields: [...fields], params: [...params] }
}

/** Tables with their columns out of an alias definition source (`entityDb` / `entityFieldDb`). */
export function aliasTables(source: string): { table: string; columns: string[] }[] {
  const out: { table: string; columns: string[] }[] = []
  const tables = source.split('<entityDb>').slice(1)
  for (const part of tables) {
    const name = /<name>([^<]+)<\/name>/.exec(part)?.[1]
    if (!name) continue
    const columns = new Set<string>()
    for (const m of part.matchAll(/<entityFieldDb>\s*<name>([^<]+)<\/name>/g)) columns.add(m[1])
    out.push({ table: name, columns: [...columns] })
  }
  return out
}

/** Keys of a language object (`stringEntry` names). */
export function languageKeys(source: string): string[] {
  const keys = new Set<string>()
  for (const m of source.matchAll(/<stringEntry>\s*<name>([^<]+)<\/name>/g)) keys.add(m[1])
  return [...keys]
}

/** What a library script exports (classes, functions, constants). */
export function libraryExports(source: string): string[] {
  const names = new Set<string>()
  for (const m of source.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:class|function\*?|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return [...names]
}

export interface Suggestion {
  label: string
  detail: string
  kind: 'variable' | 'module' | 'text' | 'field' | 'class'
}

export interface ProjectKnowledge {
  /** Names of `$local.x` variables the script itself uses. */
  locals?: string[]
  fields: string[]
  params: string[]
  libraries: string[]
  languageKeys: string[]
  tables: { table: string; columns: string[] }[]
}

/** The suggestions for what stands in front of the cursor, filtered by the typed prefix. */
export function suggestionsFor(context: StringContext, known: ProjectKnowledge): Suggestion[] {
  const typed = context.prefix.toLowerCase()
  const keep = (s: Suggestion) => s.label.toLowerCase().includes(typed)
  let out: Suggestion[] = []
  if (context.kind === 'variable') {
    out = [
      ...SYSTEM_VARIABLES.map((v) => ({ label: v.name, detail: v.info, kind: 'variable' as const })),
      ...known.fields.map((f) => ({ label: `$field.${f}`, detail: 'Field of this object', kind: 'field' as const })),
      ...known.params.map((p) => ({ label: `$param.${p}`, detail: 'Parameter of this object', kind: 'variable' as const })),
      { label: '$this.value', detail: 'Value of the field the script belongs to', kind: 'variable' as const },
      ...(known.locals ?? []).map((l) => ({ label: `$local.${l}`, detail: 'Local variable of this script', kind: 'variable' as const })),
    ]
  } else if (context.kind === 'import') {
    out = known.libraries.map((l) => ({ label: l, detail: 'Library of the project', kind: 'module' as const }))
  } else if (context.kind === 'translate') {
    out = known.languageKeys.map((k) => ({ label: k, detail: 'Language key', kind: 'text' as const }))
  } else if (context.kind === 'sql') {
    const dot = context.prefix.indexOf('.')
    if (dot < 0) {
      out = known.tables.map((t) => ({ label: t.table, detail: `${t.columns.length} columns`, kind: 'class' as const }))
    } else {
      const table = context.prefix.slice(0, dot).toUpperCase()
      const hit = known.tables.find((t) => t.table.toUpperCase() === table)
      out = (hit?.columns ?? []).map((c) => ({ label: `${hit?.table}.${c}`, detail: 'Column', kind: 'field' as const }))
    }
  }
  return out.filter(keep).slice(0, 300)
}

/** `$local.x` names a script sets or reads. */
export function localVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\$local\.([A-Za-z_][\w]*)/g)].map((m) => m[1]))]
}

export interface Member {
  name: string
  signature: string
  doc: string
  isStatic: boolean
}

/** Methods of `export class <name>` in a library script, with the comment that stands above them. */
export function classMembers(source: string, className: string): Member[] {
  const head = new RegExp(`export\\s+(?:default\\s+)?class\\s+${className.replace(/[$]/g, '\\$')}\\b[^{]*\\{`).exec(source)
  if (!head) return []
  let depth = 1
  let i = head.index + head[0].length
  const bodyStart = i
  while (i < source.length && depth > 0) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  const body = source.slice(bodyStart, i - 1)
  const out: Member[] = []
  let level = 0
  let lineStart = 0
  const lines = body.split('\n')
  let pendingDoc = ''
  let inDoc = false
  let docBuf: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (level === 0) {
      if (line.startsWith('/**')) {
        inDoc = true
        docBuf = []
      }
      if (inDoc) {
        docBuf.push(line.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\*\s?/, '').trim())
        if (line.endsWith('*/')) {
          inDoc = false
          pendingDoc = docBuf.filter(Boolean).join(' ')
        }
      } else {
        const m = /^(static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*\(([^)]*)\)?/.exec(line)
        if (m && !/^(if|for|while|switch|catch|return|function)$/.test(m[2]) && !m[2].startsWith('#')) {
          out.push({ name: m[2], signature: `${m[2]}(${m[3].trim()})`, doc: pendingDoc, isStatic: !!m[1] })
        }
        if (line) pendingDoc = ''
      }
    }
    for (const c of raw) {
      if (c === '{') level++
      else if (c === '}') level--
    }
    lineStart += raw.length + 1
  }
  void lineStart
  return out.filter((m) => m.name !== 'constructor')
}

export interface AditoToken {
  start: number
  end: number
  kind: 'variable' | 'call'
}

const CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'import', 'export', 'else', 'do', 'with'])

/** Where a script has ADITO variables inside its strings (`$field.X`) and where it calls something. */
export function findAditoTokens(text: string): AditoToken[] {
  const out: AditoToken[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = i + 1
      i++
      while (i < n && text[i] !== quote && text[i] !== '\n') {
        if (text[i] === '\\') i++
        i++
      }
      const body = text.slice(start, Math.min(i, n))
      for (const m of body.matchAll(/\$[A-Za-z]+(?:\.[A-Za-z_$#][\w$#]*)+/g)) {
        out.push({ start: start + (m.index ?? 0), end: start + (m.index ?? 0) + m[0].length, kind: 'variable' })
      }
      i++
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(text[j])) j++
      let k = j
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k++
      const word = text.slice(i, j)
      if (text[k] === '(' && !CALL_KEYWORDS.has(word) && text[i - 1] !== '$') out.push({ start: i, end: j, kind: 'call' })
      i = j
    } else {
      i++
    }
  }
  return out
}
