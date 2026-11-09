// Turns a VS Code colour theme file (.json / .jsonc: `colors` and `tokenColors`) into the theme data
// Monaco understands. Pure text work, no Monaco import, so it can be tested and used anywhere.
// Only the editor is coloured; the surrounding interface keeps its own theme.

import { deriveWorkbenchColors } from './workbenchColors'

export interface MonacoThemeRule {
  token: string
  foreground?: string
  background?: string
  fontStyle?: string
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  inherit: boolean
  rules: MonacoThemeRule[]
  colors: Record<string, string>
}

export interface ImportedTheme {
  id: string
  name: string
  data: MonacoThemeData
}

/** Removes comments and trailing commas (VS Code theme files are JSON with comments). */
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i++
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// Monaco colours code with its own tokenizers (Monarch), not with TextMate grammars, so one scope often stands for
// several Monaco tokens (a JSON key is `string.key.json`, a JavaScript name is `identifier`, ...).
const SCOPE_TO_TOKEN: [string, string[]][] = [
  ['comment', ['comment']],
  ['string.regexp', ['regexp']],
  ['string', ['string', 'attribute.value', 'string.value']],
  ['constant.numeric', ['number', 'number.float', 'number.hex']],
  ['constant.character.escape', ['string.escape']],
  ['constant.language', ['keyword.json', 'constant']],
  ['constant', ['constant']],
  ['keyword.operator', ['operator', 'delimiter.operator']],
  ['keyword', ['keyword', 'keyword.flow']],
  ['storage', ['keyword', 'storage']],
  ['entity.name.function', ['function', 'support.function']],
  ['support.function', ['function', 'support.function']],
  ['meta.function-call', ['function']],
  ['entity.name.type', ['type', 'type.identifier']],
  ['entity.name.class', ['type', 'type.identifier']],
  ['support.class', ['type', 'type.identifier']],
  ['support.type.property-name', ['string.key', 'attribute.name']],
  ['support.type', ['type', 'type.identifier']],
  ['meta.property-name', ['string.key']],
  ['meta.property-value', ['string.value']],
  ['meta.object-literal.key', ['string.key']],
  ['entity.name.tag', ['tag', 'metatag']],
  ['entity.other.attribute-name', ['attribute.name']],
  ['variable.parameter', ['identifier']],
  ['variable', ['variable', 'identifier']],
  ['support.other.variable', ['variable', 'identifier']],
  ['meta.brace', ['delimiter.bracket', 'delimiter.square', 'delimiter.parenthesis', 'delimiter.curly']],
  ['punctuation', ['delimiter', 'delimiter.bracket']],
  ['invalid', ['invalid']],
]

/** The Monaco tokens a TextMate scope colours; the longest matching scope prefix wins. */
function tokensFor(scope: string): string[] {
  const s = scope.trim()
  let best: [string, string[]] | null = null
  for (const entry of SCOPE_TO_TOKEN) {
    if ((s === entry[0] || s.startsWith(entry[0] + '.')) && (!best || entry[0].length > best[0].length)) best = entry
  }
  return best ? best[1] : []
}

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA` -> `#rrggbb[aa]`, otherwise null. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return '#' + (h.length <= 4 ? [...h].map((c) => c + c).join('') : h)
}

const hexNoHash = (value: unknown): string | undefined => normalizeColor(value)?.slice(1, 7)

function baseFor(type: unknown): MonacoThemeData['base'] {
  const t = typeof type === 'string' ? type.toLowerCase() : 'dark'
  if (t === 'light') return 'vs'
  if (t === 'hc' || t === 'hc-black') return 'hc-black'
  if (t === 'hc-light') return 'hc-light'
  return 'vs-dark'
}

export function themeIdFor(name: string): string {
  return 'imported-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme')
}

// ---- TextMate themes (.tmTheme, .plist): the older XML format many VS Code theme extensions still ship ----

type PlistValue = string | PlistValue[] | { [key: string]: PlistValue }

function plistValue(el: Element): PlistValue {
  const children = Array.from(el.children)
  if (el.tagName === 'dict') {
    const out: { [key: string]: PlistValue } = {}
    for (let i = 0; i < children.length; i++) {
      if (children[i].tagName === 'key' && children[i + 1]) out[children[i].textContent ?? ''] = plistValue(children[++i])
    }
    return out
  }
  if (el.tagName === 'array') return children.map(plistValue)
  return el.textContent ?? ''
}

/** The theme as the object of a VS Code theme file: the first settings block holds the editor colours. */
export function tmThemeToObject(text: string): Record<string, unknown> | null {
  if (!text.trimStart().startsWith('<')) return null
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const root = doc.querySelector('plist > dict')
  if (!root || doc.querySelector('parsererror')) return null
  const theme = plistValue(root) as { name?: string; settings?: { scope?: string; name?: string; settings?: Record<string, string> }[] }
  if (!Array.isArray(theme.settings)) return null
  const global = theme.settings.find((s) => s.scope === undefined)?.settings ?? {}
  const colors: Record<string, string> = {}
  const set = (key: string, value: unknown) => {
    const c = normalizeColor(value)
    if (c) colors[key] = c
  }
  set('editor.background', global.background)
  set('editor.foreground', global.foreground)
  set('editorCursor.foreground', global.caret)
  set('editor.selectionBackground', global.selection)
  set('editor.lineHighlightBackground', global.lineHighlight)
  set('editorWhitespace.foreground', global.invisibles)
  set('editorIndentGuide.background', global.guide)
  const tokenColors = theme.settings.filter((s) => s.scope !== undefined).map((s) => ({ name: s.name, scope: s.scope, settings: s.settings ?? {} }))
  const scopeColour = (scope: string) => normalizeColor(tokenColors.find((x) => (x.scope ?? '').split(',').map((y) => y.trim()).includes(scope))?.settings.foreground)
  deriveWorkbenchColors(colors, { keyword: scopeColour('keyword') ?? undefined, string: scopeColour('string') ?? undefined, comment: scopeColour('comment') ?? undefined })
  // The brightness of the background decides between a dark and a light base.
  const bg = colors['editor.background']
  const luminance = bg ? (parseInt(bg.slice(1, 3), 16) * 299 + parseInt(bg.slice(3, 5), 16) * 587 + parseInt(bg.slice(5, 7), 16) * 114) / 1000 : 0
  return { name: theme.name, type: luminance > 160 ? 'light' : 'dark', colors, tokenColors }
}

/** The JSON text of a theme file, whatever its format: JSON or a TextMate plist. */
function themeObjectOf(text: string): unknown {
  const tm = tmThemeToObject(text)
  if (tm) return tm
  return JSON.parse(stripJsonc(text))
}

/** Reads a VS Code theme file. Throws an Error with a readable message when it is not a colour theme. */
export function parseVsCodeTheme(text: string, fallbackName: string): ImportedTheme {
  let raw: unknown
  try {
    raw = themeObjectOf(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('The file is not a colour theme.')
  const file = raw as { name?: unknown; type?: unknown; colors?: unknown; tokenColors?: unknown; include?: unknown }
  const tokenColors = Array.isArray(file.tokenColors) ? file.tokenColors : []
  const colorsIn = typeof file.colors === 'object' && file.colors !== null ? (file.colors as Record<string, unknown>) : {}
  if (tokenColors.length === 0 && Object.keys(colorsIn).length === 0) {
    throw new Error(typeof file.include === 'string' ? 'This theme includes another theme file; choose the complete theme file.' : 'The file has neither "colors" nor "tokenColors", so it is not a VS Code colour theme.')
  }

  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(colorsIn)) {
    const c = normalizeColor(value)
    if (c) colors[key] = c
  }

  const rules: MonacoThemeRule[] = []
  for (const entry of tokenColors) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { scope?: unknown; settings?: { foreground?: unknown; background?: unknown; fontStyle?: unknown } }
    const s = e.settings ?? {}
    if (e.scope === undefined) {
      // The first entry without a scope sets the default text colours.
      if (!colors['editor.foreground'] && normalizeColor(s.foreground)) colors['editor.foreground'] = normalizeColor(s.foreground)!
      if (!colors['editor.background'] && normalizeColor(s.background)) colors['editor.background'] = normalizeColor(s.background)!
      continue
    }
    const scopes = (Array.isArray(e.scope) ? e.scope : String(e.scope).split(',')).map((x) => String(x))
    const foreground = hexNoHash(s.foreground)
    const fontStyle = typeof s.fontStyle === 'string' ? s.fontStyle.trim() : undefined
    if (!foreground && fontStyle === undefined) continue
    const seen = new Set<string>()
    for (const scope of scopes) {
      for (const token of tokensFor(scope)) {
        if (seen.has(token)) continue
        seen.add(token)
        rules.push({ token, ...(foreground ? { foreground } : {}), ...(fontStyle !== undefined ? { fontStyle } : {}) })
      }
    }
  }

  const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : fallbackName.replace(/\.[^.]+$/, '')
  return { id: themeIdFor(name), name, data: { base: baseFor(file.type), inherit: true, rules, colors } }
}

// ---- Theme packages: a .vsix / .zip extension, the folder of an extension, or a single theme file ----

export interface PackFile {
  name: string
  text: string
}

function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split(/[\\/]/)) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

type RawTheme = { name?: unknown; type?: unknown; colors?: Record<string, unknown>; tokenColors?: unknown[]; include?: unknown }

/** The theme file with its `include` chain merged: the including file wins over the included one. */
function withIncludes(path: string, files: Map<string, string>, depth = 0): RawTheme | null {
  const text = files.get(path)
  if (text === undefined || depth > 8) return null
  let raw: RawTheme
  try {
    raw = themeObjectOf(text) as RawTheme
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  if (typeof raw.include !== 'string') return raw
  const base = withIncludes(normalizePath(dirOf(path) + '/' + raw.include), files, depth + 1)
  if (!base) return raw
  return {
    ...base,
    ...raw,
    colors: { ...(base.colors ?? {}), ...(raw.colors ?? {}) },
    tokenColors: [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(raw.tokenColors) ? raw.tokenColors : [])],
    include: undefined,
  }
}

function typeForUiTheme(ui: unknown): string | undefined {
  if (ui === 'vs') return 'light'
  if (ui === 'hc-black') return 'hc-black'
  if (ui === 'hc-light') return 'hc-light'
  if (ui === 'vs-dark') return 'dark'
  return undefined
}

/**
 * Finds every colour theme in the files of a package. An extension lists its themes in the `package.json`
 * (`contributes.themes`); without one every file that looks like a colour theme is taken. A theme that cannot be read
 * is skipped. Throws when nothing is left.
 */
export function parseThemePack(packFiles: PackFile[]): ImportedTheme[] {
  const files = new Map(packFiles.map((f) => [normalizePath(f.name), f.text]))
  const found = new Map<string, ImportedTheme>()
  const add = (path: string, label: unknown, uiTheme: unknown) => {
    const raw = withIncludes(path, files)
    if (!raw) return
    const type = typeForUiTheme(uiTheme) ?? raw.type
    const fallback = typeof label === 'string' && label.trim() ? label.trim() : path.split('/').pop() ?? 'theme'
    try {
      const theme = parseVsCodeTheme(JSON.stringify({ ...raw, type, name: typeof label === 'string' && label.trim() ? label.trim() : raw.name }), fallback)
      found.set(theme.id, theme)
    } catch {
      // not a colour theme
    }
  }

  const packages = [...files.keys()].filter((n) => n === 'package.json' || n.endsWith('/package.json')).sort((a, b) => a.length - b.length)
  for (const pkg of packages) {
    let manifest: { contributes?: { themes?: { label?: unknown; path?: unknown; uiTheme?: unknown }[] } }
    try {
      manifest = JSON.parse(stripJsonc(files.get(pkg) ?? '{}'))
    } catch {
      continue
    }
    for (const entry of manifest.contributes?.themes ?? []) {
      if (typeof entry?.path === 'string') add(normalizePath(dirOf(pkg) + '/' + entry.path), entry.label, entry.uiTheme)
    }
  }
  if (found.size === 0) {
    for (const name of files.keys()) {
      if (!name.endsWith('package.json')) add(name, undefined, undefined)
    }
  }
  if (found.size === 0) throw new Error('No VS Code colour theme was found. Choose a theme .json file, a .vsix package or the folder of a theme extension.')
  return [...found.values()]
}
