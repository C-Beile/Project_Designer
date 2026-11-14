import type { ParsedTheme } from './themeToml'
import type { MonacoThemeData, MonacoThemeRule } from './vscodeTheme'

/** Die Code-Farben des aktiven TOML-Themes; `null`, wenn das Theme keine hat (dann gelten die eingebauten Monaco-Themes). */
export interface ActiveEditorTheme {
  /** `lion` hängt an das Lion-Monaco-Theme, sonst entscheidet die Art. */
  id: string
  kind: 'dark' | 'light'
  colors: ParsedTheme['editor']['colors']
  syntax: ParsedTheme['editor']['syntax']
}

let active: ActiveEditorTheme | null = null
const listeners = new Set<() => void>()

export function getActiveEditorTheme(): ActiveEditorTheme | null {
  return active
}

export function subscribeEditorTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setActiveEditorTheme(theme: ParsedTheme | null): void {
  const next = theme && (Object.keys(theme.editor.colors).length > 0 || Object.keys(theme.editor.syntax).length > 0) ? { id: theme.meta.id, kind: theme.meta.kind, colors: theme.editor.colors, syntax: theme.editor.syntax } : null
  if (JSON.stringify(next) === JSON.stringify(active)) return
  active = next
  listeners.forEach((l) => l())
}

/** Diese Tokens gelten in SQL-Text mit der gleichen Farbe (siehe `withSqlTokens` in monacoTheme.ts). */
const SQL_FOLLOWS = ['string', 'number', 'comment']

const hex = (color: string) => color.replace(/^#/, '').slice(0, 6).toLowerCase()

/** Legt die Farben des TOML-Themes über ein eingebautes Monaco-Theme. Eigene Regeln stehen hinten und gewinnen. */
export function mergeEditorTheme(base: MonacoThemeData, theme: ActiveEditorTheme): MonacoThemeData {
  const own: MonacoThemeRule[] = Object.entries(theme.syntax).map(([token, { color, italic }]) => ({ token, foreground: hex(color), ...(italic ? { fontStyle: 'italic' } : {}) }))
  const sql = own.filter((r) => SQL_FOLLOWS.includes(r.token)).map((r) => ({ ...r, token: `${r.token}.sql` }))
  const rules = [...own, ...sql]
  return { ...base, colors: { ...base.colors, ...theme.colors }, rules: [...base.rules, ...rules] }
}

/** Stellt einen früher gemerkten Stand wieder her (Schließen des Studios). */
export function restoreEditorTheme(theme: ActiveEditorTheme | null): void {
  if (JSON.stringify(theme) === JSON.stringify(active)) return
  active = theme
  listeners.forEach((l) => l())
}

export function _resetEditorThemeForTests(): void {
  active = null
  listeners.clear()
}
