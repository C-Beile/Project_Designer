import { parse } from 'smol-toml'
import { EDITOR_KEYS, EDITOR_KEY_NAMES, SYNTAX_KEYS, THEME_KEYS, THEME_KEY_NAMES, THEME_KINDS, type ThemeKind } from './themeSchema'

export interface ThemeMeta {
  id: string
  name: string
  kind: ThemeKind
  author?: string
}

export interface ParsedEditorTheme {
  /** Monaco-Farbname -> Farbe, nur was das Theme setzt. */
  colors: Record<string, string>
  /** Monaco-Token -> Farbe und Stil, nur was das Theme setzt. */
  syntax: Record<string, { color: string; italic: boolean }>
}

export interface ParsedTheme {
  meta: ThemeMeta
  /** CSS-Variable -> Farbe, nur was das Theme setzt. */
  tokens: Record<string, string>
  editor: ParsedEditorTheme
  warnings: string[]
}

const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MIN_TEXT_CONTRAST = 4.5

type Flat = Record<string, string>

function flatten(value: unknown, prefix: string, out: Flat): void {
  if (typeof value === 'string') {
    out[prefix] = value
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
}

function resolveReferences(values: Flat, warnings: string[]): Flat {
  const resolved: Flat = {}
  const resolve = (key: string, seen: string[]): string | undefined => {
    if (key in resolved) return resolved[key]
    const raw = values[key]
    if (raw === undefined) return undefined
    if (!raw.startsWith('@')) return (resolved[key] = raw)
    const target = raw.slice(1)
    if (seen.includes(target) || target === key) {
      warnings.push(`${key}: Verweis auf ${raw} ist ein Zyklus`)
      return undefined
    }
    const value = resolve(target, [...seen, key])
    if (value === undefined) warnings.push(`${key}: Verweis auf ${raw} nicht gefunden`)
    else resolved[key] = value
    return value
  }
  for (const key of Object.keys(values)) resolve(key, [])
  return resolved
}

function luminance(hex: string): number | null {
  if (!COLOR.test(hex)) return null
  let h = hex.slice(1)
  if (h.length <= 4) h = [...h].map((c) => c + c).join('')
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Liest eine `.theme.toml`. Wirft nur bei ungültigem TOML oder fehlendem `[theme]`. Alles andere wird eine Warnung. */
export function parseTheme(text: string): ParsedTheme {
  const doc = parse(text) as Record<string, unknown>
  const meta = doc.theme as Record<string, unknown> | undefined
  if (!meta || typeof meta.id !== 'string' || typeof meta.name !== 'string') throw new Error('[theme] braucht id und name')
  const kind = THEME_KINDS.find((k) => k === meta.kind)
  if (!kind) throw new Error(`[theme] kind muss ${THEME_KINDS.join(' oder ')} sein`)

  const warnings: string[] = []
  const flat: Flat = {}
  for (const [section, body] of Object.entries(doc)) if (section !== 'theme') flatten(body, section, flat)
  const resolved = resolveReferences(flat, warnings)

  const tokens: Record<string, string> = {}
  const editor: ParsedEditorTheme = { colors: {}, syntax: {} }
  for (const [key, value] of Object.entries(resolved)) {
    if (!THEME_KEY_NAMES.has(key) && !EDITOR_KEY_NAMES.has(key)) {
      warnings.push(`${key}: unbekannter oder interner Schlüssel, ignoriert`)
      continue
    }
    if (!COLOR.test(value)) {
      warnings.push(`${key}: "${value}" ist keine Farbe (#rgb, #rrggbb oder #rrggbbaa)`)
      continue
    }
    const ui = THEME_KEYS.find((k) => k.key === key)
    const code = EDITOR_KEYS.find((k) => k.key === key)
    const syntax = SYNTAX_KEYS.find((k) => k.key === key)
    if (ui) tokens[ui.cssVar] = value
    else if (code) editor.colors[code.monaco] = value
    else if (syntax) editor.syntax[syntax.token] = { color: value, italic: syntax.style === 'italic' }
  }

  const ratio = contrastRatio(resolved['text.primary'] ?? '', resolved['surface.base'] ?? '')
  if (ratio !== null && ratio < MIN_TEXT_CONTRAST) warnings.push(`text.primary auf surface.base: Kontrast ${ratio.toFixed(1)}:1, gefordert sind ${MIN_TEXT_CONTRAST}:1 (WCAG AA)`)

  return { meta: { id: meta.id, name: meta.name, kind, author: typeof meta.author === 'string' ? meta.author : undefined }, tokens, editor, warnings }
}

let applied: string[] = []

/** Setzt die Farben eines Themes als Variablen auf `<html>`. Mit `undefined` verschwinden sie wieder. */
export function applyThemeTokens(tokens: Record<string, string> | undefined, root: HTMLElement = document.documentElement): void {
  for (const name of applied) root.style.removeProperty(name)
  applied = []
  if (!tokens) return
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value)
    applied.push(name)
  }
}
