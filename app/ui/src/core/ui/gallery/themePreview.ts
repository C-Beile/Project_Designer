import { BUILTIN_TOML_THEMES } from '../../../theme/builtinThemes'
import { applyThemeTokens, type ParsedTheme } from '../../../theme/themeToml'
import { applyUiTheme } from '../../../theme/uiTheme'
import { getActiveEditorTheme, restoreEditorTheme, setActiveEditorTheme, type ActiveEditorTheme } from '../../../theme/editorTheme'

/** Zeigt ein eingebautes Theme (dark, light, lion) ohne zu speichern. */
export function previewTheme(id: string): void {
  const toml = BUILTIN_TOML_THEMES[id]
  applyUiTheme(undefined, id)
  applyThemeTokens(toml?.tokens)
  setActiveEditorTheme(toml ?? null)
}

/** Zeigt ein gerade bearbeitetes TOML-Theme (noch nicht gespeichert). */
export function previewTomlTheme(theme: ParsedTheme): void {
  applyUiTheme(undefined, theme.meta.kind)
  applyThemeTokens(theme.tokens)
  setActiveEditorTheme(theme)
}

export interface ThemeSnapshot {
  theme: string | null
  style: string | null
  editor: ActiveEditorTheme | null
}

export function snapshotTheme(root: HTMLElement = document.documentElement): ThemeSnapshot {
  return { theme: root.getAttribute('data-theme'), style: root.getAttribute('style'), editor: getActiveEditorTheme() }
}

export function restoreTheme(snapshot: ThemeSnapshot, root: HTMLElement = document.documentElement): void {
  if (snapshot.theme === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', snapshot.theme)
  if (snapshot.style === null) root.removeAttribute('style')
  else root.setAttribute('style', snapshot.style)
  restoreEditorTheme(snapshot.editor)
}

export interface TokenInfo {
  name: string
  group: string
}

const GROUPS: [string, string[]][] = [
  ['Surfaces', ['bg']],
  ['Text', ['fg']],
  ['Borders', ['border', 'focus']],
  ['Accents and states', ['accent', 'warm', 'cyan', 'success', 'warning', 'error', 'selection', 'selected', 'button']],
  ['Object icons', ['icon']],
  ['Folder colours', ['folder', 'project']],
  ['Diagram', ['diagram']],
  ['Brand', ['brand']],
  ['Scales', ['space', 'text', 'leading', 'weight', 'radius', 'z', 'duration', 'ease', 'control', 'row', 'tab', 'ui']],
]

function groupOf(name: string): string {
  const prefix = name.slice(2).split('-')[0]
  return GROUPS.find(([, prefixes]) => prefixes.includes(prefix))?.[0] ?? 'Other'
}

/** Alle Variablen, die ein Stylesheet auf `:root` setzt, in der Reihenfolge ihres Auftretens. */
export function collectTokens(sheets: StyleSheetList = document.styleSheets): TokenInfo[] {
  const seen = new Set<string>()
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.startsWith(':root')) {
        for (const prop of Array.from(rule.style)) if (prop.startsWith('--')) seen.add(prop)
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(sheets)) {
    try {
      visit(sheet.cssRules)
    } catch {
      // Stylesheet von fremdem Ursprung: nicht lesbar.
    }
  }
  return [...seen].map((name) => ({ name, group: groupOf(name) }))
}

export function groupTokens(tokens: TokenInfo[]): [string, string[]][] {
  const order = [...GROUPS.map(([g]) => g), 'Other']
  return order.map((g) => [g, tokens.filter((t) => t.group === g).map((t) => t.name)] as [string, string[]]).filter(([, names]) => names.length > 0)
}

export function tokenValue(name: string, root: HTMLElement = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(name).trim()
}

const COLOR_VALUE = /^(#|rgb|hsl|color-mix|oklch|oklab)/i
export const isColorValue = (value: string): boolean => COLOR_VALUE.test(value) || value.includes('gradient')
